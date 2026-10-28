create table if not exists public.agent_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  token_id uuid not null references public.api_tokens (id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed', 'canceled')),
  prompt text not null check (
    char_length(prompt) between 1 and 16000
    or (status in ('completed', 'failed', 'canceled') and prompt = '')
  ),
  screenshot_jpeg_base64 text not null
    check (
      char_length(screenshot_jpeg_base64) between 1 and 4000000
      or (status in ('completed', 'failed', 'canceled') and screenshot_jpeg_base64 = '')
    ),
  is_planning boolean not null default false,
  result text,
  error text,
  attempts integer not null default 0 check (attempts between 0 and 3),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  lease_until timestamptz
);

create index if not exists agent_jobs_user_recent_idx
  on public.agent_jobs (user_id, created_at desc);
create index if not exists agent_jobs_queue_idx
  on public.agent_jobs (created_at)
  where status = 'queued';

alter table public.agent_jobs enable row level security;
revoke all on public.agent_jobs from anon, authenticated;
grant all on public.agent_jobs to service_role;

create or replace function public.prism_enqueue_agent_job(
  p_user_id uuid,
  p_token_id uuid,
  p_prompt text,
  p_screenshot_jpeg_base64 text,
  p_is_planning boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  job_id uuid;
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
  insert into public.agent_jobs (
    user_id, token_id, prompt, screenshot_jpeg_base64, is_planning
  ) values (
    p_user_id, p_token_id, p_prompt, p_screenshot_jpeg_base64, p_is_planning
  ) returning id into job_id;
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
  with next_job as (
    select id
    from public.agent_jobs
    where status = 'queued'
      and attempts < 3
    order by created_at
    for update skip locked
    limit greatest(1, least(p_limit, 16))
  )
  update public.agent_jobs as job
  set status = 'running',
      attempts = job.attempts + 1,
      started_at = coalesce(job.started_at, now()),
      lease_until = now() + interval '2 minutes'
  from next_job
  where job.id = next_job.id
  returning job.*;
end;
$$;

create or replace function public.prism_finish_agent_job(
  p_job_id uuid,
  p_result text default null,
  p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.agent_jobs
  set status = case when p_error is null then 'completed' else 'failed' end,
      result = case when p_error is null then left(p_result, 8000) else null end,
      error = case when p_error is null then null else left(p_error, 1000) end,
      screenshot_jpeg_base64 = '',
      prompt = '',
      completed_at = now(),
      lease_until = null
  where id = p_job_id and status = 'running';
  return found;
end;
$$;

create or replace function public.prism_requeue_expired_agent_jobs()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed integer;
begin
  update public.agent_jobs
  set status = case when attempts >= 3 then 'failed' else 'queued' end,
      error = case when attempts >= 3 then 'Worker lease expired after maximum attempts.' else null end,
      prompt = case when attempts >= 3 then '' else prompt end,
      screenshot_jpeg_base64 = case when attempts >= 3 then '' else screenshot_jpeg_base64 end,
      completed_at = case when attempts >= 3 then now() else null end,
      lease_until = null
  where status = 'running' and lease_until < now();
  get diagnostics changed = row_count;
  return changed;
end;
$$;

revoke all on function public.prism_enqueue_agent_job(uuid, uuid, text, text, boolean) from public, anon, authenticated;
revoke all on function public.prism_claim_agent_job(integer) from public, anon, authenticated;
revoke all on function public.prism_finish_agent_job(uuid, text, text) from public, anon, authenticated;
revoke all on function public.prism_requeue_expired_agent_jobs() from public, anon, authenticated;
grant execute on function public.prism_enqueue_agent_job(uuid, uuid, text, text, boolean) to service_role;
grant execute on function public.prism_claim_agent_job(integer) to service_role;
grant execute on function public.prism_finish_agent_job(uuid, text, text) to service_role;
grant execute on function public.prism_requeue_expired_agent_jobs() to service_role;
