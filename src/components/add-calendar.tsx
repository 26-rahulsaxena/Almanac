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
        <li>On a computer, open Google Calendar signed in with the account whose calendar you want to add.</li>
        <li>
          Click the <b>Settings</b> icon (⚙), then <b>Settings</b>.
        </li>
        <li>
          On the left, under <b>Settings for my calendars</b>, click the calendar, then <b>Shared with</b>.
        </li>
        <li>
          Click <b>Add people or groups</b> and type <span className="break-words">{email}</span>.
        </li>
        <li>
          For permission, pick <b>Make changes and see all event details</b>, then click <b>Send</b>.
        </li>
        <li>
          You&rsquo;ll get an email at <span className="break-words">{email}</span>. Open its link on a computer and agree.
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
