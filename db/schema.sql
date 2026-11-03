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

-- Row Level Security with no policies blocks Supabase's public API from these tables.
-- The app connects as the database owner, which is unaffected.
alter table users enable row level security;
alter table google_tokens enable row level security;
