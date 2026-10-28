alter table public.agent_jobs
  drop constraint if exists agent_jobs_prompt_check,
  drop constraint if exists agent_jobs_screenshot_jpeg_base64_check;

alter table public.agent_jobs
  add constraint agent_jobs_prompt_check check (
    char_length(prompt) between 1 and 16000
    or (status in ('completed', 'failed', 'canceled') and prompt = '')
  ),
  add constraint agent_jobs_screenshot_jpeg_base64_check check (
    char_length(screenshot_jpeg_base64) between 1 and 4000000
    or (status in ('completed', 'failed', 'canceled') and screenshot_jpeg_base64 = '')
  );

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
