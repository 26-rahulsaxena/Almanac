import { describe, expect, it } from "vitest";
import { greeting } from "./time";

describe("greeting", () => {
  it("follows the hour, with each boundary starting the next greeting", () => {
    const at = (h: number) => greeting(h, "Rahul");
    expect([0, 4, 5, 7, 8, 11, 12, 16, 17, 20, 21, 23].map(at)).toEqual([
      "Up late, Rahul?", "Up late, Rahul?",
      "Early start, Rahul", "Early start, Rahul",
      "Good morning, Rahul", "Good morning, Rahul",
      "Good afternoon, Rahul", "Good afternoon, Rahul",
      "Good evening, Rahul", "Good evening, Rahul",
      "Winding down, Rahul?", "Winding down, Rahul?",
    ]);
  });
});
