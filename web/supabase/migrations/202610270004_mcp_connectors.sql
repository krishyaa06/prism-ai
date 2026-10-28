create table if not exists public.connector_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  connector_id text not null check (char_length(connector_id) between 2 and 80),
  encrypted_credential text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, connector_id)
);

alter table public.connector_credentials enable row level security;
revoke all on public.connector_credentials from anon, authenticated;
grant all on public.connector_credentials to service_role;
