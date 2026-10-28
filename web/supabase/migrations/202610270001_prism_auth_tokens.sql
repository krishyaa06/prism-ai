create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  role text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.api_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  label text not null check (char_length(label) between 1 and 80),
  token_prefix text not null,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz
);

create index if not exists api_tokens_active_user_idx
  on public.api_tokens (user_id, created_at desc)
  where revoked_at is null;

create table if not exists public.api_rate_limit_buckets (
  token_id uuid primary key references public.api_tokens (id) on delete cascade,
  window_start timestamptz not null,
  request_count integer not null check (request_count > 0)
);

alter table public.profiles enable row level security;
alter table public.api_tokens enable row level security;
alter table public.api_rate_limit_buckets enable row level security;

create or replace function public.prism_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, coalesce(new.email, ''))
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists prism_auth_user_created on auth.users;
create trigger prism_auth_user_created
  after insert or update of email on auth.users
  for each row execute function public.prism_handle_new_user();

revoke all on public.profiles from anon, authenticated;
revoke all on public.api_tokens from anon, authenticated;
grant all on public.profiles, public.api_tokens to service_role;
revoke all on public.api_rate_limit_buckets from anon, authenticated;
grant all on public.api_rate_limit_buckets to service_role;

create or replace function public.prism_consume_api_rate_limit(
  p_token_id uuid,
  p_limit integer default 60
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_window timestamptz := date_trunc('minute', now());
  current_count integer;
begin
  insert into public.api_rate_limit_buckets as bucket (token_id, window_start, request_count)
  values (p_token_id, current_window, 1)
  on conflict (token_id) do update
  set window_start = case
        when bucket.window_start < current_window then current_window
        else bucket.window_start
      end,
      request_count = case
        when bucket.window_start < current_window then 1
        else bucket.request_count + 1
      end
  returning request_count into current_count;
  return current_count <= p_limit;
end;
$$;

revoke all on function public.prism_consume_api_rate_limit(uuid, integer) from public, anon, authenticated;
grant execute on function public.prism_consume_api_rate_limit(uuid, integer) to service_role;

-- After creating and verifying the first account, promote it from the SQL editor:
-- update public.profiles set role = 'admin' where email = 'you@example.com';
