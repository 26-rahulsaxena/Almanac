import { expect, test } from "vitest";
import { bodyOf, buildMime, parseAddresses, parseOutgoing, rowOf, type InboxAccount } from "./inbox";

const raw = (b64url: string) => Buffer.from(b64url, "base64url").toString("utf8");
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");

test("addresses: names dropped, separators accepted, junk refused", () => {
  expect(parseAddresses('Priya Shah <p@x.com>, q@y.co.in; "Z" <z@z.io>', "To")).toEqual(["p@x.com", "q@y.co.in", "z@z.io"]);
  expect(parseAddresses("", "Cc")).toEqual([]);
  expect(() => parseAddresses("not an address", "To")).toThrow(/isn't an email address/);
  // a header slipped in through a line break can't survive: each line must be a bare address
  expect(() => parseAddresses("a@b.com\r\nBcc: evil@x.com", "To")).toThrow();
});

test("an outgoing email needs someone to send to and something to say", () => {
  expect(() => parseOutgoing({ subject: "Hi", body: "x" })).toThrow(/who it's to/);
  expect(() => parseOutgoing({ to: "a@b.com" })).toThrow(/Write something/);
  expect(() => parseOutgoing({ to: Array.from({ length: 51 }, (_, i) => `p${i}@x.com`).join(","), body: "x" })).toThrow(/Up to 50/);
  expect(parseOutgoing({ to: "a@b.com", subject: " Hi ", body: "x" })).toMatchObject({ to: ["a@b.com"], subject: "Hi" });
});

test("the email Gmail sends: headers, a UTF-8 subject, the body in base64", () => {
  const m = raw(buildMime({ to: ["a@b.com"], cc: [], bcc: ["c@d.com"], subject: "Café at 4?", body: "Yes\nsee you", inReplyTo: "<1@x>", references: "<0@x> <1@x>" }));
  expect(m).toContain("To: a@b.com\r\n");
  expect(m).toContain("Bcc: c@d.com\r\n");
  expect(m).not.toContain("Cc: ");
  expect(m).toContain(`Subject: =?UTF-8?B?${Buffer.from("Café at 4?").toString("base64")}?=`);
  expect(m).toContain("In-Reply-To: <1@x>\r\nReferences: <0@x> <1@x>\r\n");
  expect(Buffer.from(m.split("\r\n\r\n")[1].replace(/\r\n/g, ""), "base64").toString()).toBe("Yes\r\nsee you");
  expect(raw(buildMime({ to: ["a@b.com"], cc: [], bcc: [], subject: "Plain", body: "" }))).toContain("Subject: Plain\r\n");
});

test("a subject with a line break is refused, never sent as an extra header", () => {
  expect(() => buildMime({ to: ["a@b.com"], cc: [], bcc: [], subject: "Hi\r\nBcc: evil@x.com", body: "" })).toThrow(/Line breaks/);
});

test("an email's HTML, text and attachments are found in Gmail's nested parts", () => {
  const p = {
    mimeType: "multipart/mixed",
    parts: [
      { mimeType: "multipart/alternative", parts: [{ mimeType: "text/plain", body: { data: b64("hello") } }, { mimeType: "text/html", body: { data: b64("<b>hello</b>") } }] },
      { mimeType: "application/pdf", filename: "plan.pdf", body: { attachmentId: "att1", size: 1234 } },
      { mimeType: "image/png", headers: [{ name: "Content-ID", value: "<ii_1>" }], body: { attachmentId: "att2", size: 99 } },
    ],
  };
  expect(bodyOf(p)).toEqual({
    html: "<b>hello</b>",
    text: "hello",
    attachments: [
      { id: "att1", name: "plan.pdf", mime: "application/pdf", size: 1234, cid: null },
      { id: "att2", name: "picture", mime: "image/png", size: 99, cid: "ii_1" }, // a picture shown inside the email
    ],
  });
});

test("a conversation's row: first subject, latest date, who's in it, unread if any message is", () => {
  const a: InboxAccount = { id: "acc", main: true, email: "me@x.com", send: true };
  const msg = (from: string, at: number, labels: string[], subject = "") => ({
    id: String(at),
    threadId: "t",
    internalDate: String(at),
    labelIds: labels,
    payload: { headers: [{ name: "From", value: from }, ...(subject ? [{ name: "Subject", value: subject }] : [])] },
  });
  const row = rowOf(a, "t", [msg("Priya Shah <p@y.com>", 1000, ["INBOX"], "Lunch?"), msg("Me <me@x.com>", 2000, ["INBOX", "UNREAD", "STARRED"])], "It&#39;s on &amp; fine");
  expect(row).toMatchObject({ subject: "Lunch?", people: "Priya, me (2)", unread: true, starred: true, inbox: true, count: 2, snippet: "It's on & fine" });
  expect(row.date).toBe(new Date(2000).toISOString());
});
