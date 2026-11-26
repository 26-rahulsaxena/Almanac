// To-dos and Google Tasks are one list: every account that allowed full Tasks access takes part. A task added in
// any of them shows up as a to-do, and a new to-do becomes a task in the main account's. Almanac keeps what Google
// Tasks has no room for on the to-do itself: how long it takes, its booked block, auto-planning, sessions.
//
// A sync reads the tasks changed in Google since the last one (all of them the first time). A linked task whose
// "updated" stamp moved → the to-do takes Google's title, day and done (or goes, if the task was deleted).
// Otherwise, if the to-do no longer matches its signature from when the two last matched, it changed in Almanac
// (the list, Priorities, the assistant, email finds), so Google takes it. New open tasks become to-dos; new to-dos
// become tasks. A due time lives in task_times (Google keeps the day only).
import { deleteTask, localDayTime, TASKS, TASKS_API, taskJson, taskStatus, taskUrl, type TaskTime } from "./calendar";
import { sql } from "./db";
import { google, GoogleError, ReauthError } from "./google";
import { midnightIn } from "./reminders";

type GTask = { id: string; title?: string; due?: string; status?: string; updated: string; deleted?: boolean; selfLink?: string };
type Row = { id: string; title: string; due_at: Date | null; done: boolean; task_id: string | null; task_updated: string | null; task_sig: string | null };

const BY_DAY = 23 * 60 + 59; // "by Friday": a to-do due on a day, at no particular time
const UNTITLED = "(No title)";

// The to-do as Google Tasks fields, and the time of day Almanac keeps for it (null: none).
export function asTask(r: Pick<Row, "title" | "due_at" | "done">, timeZone: string) {
  const at = r.due_at && localDayTime(r.due_at.toISOString(), timeZone);
  const minutes = at && at.minutes !== 0 && at.minutes !== BY_DAY ? at.minutes : null;
  return { fields: { title: r.title, due: at ? `${at.day}T00:00:00.000Z` : null, ...taskStatus(r.done) }, minutes };
}

// The task as to-do fields.
export function asTodo(g: Pick<GTask, "title" | "due" | "status">, time: TaskTime | undefined, timeZone: string) {
  const day = g.due?.slice(0, 10);
  const due_at = !day ? null : time ? new Date(+midnightIn(day, time.time_zone) + time.minutes * 60_000) : new Date(+midnightIn(day, timeZone) + BY_DAY * 60_000);
  return { title: g.title || UNTITLED, due_at, done: g.status === "completed" };
}

// What of a to-do Google and task_times hold (title, day, done, time), to tell later whether it changed.
export function signature(r: Pick<Row, "title" | "due_at" | "done">, timeZone: string) {
  const { fields, minutes } = asTask(r, timeZone);
  return JSON.stringify([fields.title, fields.due, fields.status, minutes]);
}

type Account = { id: string; main: boolean; synced: Date | null };

// Runs one sync for this user, unless one is already running (two at once could add a to-do to Google twice).
export async function syncTasks(u: { id: string; timezone: string }) {
  const accounts = await sql<Account[]>`
    select id, is_main as main, tasks_synced_at as synced from google_accounts
    where user_id = ${u.id} and broken_at is null and scope ~ '/auth/tasks( |$)' order by is_main desc, created_at`;
  if (!accounts.length) return; // Tasks not allowed (yet): to-dos stay in Almanac only
  const [mine] = await sql`
    update users set tasks_sync_lock = now() where id = ${u.id} and (tasks_sync_lock is null or tasks_sync_lock < now() - interval '2 minutes')
    returning id`;
  if (!mine) return;
  try {
    for (const a of accounts) await sync(u, a);
  } finally {
    await sql`update users set tasks_sync_lock = null where id = ${u.id}`;
  }
}

// A to-do deleted in Almanac takes its task with it (a sync can't tell a deleted to-do from one never linked).
export const deleteLinkedTask = (userId: string, taskCal: string, taskId: string) => deleteTask(userId, taskCal, taskId);

