const s = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

const IDEAS = [
  {
    title: "Never miss what matters",
    text: "Your Google Calendar and to-dos, in one place.",
    art: (
      <>
        <rect x="8" y="10" width="48" height="46" rx="11" {...s} />
        <path d="M8 22h48M20 6v8M44 6v8" {...s} />
        <path d="m22 38 6 6 14-14" {...s} strokeWidth={2.4} />
        <circle cx="52" cy="14" r="6" fill="var(--accent)" stroke="var(--surface)" strokeWidth="2" />
      </>
    ),
  },
  {
    title: "Just say it",
    text: "Tap Ask Almanac and say “Dentist Friday 4 pm”.",
    art: (
      <>
        <rect x="24" y="8" width="16" height="30" rx="8" {...s} />
        <path d="M16 30a16 16 0 0 0 32 0M32 46v10M24 56h16" {...s} />
        <path d="M52 18c3 3 3 9 0 12M57 13c6 6 6 16 0 22" {...s} stroke="var(--accent)" />
      </>
    ),
  },
  {
    title: "It tells you what’s next",
    text: "“What now?” picks your next task and plans to-dos into free time.",
    art: (
      <>
        <rect x="8" y="12" width="48" height="10" rx="5" fill="var(--accent)" />
        <rect x="8" y="28" width="38" height="10" rx="5" {...s} />
        <rect x="8" y="44" width="28" height="10" rx="5" {...s} />
        <path d="M14 17h20" stroke="var(--surface)" strokeWidth="2.4" strokeLinecap="round" />
      </>
    ),
  },
  {
    title: "It won’t let you forget",
    text: "Reminders keep coming until it’s done, even when the app is closed.",
    art: (
      <>
        <path d="M20 44V30a12 12 0 0 1 24 0v14l4 5H16Z" {...s} />
        <path d="M28 54a4 4 0 0 0 8 0" {...s} />
        <path d="M10 22c1-6 4-10 8-13M54 22c-1-6-4-10-8-13" {...s} stroke="var(--accent)" />
      </>
    ),
  },
];

// "How it works": the four main ideas on one page. First screen of the Welcome, and in Settings → General.
export function HowItWorks() {
  return (
    <ul className="space-y-4">
      {IDEAS.map((c) => (
        <li key={c.title} className="flex items-start gap-3">
          <span className="grid size-12 shrink-0 place-items-center rounded-full bg-ink/5 text-ink" aria-hidden>
            <svg viewBox="0 0 64 64" className="size-7">
              {c.art}
            </svg>
          </span>
          <span>
            <span className="block text-sm font-medium">{c.title}</span>
            <span className="block text-sm text-muted">{c.text}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
