create extension if not exists pgcrypto;

-- Contacts / onboarding
create table if not exists public.chat_contacts (
  id uuid primary key default gen_random_uuid(),
  visitor_id uuid not null unique,
  name text not null,
  email text not null,
  whatsapp text not null,
  store_name text,
  mode text not null default 'unknown' check (mode in ('prospect','customer','unknown')),
  registered_verified_at timestamptz,
  source text not null default 'chatbot',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists chat_contacts_email_idx on public.chat_contacts(lower(email));

-- Chat sessions
create table if not exists public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  visitor_id uuid not null references public.chat_contacts(visitor_id) on delete cascade,
  status text not null default 'open' check (status in ('open','closed')),
  mode text not null default 'unknown' check (mode in ('prospect','customer','unknown')),
  title text not null default 'NiagaBio Chat',
  last_message_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists chat_sessions_visitor_idx on public.chat_sessions(visitor_id, updated_at desc);

-- Messages
create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.chat_sessions(id) on delete cascade,
  sender text not null check (sender in ('user','ai','system')),
  content text not null,
  media jsonb not null default '[]'::jsonb,
  actions jsonb not null default '[]'::jsonb,
  intent text,
  metadata jsonb not null default '{}'::jsonb,
  tokens_input integer,
  tokens_output integer,
  provider text,
  model text,
  error_code text,
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_session_idx on public.chat_messages(session_id, created_at);

-- Leads / high-intent events
create table if not exists public.chat_lead_events (
  id uuid primary key default gen_random_uuid(),
  visitor_id uuid not null references public.chat_contacts(visitor_id) on delete cascade,
  session_id uuid references public.chat_sessions(id) on delete set null,
  event_type text not null,
  score integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Admin auth profile / role
create table if not exists public.chat_admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null default 'admin' check (role in ('admin','master')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Admin presence (optional phase 2)
create table if not exists public.chat_admin_presence (
  user_id uuid primary key references public.chat_admin_users(user_id) on delete cascade,
  is_online boolean not null default false,
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Chatbot settings
create table if not exists public.chat_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

-- Admin notifications
create table if not exists public.chat_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_admin_id uuid references public.chat_admin_users(user_id) on delete cascade,
  type text not null,
  title text not null,
  body text not null,
  session_id uuid references public.chat_sessions(id) on delete cascade,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists chat_notifications_admin_idx on public.chat_notifications(recipient_admin_id, read_at, created_at desc);

-- Admin checks
create or replace function public.chat_is_admin()
returns boolean language sql stable security definer set search_path=public,auth,pg_temp as $$
  select exists(select 1 from public.chat_admin_users a where a.user_id=auth.uid() and a.is_active=true);
$$;
revoke all on function public.chat_is_admin() from public;
grant execute on function public.chat_is_admin() to authenticated;

create or replace function public.chat_is_master()
returns boolean language sql stable security definer set search_path=public,auth,pg_temp as $$
  select exists(select 1 from public.chat_admin_users a where a.user_id=auth.uid() and a.is_active=true and a.role='master');
$$;
revoke all on function public.chat_is_master() from public;
grant execute on function public.chat_is_master() to authenticated;

-- Session timestamp update
create or replace function public.chat_touch_session()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update public.chat_sessions set last_message_at=new.created_at, updated_at=now() where id=new.session_id;
  return new;
end;
$$;
drop trigger if exists trg_chat_touch_session on public.chat_messages;
create trigger trg_chat_touch_session after insert on public.chat_messages for each row execute function public.chat_touch_session();

-- RLS
alter table public.chat_contacts enable row level security;
alter table public.chat_sessions enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_lead_events enable row level security;
alter table public.chat_admin_users enable row level security;
alter table public.chat_admin_presence enable row level security;
alter table public.chat_settings enable row level security;
alter table public.chat_notifications enable row level security;

create policy chat_contacts_self on public.chat_contacts for all to authenticated
using (visitor_id=auth.uid() or public.chat_is_admin())
with check (visitor_id=auth.uid() or public.chat_is_admin());

create policy chat_sessions_self on public.chat_sessions for all to authenticated
using (visitor_id=auth.uid() or public.chat_is_admin())
with check (visitor_id=auth.uid() or public.chat_is_admin());

create policy chat_messages_self on public.chat_messages for all to authenticated
using (exists(select 1 from public.chat_sessions s where s.id=session_id and (s.visitor_id=auth.uid() or public.chat_is_admin())))
with check (exists(select 1 from public.chat_sessions s where s.id=session_id and (s.visitor_id=auth.uid() or public.chat_is_admin())));

create policy chat_leads_admin on public.chat_lead_events for all to authenticated
using (public.chat_is_admin()) with check (public.chat_is_admin());

create policy chat_admin_select on public.chat_admin_users for select to authenticated
using (user_id=auth.uid() or public.chat_is_master());
create policy chat_admin_master_write on public.chat_admin_users for all to authenticated
using (public.chat_is_master()) with check (public.chat_is_master());

create policy chat_presence_admin on public.chat_admin_presence for all to authenticated
using (public.chat_is_admin()) with check (public.chat_is_admin());

create policy chat_settings_master on public.chat_settings for all to authenticated
using (public.chat_is_master()) with check (public.chat_is_master());

create policy chat_notifications_admin on public.chat_notifications for all to authenticated
using (recipient_admin_id=auth.uid() or public.chat_is_master())
with check (recipient_admin_id=auth.uid() or public.chat_is_master());

-- Grants
 grant select,insert,update on public.chat_contacts to authenticated;
 grant select,insert,update on public.chat_sessions to authenticated;
 grant select,insert,update on public.chat_messages to authenticated;
 grant select,insert on public.chat_lead_events to authenticated;
 grant select on public.chat_admin_users to authenticated;
 grant select,insert,update on public.chat_admin_presence to authenticated;
 grant select,insert,update on public.chat_settings to authenticated;
 grant select,update on public.chat_notifications to authenticated;

-- Defaults
insert into public.chat_settings(key,value) values
('admin_whatsapp','{"number":"085191245042","url":"https://wa.me/6285191245042"}'::jsonb),
('ai','{"provider":"openrouter","enabled":true,"temperature":0.6}'::jsonb),
('branding','{"primary":"#0f9f68","dark":"#08794f","ink":"#0f172a","soft":"#f4fbf7","cream":"#fffaf0","lime":"#d9ff52"}'::jsonb)
on conflict(key) do nothing;

select to_regclass('public.chat_contacts'), to_regclass('public.chat_sessions'), to_regclass('public.chat_messages');
