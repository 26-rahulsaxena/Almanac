import { createVerify, generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({
  project_id: "almanac-test",
  client_email: "push@almanac-test.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
});
vi.mock("./db", () => ({ sql: () => [] }));
const { sendFcm } = await import("./fcm");
const { isFcmToken } = await import("./push");

afterEach(() => vi.unstubAllGlobals());

describe("Firebase sending", () => {
  it("signs in with the service account, then sends a data message", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url.includes("oauth2")) return Response.json({ access_token: "tok", expires_in: 3600 });
      return new Response("{}", { status: String(init.body).includes("gone-phone") ? 404 : 200 });
    });

    expect(await sendFcm("phone-1", { id: "r1", title: "Standup", alarm: true })).toBe("ok");
    const jwt = new URLSearchParams(calls[0].init.body as URLSearchParams).get("assertion")!;
    const [h, c, sig] = jwt.split(".");
    expect(createVerify("RSA-SHA256").update(`${h}.${c}`).verify(publicKey, sig, "base64url")).toBe(true);
    expect(JSON.parse(Buffer.from(c, "base64url").toString()).scope).toContain("firebase.messaging");

    expect(calls[1].url).toBe("https://fcm.googleapis.com/v1/projects/almanac-test/messages:send");
    expect((calls[1].init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    const { message } = JSON.parse(calls[1].init.body as string);
    expect(message.token).toBe("phone-1");
    expect(JSON.parse(message.data.json)).toEqual({ id: "r1", title: "Standup", alarm: true });
    expect(message.android.priority).toBe("HIGH");

    // The sign-in is reused, and an uninstalled app reports "gone".
    expect(await sendFcm("gone-phone", { title: "x" })).toBe("gone");
    expect(calls.filter((x) => x.url.includes("oauth2"))).toHaveLength(1);
  });

  it("accepts only token-shaped strings", () => {
    expect(isFcmToken("dXk2:APA91bH-abc_DEF123456789")).toBe(true);
    for (const bad of ["short", "has space in it here!!", "a".repeat(5000), 42, null]) expect(isFcmToken(bad)).toBe(false);
  });
});
