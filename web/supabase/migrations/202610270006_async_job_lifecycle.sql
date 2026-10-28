alter table public.agent_jobs
  add column if not exists cancel_requested boolean not null default false,
  add column if not exists lease_id uuid,
  add column if not exists available_at timestamptz not null default now(),
  add column if not exists expires_at timestamptz not null default (now() + interval '30 minutes'),
  add column if not exists client_request_id uuid;

drop function if exists public.prism_requeue_expired_agent_jobs();

alter table public.agent_jobs
  drop constraint if exists agent_jobs_attempts_check;

alter table public.agent_jobs
  add constraint agent_jobs_attempts_check check (attempts between 0 and 5);

create unique index if not exists agent_jobs_idempotency_idx
  on public.agent_jobs (token_id, client_request_id)
  where client_request_id is not null;

create index if not exists agent_jobs_available_queue_idx
  on public.agent_jobs (available_at, created_at)
  where status = 'queued';

drop function if exists public.prism_enqueue_agent_job(uuid, uuid, text, text, boolean);
create or replace function public.prism_enqueue_agent_job(
  p_user_id uuid,
  p_token_id uuid,
  p_prompt text,
  p_screenshot_jpeg_base64 text,
  p_is_planning boolean,
  p_client_request_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  job_id uuid;
  active_jobs integer;
begin
  if char_length(trim(p_prompt)) not between 1 and 16000 then
    raise exception 'Prompt must be between 1 and 16000 characters';
  end if;
  if char_length(p_screenshot_jpeg_base64) not between 1 and 4000000 then
    raise exception 'Screenshot payload is outside the permitted size';
  end if;
  if not exists (
    select 1 from public.api_tokens
    where id = p_token_id and user_id = p_user_id and revoked_at is null
      and (expires_at is null or expires_at > now())
  ) then
    raise exception 'API token is no longer active';
  end if;
  perform pg_advisory_xact_lock(hashtext(p_token_id::text));
  select id into job_id
  from public.agent_jobs
  where token_id = p_token_id
    and client_request_id = p_client_request_id;
  if found then return job_id; end if;
  select count(*) into active_jobs
  from public.agent_jobs
  where token_id = p_token_id
    and status in ('queued', 'running')
    and expires_at > now();
  if active_jobs >= 8 then
    raise exception 'Active task limit reached; wait for or cancel an existing task.';
  end if;
  insert into public.agent_jobs (
    user_id, token_id, prompt, screenshot_jpeg_base64, is_planning, client_request_id
  ) values (
    p_user_id, p_token_id, p_prompt, p_screenshot_jpeg_base64, p_is_planning, p_client_request_id
  )
  on conflict (token_id, client_request_id) where client_request_id is not null
  do update set client_request_id = excluded.client_request_id
  returning id into job_id;
  return job_id;
end;
$$;

create or replace function public.prism_claim_agent_job(p_limit integer default 4)
returns setof public.agent_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with next_jobs as (
    select id
    from public.agent_jobs
    where status = 'queued'
      and attempts < 5
      and available_at <= now()
      and expires_at > now()
    order by available_at, created_at
    for update skip locked
    limit greatest(1, least(p_limit, 16))
  )
  update public.agent_jobs as job
  set status = 'running',
      attempts = job.attempts + 1,
      started_at = coalesce(job.started_at, now()),
      lease_until = now() + interval '2 minutes',
      lease_id = gen_random_uuid(),
      cancel_requested = false
  from next_jobs
  where job.id = next_jobs.id
  returning job.*;
end;
$$;

create or replace function public.prism_heartbeat_agent_job(
  p_job_id uuid,
  p_lease_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  active boolean;
begin
  update public.agent_jobs
  set lease_until = now() + interval '2 minutes'
  where id = p_job_id
    and status = 'running'
    and lease_id = p_lease_id
    and expires_at > now()
    and not cancel_requested;
  if found then return true; end if;
  select status = 'running' and lease_id = p_lease_id and not cancel_requested
    into active
    from public.agent_jobs
    where id = p_job_id
      and expires_at > now();
  return coalesce(active, false);
end;
$$;

drop function if exists public.prism_finish_agent_job(uuid, text, text);
create or replace function public.prism_finish_agent_job(
  p_job_id uuid,
  p_lease_id uuid,
  p_result text default null,
  p_error text default null,
  p_retryable boolean default false,
  p_retry_delay_seconds integer default 1
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_job public.agent_jobs%rowtype;
begin
  select * into current_job
  from public.agent_jobs
  where id = p_job_id
    and status = 'running'
    and lease_id = p_lease_id
  for update;
  if not found then return false; end if;

  if current_job.cancel_requested then
    update public.agent_jobs
    set status = 'canceled',
        result = null,
        error = 'Canceled by user.',
        prompt = '',
        screenshot_jpeg_base64 = '',
        completed_at = now(),
        lease_until = null,
        lease_id = null
    where id = p_job_id;
  elsif current_job.expires_at <= now() then
    update public.agent_jobs
    set status = 'failed',
        result = null,
        error = 'Task expired while a worker lease was active.',
        prompt = '',
        screenshot_jpeg_base64 = '',
        completed_at = now(),
        lease_until = null,
        lease_id = null
    where id = p_job_id;
  elsif p_error is null then
    update public.agent_jobs
    set status = 'completed',
        result = left(p_result, 8000),
        error = null,
        prompt = '',
        screenshot_jpeg_base64 = '',
        completed_at = now(),
        lease_until = null,
        lease_id = null
    where id = p_job_id;
  elsif p_retryable and current_job.attempts < 5 and current_job.expires_at > now() then
    update public.agent_jobs
    set status = 'queued',
        result = null,
        error = left(p_error, 1000),
        available_at = now() + make_interval(secs => greatest(1, least(60, p_retry_delay_seconds))),
        lease_until = null,
        lease_id = null
    where id = p_job_id;
  else
    update public.agent_jobs
    set status = 'failed',
        result = null,
        error = left(p_error, 1000),
        prompt = '',
        screenshot_jpeg_base64 = '',
        completed_at = now(),
        lease_until = null,
        lease_id = null
    where id = p_job_id;
  end if;
  return true;
end;
$$;

create or replace function public.prism_maintain_agent_jobs()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed integer := 0;
  affected integer := 0;
begin
  update public.agent_jobs
  set status = 'failed',
      error = 'Task expired before a worker could process it.',
      prompt = '',
      screenshot_jpeg_base64 = '',
      completed_at = now()
  where status = 'queued' and expires_at <= now();
  get diagnostics affected = row_count;
  changed := changed + affected;

  update public.agent_jobs
  set status = case
        when cancel_requested then 'canceled'
        when attempts >= 5 or expires_at <= now() then 'failed'
        else 'queued'
      end,
      error = case
        when cancel_requested then 'Canceled by user.'
        when attempts >= 5 then 'Worker lease expired after maximum attempts.'
        when expires_at <= now() then 'Task expired while a worker lease was active.'
        else null
      end,
      prompt = case when cancel_requested or attempts >= 5 or expires_at <= now() then '' else prompt end,
      screenshot_jpeg_base64 = case when cancel_requested or attempts >= 5 or expires_at <= now() then '' else screenshot_jpeg_base64 end,
      available_at = now() + interval '2 seconds',
      completed_at = case when cancel_requested or attempts >= 5 or expires_at <= now() then now() else null end,
      lease_until = null,
      lease_id = null
  where status = 'running' and lease_until < now();
  get diagnostics affected = row_count;
  changed := changed + affected;

  delete from public.agent_jobs
  where status in ('completed', 'failed', 'canceled')
    and completed_at < now() - interval '7 days';
  get diagnostics affected = row_count;
  return changed + affected;
end;
$$;

create or replace function public.prism_cancel_agent_job(
  p_job_id uuid,
  p_user_id uuid,
  p_token_id uuid default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_job public.agent_jobs%rowtype;
begin
  select * into current_job
  from public.agent_jobs
  where id = p_job_id
    and user_id = p_user_id
    and (p_token_id is null or token_id = p_token_id)
  for update;
  if not found then return null; end if;

  if current_job.status = 'queued' then
    update public.agent_jobs
    set status = 'canceled',
        prompt = '',
        screenshot_jpeg_base64 = '',
        result = null,
        error = 'Canceled by user.',
        completed_at = now(),
        lease_until = null,
        lease_id = null
    where id = p_job_id;
    return 'canceled';
  end if;
  if current_job.status = 'running' then
    update public.agent_jobs
    set cancel_requested = true
    where id = p_job_id;
    return 'cancellation_requested';
  end if;
  if current_job.status = 'canceled' then return 'canceled'; end if;
  return current_job.status;
end;
$$;

revoke all on function public.prism_enqueue_agent_job(uuid, uuid, text, text, boolean, uuid) from public, anon, authenticated;
revoke all on function public.prism_claim_agent_job(integer) from public, anon, authenticated;
revoke all on function public.prism_heartbeat_agent_job(uuid, uuid) from public, anon, authenticated;
revoke all on function public.prism_finish_agent_job(uuid, uuid, text, text, boolean, integer) from public, anon, authenticated;
revoke all on function public.prism_maintain_agent_jobs() from public, anon, authenticated;
revoke all on function public.prism_cancel_agent_job(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.prism_enqueue_agent_job(uuid, uuid, text, text, boolean, uuid) to service_role;
grant execute on function public.prism_claim_agent_job(integer) to service_role;
grant execute on function public.prism_heartbeat_agent_job(uuid, uuid) to service_role;
grant execute on function public.prism_finish_agent_job(uuid, uuid, text, text, boolean, integer) to service_role;
grant execute on function public.prism_maintain_agent_jobs() to service_role;
grant execute on function public.prism_cancel_agent_job(uuid, uuid, uuid) to service_role;
