// "About you": the person's role, title and what matters most to them, asked once in the welcome pop-up and
// editable in Settings. The AI reads it as one line when rating their priorities. Runs on the server and in the browser.

export const FOCUS = [
  "Exams",
  "Grading",
  "Assignments and submissions",
  "Classes",
  "Research",
  "Projects",
  "Students and parents",
  "Leadership meetings",
  "Accreditation and audits",
  "Faculty and staff",
  "Team meetings",
  "Clients",
  "Targets and reports",
  "Paperwork and deadlines",
  "Events",
  "Family",
  "Health",
] as const;
type Focus = (typeof FOCUS)[number];

// Each role with what's ticked for it to start with. "Other" lets people type their own role instead.
export const ROLES: [string, Focus[]][] = [
  ["Student", ["Exams", "Assignments and submissions", "Classes", "Projects"]],
  ["Teacher / faculty", ["Exams", "Grading", "Classes", "Research"]],
  ["Head of department / dean", ["Leadership meetings", "Accreditation and audits", "Faculty and staff", "Exams"]],
  ["Admin / office staff", ["Paperwork and deadlines", "Leadership meetings", "Events"]],
  ["Manager / team lead", ["Team meetings", "Paperwork and deadlines", "Leadership meetings", "Clients"]],
  ["Sales / client-facing", ["Clients", "Targets and reports", "Team meetings"]],
  ["Self-employed", ["Clients", "Paperwork and deadlines", "Family"]],
];

export const isRole = (r: unknown): r is string => ROLES.some(([x]) => x === r);

export type Profile = { role: string; title: string; focus: string[]; note: string };
export const EMPTY_PROFILE: Profile = { role: "", title: "", focus: [], note: "" };

const line = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

// Keeps only known choices and short one-line text (what's saved comes from the browser, so it's untrusted).
export function cleanProfile(raw: unknown): Profile {
  const p = (raw ?? {}) as Partial<Record<keyof Profile, unknown>>;
  const focus = Array.isArray(p.focus) ? FOCUS.filter((f) => (p.focus as unknown[]).includes(f)) : [];
  return {
    role: isRole(p.role) ? p.role : line(p.role, 60),
    title: line(p.title, 80),
    focus,
    note: line(p.note, 200),
  };
}

// The one line the AI gets, e.g. `Teacher / faculty, Assistant Professor. Cares most about: exams, classes.`
// Empty when nothing was filled in (skipped), so priorities work as before.
export function profileLine(raw: unknown) {
  const p = cleanProfile(raw);
  const who = [p.role, p.title].filter(Boolean).join(", ");
  return [
    who && `${who}.`,
    p.focus.length ? `Cares most about: ${p.focus.join(", ").toLowerCase()}.` : "",
    p.note && `In their words: "${p.note.replace(/"/g, "'")}"`,
  ]
    .filter(Boolean)
    .join(" ");
}
