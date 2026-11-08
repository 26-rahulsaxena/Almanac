import { describe, expect, it } from "vitest";
import { cleanProfile, profileLine } from "./profile";

describe("profile", () => {
  it("keeps only known choices and short one-line text", () => {
    const p = cleanProfile({ role: " Librarian,\n head of archives " + "x".repeat(60), title: "  Asst.\nProfessor ", focus: ["Exams", "Hacking", "Exams"], note: "x".repeat(300) });
    expect(p).toEqual({ role: ("Librarian, head of archives " + "x".repeat(60)).slice(0, 60), title: "Asst. Professor", focus: ["Exams"], note: "x".repeat(200) });
    expect(cleanProfile(null)).toEqual({ role: "", title: "", focus: [], note: "" });
  });

  it("writes one line for the AI, empty when skipped", () => {
    expect(profileLine({ role: "Teacher / faculty", title: "Assistant Professor, Marketing", focus: ["Exams", "Classes"], note: 'Committee "meetings" matter less' })).toBe(
      "Teacher / faculty, Assistant Professor, Marketing. Cares most about: exams, classes. In their words: \"Committee 'meetings' matter less\"",
    );
    expect(profileLine({ role: "Librarian", title: "Head of archives" })).toBe("Librarian, Head of archives.");
    expect(profileLine({})).toBe("");
  });
});
