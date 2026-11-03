-- Paste this whole file into Supabase > SQL Editor and click Run. Safe to run again after each stage.
-- Every table hangs off users(id), so the app is multi-user ready.

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  google_sub text unique not null,
  email text not null,
  name text,
  timezone text not null default 'Asia/Kolkata',
  created_at timestamptz not null default now()
);

-- Google tokens, AES-256-GCM encrypted by the app before they reach the database.
create table if not exists google_tokens (
  user_id uuid primary key references users(id) on delete cascade,
  refresh_token_enc text not null,
  access_token_enc text,
  access_expires_at timestamptz,
  scope text,
  updated_at timestamptz not null default now()
);

-- Stage 2: calendars the user switched off in the app (Google ids). Doesn't touch Google's own settings.
alter table users add column if not exists hidden_calendars text[] not null default '{}';

-- Stage 6: devices that receive push notifications (one row per browser/phone).
create table if not exists push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references users(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user on push_subscriptions(user_id);

-- One row per reminder sent: so it fires once, can be snoozed, and can escalate if never acknowledged.
-- Holds only the title and a short line of text; rows are deleted 2 days after they fire.
create table if not exists reminder_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  calendar_id text not null,
  event_id text not null,
  minutes int not null,
  fire_at timestamptz not null,
  title text not null,
  body text not null,
  status text not null default 'sent' check (status in ('sent', 'snoozed', 'done')),
  snooze_until timestamptz,
  sent_at timestamptz not null default now(),
  acked_at timestamptz,
  unique (user_id, calendar_id, event_id, minutes, fire_at)
);
create index if not exists reminder_deliveries_snoozed on reminder_deliveries(snooze_until) where status = 'snoozed';

-- Row Level Security with no policies blocks Supabase's public API from these tables.
-- The app connects as the database owner, which is unaffected.
alter table users enable row level security;
alter table google_tokens enable row level security;
alter table push_subscriptions enable row level security;
alter table reminder_deliveries enable row level security;
