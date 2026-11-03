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
-- Alert stages: 1) pop-up at each reminder time, 2) again after the snooze time if not answered,
-- 3) full-screen alarm when the event starts. Each can be set in the menu.
alter table users add column if not exists remind_popup boolean not null default true;
alter table users add column if not exists snooze_minutes int not null default 5 check (snooze_minutes between 1 and 120);
alter table users add column if not exists alarm_at_start boolean not null default true;
alter table reminder_deliveries add column if not exists alarm boolean not null default false; -- stage 3
alter table reminder_deliveries add column if not exists repeated boolean not null default false; -- stage 2 already sent

-- Priorities: your choices and check-in progress per deadline. Title and due time are kept so
-- check-in notifications can name the task; rows are deleted a week after the deadline.
create table if not exists deadline_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  calendar_id text not null,
  event_id text not null,
  title text not null,
  due_at timestamptz not null,
  is_deadline boolean, -- shown in Priorities? null = decide automatically
  status text not null default 'open' check (status in ('open', 'doing', 'later', 'stuck', 'done')),
  next_check_at timestamptz,
  later_count int not null default 0,
  updated_at timestamptz not null default now(),
  unique (user_id, calendar_id, event_id)
);
create index if not exists deadline_states_due_check on deadline_states(next_check_at) where next_check_at is not null;
alter table users add column if not exists last_digest_on date;
alter table deadline_states drop column if exists severity_override;
-- When the last check-in ("Finished X?", "Time to start X") was sent; cleared once answered. The open app
-- shows unanswered ones as alerts.
alter table deadline_states add column if not exists checkin_sent_at timestamptz;

-- Your severity choices, remembered per event name ("gym" → low), so repeating events keep them.
create table if not exists severity_rules (
  user_id uuid not null references users(id) on delete cascade,
  title_key text not null,
  severity text not null check (severity in ('low', 'medium', 'high', 'critical')),
  primary key (user_id, title_key)
);

-- To-do list. A to-do can be given a block of time on the calendar (calendar_id/event_id), which then
-- shows up in Priorities like any other event.
create table if not exists todos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  title text not null,
  due_at timestamptz,
  minutes int not null default 60 check (minutes between 5 and 720), -- how long it takes, used when booking time
  done boolean not null default false,
  calendar_id text,
  event_id text,
  scheduled_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists todos_user on todos(user_id);

-- Auto-planner. auto = Almanac finds and keeps a time for this to-do; group_id ties together the parts of a task
-- that was split into sessions (kept on different days).
alter table todos add column if not exists auto boolean not null default false;
alter table todos add column if not exists group_id uuid;
alter table todos add column if not exists done_at timestamptz; -- when it was ticked off, for the week in review
alter table users add column if not exists last_review_on date; -- last Sunday the week-in-review notification went out
-- Focus time and habits ("Gym, 3 times a week, evenings"). Their blocks live only in Google Calendar, tagged
-- almanacPlan=routine:<id>, so no event data is stored here.
create table if not exists routines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  title text not null,
  minutes int not null check (minutes between 15 and 480),
  per_week int not null check (per_week between 1 and 7),
  time_of_day text not null default 'any' check (time_of_day in ('morning', 'afternoon', 'evening', 'any')),
  created_at timestamptz not null default now()
);
create index if not exists routines_user on routines(user_id);
alter table users add column if not exists planned_at timestamptz; -- last auto-plan run
-- Planning mode: 'ask' = the planner only suggests, and you approve each change; 'auto' = it books and moves by itself.
alter table users add column if not exists plan_mode text not null default 'ask' check (plan_mode in ('ask', 'auto'));
-- The planner's suggestions waiting for your OK. key = item + block + time, so the same suggestion keeps its id
-- across runs. "Not now" (dismissed_at) quiets suggestions for that item for 6 hours. Deleted once applied or stale.
create table if not exists plan_suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  key text not null,
  kind text not null check (kind in ('todo', 'routine')),
  item_id uuid not null,
  title text not null,
  reason text not null check (reason in ('new', 'clash', 'rollover')),
  from_calendar_id text, -- the block to move (null = book a new one)
  from_event_id text,
  from_start timestamptz,
  to_start timestamptz not null,
  to_end timestamptz not null,
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, key)
);

-- Google Sheet sync: which sheet feeds the calendar, and when it was last read. Events made from it are
-- marked inside Google Calendar itself (a private tag with the sheet id and row), so nothing else is stored.
alter table users add column if not exists sheet_id text;
alter table users add column if not exists sheet_synced_at timestamptz; -- last checked
alter table users add column if not exists sheet_name text;
alter table users add column if not exists sheet_version text; -- fingerprint of the cells at the last sync, to skip unchanged sheets

-- Row Level Security with no policies blocks Supabase's public API from these tables.
-- The app connects as the database owner, which is unaffected.
alter table users enable row level security;
alter table google_tokens enable row level security;
alter table push_subscriptions enable row level security;
alter table reminder_deliveries enable row level security;
alter table deadline_states enable row level security;
alter table severity_rules enable row level security;
alter table todos enable row level security;
alter table routines enable row level security;
alter table plan_suggestions enable row level security;
