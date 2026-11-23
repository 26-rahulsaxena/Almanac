// The weather looks Home's scene can show (see /api/weather).
export type Weather = "clear" | "cloudy" | "fog" | "rain" | "snow" | "storm";
export const WEATHERS: Weather[] = ["clear", "cloudy", "fog", "rain", "snow", "storm"];

// WMO weather codes (Open-Meteo's weather_code) to the scene's looks.
export function weatherKind(code: number, cover: number): Weather {
  if (code >= 95) return "storm";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code >= 51) return "rain"; // drizzle 51–57, rain 61–67, showers 80–82
  if (code === 45 || code === 48) return "fog";
  return code >= 3 || cover >= 70 ? "cloudy" : "clear";
}
