create table if not exists public.agent_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  category text not null default 'preference'
    check (category in ('preference', 'workflow', 'fact')),
  content text not null check (char_length(content) between 1 and 2000),
  source text not null default 'user'
    check (source in ('user', 'task')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agent_memories_user_recent_idx
  on public.agent_memories (user_id, updated_at desc);

alter table public.agent_memories enable row level security;
revoke all on public.agent_memories from anon, authenticated;
grant all on public.agent_memories to service_role;

create or replace function public.prism_store_task_memory(
  p_user_id uuid,
  p_content text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  memory_id uuid;
begin
  if char_length(trim(p_content)) not between 1 and 2000 then
    raise exception 'Memory content must be between 1 and 2000 characters';
  end if;

  insert into public.agent_memories (user_id, category, content, source)
  values (p_user_id, 'workflow', trim(p_content), 'task')
  returning id into memory_id;

  delete from public.agent_memories
  where id in (
    select id from public.agent_memories
    where user_id = p_user_id
    order by updated_at desc
    offset 100
  );
  return memory_id;
end;
$$;

revoke all on function public.prism_store_task_memory(uuid, text) from public, anon, authenticated;
grant execute on function public.prism_store_task_memory(uuid, text) to service_role;