// One account's tasks. New to-dos go to the main account's Google Tasks (taking part only when it allowed Tasks).
async function sync(u: { id: string; timezone: string }, a: Account) {
  const calendarId = TASKS + a.id;
  const call = <T>(url: string, init?: RequestInit) => google<T>(u.id, url, init, calendarId);
  const [[{ now }], lists] = await Promise.all([
    sql<{ now: Date }[]>`select now()`,
    call<{ items?: { id: string }[] }>(`${TASKS_API}/users/@me/lists?maxResults=100&fields=items(id)`),
  ]);
  // Changed since the last sync, a few minutes back in case Google's clock and ours differ; everything the first time.
  const since = a.synced && new Date(+a.synced - 5 * 60_000).toISOString();
  const tasks = new Map<string, GTask>(); // by "<list id>~<task id>"
  await Promise.all(
    (lists.items ?? []).map(async (l) => {
      let page = "";
      // shortcut: reads at most 1,000 changed tasks per list in one sync (the first one reads them all); the rest wait for a later sync only if nothing changes them again.
      for (let i = 0; i < 10; i++) {
        const q = new URLSearchParams({
          showCompleted: "true",
          showHidden: "true",
          showDeleted: "true", // so a task deleted in Google takes its to-do with it
          maxResults: "100",
          fields: "items(id,title,due,status,updated,deleted),nextPageToken",
          ...(since && { updatedMin: since }),
          ...(page && { pageToken: page }),
        });
        const r = await call<{ items?: GTask[]; nextPageToken?: string }>(`${TASKS_API}/lists/${encodeURIComponent(l.id)}/tasks?${q}`);
        for (const t of r.items ?? []) tasks.set(`${l.id}~${t.id}`, t);
        page = r.nextPageToken ?? "";
        if (!page) break;
      }
    }),
  );

  const [rows, timeRows, known] = await Promise.all([
    sql<Row[]>`
      select id, title, due_at, done, task_id, task_updated, task_sig from todos
      where user_id = ${u.id} and (task_cal = ${calendarId} or (${a.main} and task_id is null and not done))`,
    sql<(TaskTime & { task_id: string })[]>`select task_id, minutes, time_zone from task_times where user_id = ${u.id}`,
    sql<{ task_id: string }[]>`select task_id from todos where user_id = ${u.id} and task_id is not null`, // done ones older than the list shows too
  ]);
  const times = new Map(timeRows.map((t) => [t.task_id, t]));
  const linked = new Set(known.map((r) => r.task_id));

  // The time of day Almanac keeps for a task.
  async function setTime(key: string, minutes: number | null) {
    const id = key.slice(key.indexOf("~") + 1);
    if (minutes === null) await sql`delete from task_times where user_id = ${u.id} and task_id = ${id}`;
    else {
      await sql`
        insert into task_times (user_id, task_id, minutes, time_zone) values (${u.id}, ${id}, ${minutes}, ${u.timezone})
        on conflict (user_id, task_id) do update set minutes = excluded.minutes, time_zone = excluded.time_zone`;
    }
  }

  // Google takes the to-do: a new task in the default list, or the linked one changed.
  async function push(r: Row) {
    const { fields, minutes } = asTask(r, u.timezone);
    const g = r.task_id
      ? await call<GTask>(`${taskUrl(r.task_id)}?fields=id,updated`, taskJson("PATCH", fields))
      : await call<GTask>(`${TASKS_API}/lists/@default/tasks?fields=id,updated,selfLink`, taskJson("POST", fields));
    // The real list id (not "@default"), so the next read finds this task linked.
    const key = r.task_id ?? `${g.selfLink!.split("/lists/")[1].split("/")[0]}~${g.id}`;
    await sql`update todos set task_id = ${key}, task_cal = ${calendarId}, task_updated = ${g.updated}, task_sig = ${signature(r, u.timezone)} where id = ${r.id}`;
    linked.add(key);
    await setTime(key, minutes);
  }

  for (const r of rows) {
    const g = r.task_id ? tasks.get(r.task_id) : undefined;
    if (g && g.updated !== r.task_updated) {
      if (g.deleted) await sql`delete from todos where id = ${r.id}`; // its booked block (if any) stays, as when deleted in Almanac
      else {
        const t = asTodo(g, times.get(g.id), u.timezone);
        await sql`
          update todos set title = ${t.title}, due_at = ${t.due_at}, done = ${t.done}, task_updated = ${g.updated},
            task_sig = ${signature(t, u.timezone)}, done_at = case when not ${t.done} then null when done then done_at else now() end
          where id = ${r.id}`;
      }
    } else if (!r.task_id || signature(r, u.timezone) !== r.task_sig) {
      // One that fails waits for the next sync (its signature still differs); the rest go on.
      await push(r).catch(async (err) => {
        if (err instanceof ReauthError) throw err;
        if (err instanceof GoogleError && (err.status === 404 || err.status === 410)) await sql`delete from todos where id = ${r.id}`; // gone from Google
        else console.error("Google Tasks: couldn't save a to-do:", err);
      });
    }
  }

  // Tasks added in Google (open ones; finished or deleted ones aren't to-dos).
  for (const [key, g] of tasks) {
    if (linked.has(key) || g.deleted || g.status === "completed") continue;
    const t = asTodo(g, times.get(g.id), u.timezone);
    await sql`
      insert into todos (user_id, title, due_at, task_id, task_cal, task_updated, task_sig)
      values (${u.id}, ${t.title}, ${t.due_at}, ${key}, ${calendarId}, ${g.updated}, ${signature(t, u.timezone)})
      on conflict (user_id, task_id) where task_id is not null do nothing`;
  }
  await sql`update google_accounts set tasks_synced_at = ${now} where id = ${a.id}`;
}
