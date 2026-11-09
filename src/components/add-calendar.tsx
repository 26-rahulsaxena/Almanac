"use client";
import { Modal } from "./coach";

// Almanac shows every calendar in the signed-in Google account, so a calendar from another account comes in by
// sharing it with this one in Google. Nothing here talks to Google; it's the steps and two shortcuts.
export function AddCalendarHelp({ email, onClose }: { email: string; onClose: () => void }) {
  return (
    <Modal title="Add another account" onClose={onClose}>
      <p className="text-sm text-muted">
        Almanac shows every calendar in <span className="text-ink">{email}</span>. To see a calendar from another Google account here too,
        share it with this one. Once per calendar, about a minute.
      </p>
      <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm">
        <li>On a computer, open Google Calendar signed in with the other account.</li>
        <li>
          Under <b>My calendars</b>, point at the calendar, click <b>⋮</b>, then <b>Settings and sharing</b>.
        </li>
        <li>
          Under <b>Share with specific people</b>, add <span className="break-words">{email}</span> and pick <b>Make changes and see all event details</b>.
        </li>
        <li>
          Open Google&rsquo;s email in this account&rsquo;s inbox and click <b>Add this calendar</b>.
        </li>
        <li>Reload Almanac. The calendar appears in the menu with the others.</li>
      </ol>
      <p className="mt-4 text-xs text-muted">Work or college accounts may not allow sharing outside the organisation.</p>
      <div className="mt-5 flex flex-wrap gap-2">
        <a
          href="https://calendar.google.com/calendar/r/settings"
          target="_blank"
          rel="noreferrer"
          className="rounded-full bg-ink px-4 py-1.5 text-sm text-surface hover:bg-ink/85"
        >
          Open Google Calendar
        </a>
        <button type="button" onClick={() => location.reload()} className="rounded-full border border-line px-4 py-1.5 text-sm hover:border-ink/40">
          Reload Almanac
        </button>
      </div>
    </Modal>
  );
}
