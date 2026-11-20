import { expect, test } from "vitest";
import { sceneVars } from "./home-scene";

test("the scene is night at midnight, day at noon, and every hour gives proper colours", () => {
  expect(sceneVars(0)["--night"]).toBe("1.000");
  expect(sceneVars(12)["--night"]).toBe("0.000");
  expect(sceneVars(24)).toEqual(sceneVars(0));
  for (let h = 0; h < 24; h += 0.25) expect(sceneVars(h)["--sky0"]).toMatch(/^#[0-9a-f]{6}$/);
});
