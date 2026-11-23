import { expect, test } from "vitest";
import { weatherKind } from "./weather";
import { sceneVars } from "../components/home-scene";

test("WMO codes map to the scene's looks", () => {
  expect(weatherKind(0, 10)).toBe("clear");
  expect(weatherKind(1, 80)).toBe("cloudy");
  expect(weatherKind(3, 0)).toBe("cloudy");
  expect(weatherKind(45, 0)).toBe("fog");
  expect(weatherKind(53, 100)).toBe("rain");
  expect(weatherKind(81, 100)).toBe("rain");
  expect(weatherKind(73, 100)).toBe("snow");
  expect(weatherKind(86, 100)).toBe("snow");
  expect(weatherKind(95, 100)).toBe("storm");
});

test("weather greys the sky but leaves clear days alone", () => {
  expect(sceneVars(12, 0)).toEqual(sceneVars(12));
  expect(sceneVars(12, 0.7)["--sky0"]).not.toBe(sceneVars(12)["--sky0"]);
});
