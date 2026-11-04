import { expect, test } from "vitest";
import { plainText } from "./assistant";

test("markdown in a reply becomes plain readable text", () => {
  const reply = [
    "### Your free time",
    "",
    "| Day | Free |",
    "|-----|:----:|",
    "| **Thu 5 Nov** | 2:00 pm – 4:00 pm |",
    "",
    "* Book the *gym* at `6 pm`",
    "• Read notes<br>first",
    "",
    "",
    "",
    "Shall I go ahead?",
  ].join("\n");
  expect(plainText(reply)).toBe(
    ["Your free time", "", "Day · Free", "Thu 5 Nov · 2:00 pm – 4:00 pm", "", "- Book the gym at 6 pm", "- Read notes first", "", "Shall I go ahead?"].join("\n"),
  );
});

test("leaves ordinary text alone", () => {
  const s = "- Wed 4 Nov, 3:00 pm: Team meeting\n- 2*3 = 6, file_name stays";
  expect(plainText(s)).toBe(s);
});
