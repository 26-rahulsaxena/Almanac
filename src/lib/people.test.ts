import { expect, test, vi } from "vitest";
vi.mock("./db", () => ({ sql: () => [] }));
const { addressList, automated, tally } = await import("./people");

const msg = (at: number, h: Record<string, string>) => ({ internalDate: String(at), payload: { headers: Object.entries(h).map(([name, value]) => ({ name, value })) } });

test("address lists: quoted names with commas, bare addresses, case", () => {
  expect(addressList('"Shah, Priya" <P@X.com>, q@y.co.in, Ravi Kumar <ravi@z.io>')).toEqual([
    { name: "Shah, Priya", email: "p@x.com" },
    { name: "", email: "q@y.co.in" },
    { name: "Ravi Kumar", email: "ravi@z.io" },
  ]);
  expect(addressList("")).toEqual([]);
  expect(addressList("undisclosed-recipients:;")).toEqual([]);
});

test("people counted: who you wrote to, who wrote to you; newsletters, no-reply and you left out", () => {
  const mine = new Set(["me@x.com"]);
  const t = tally(
    [
      msg(1000, { From: "Me <me@x.com>", To: "Priya <p@y.com>, me@x.com", Cc: "q@z.com" }),
      msg(2000, { From: "Priya Shah <p@y.com>", To: "me@x.com" }),
      msg(3000, { From: "Shop <news@shop.com>", "List-Unsubscribe": "<mailto:u@shop.com>" }),
      msg(4000, { From: "Bank <no-reply@bank.com>" }),
    ],
    mine,
  );
  expect([...t.keys()].sort()).toEqual(["p@y.com", "q@z.com"]);
  expect(t.get("p@y.com")).toEqual({ name: "Priya Shah", sent: 1, received: 1, last: 2000 }); // the newest name wins
  expect(t.get("q@z.com")).toEqual({ name: "", sent: 1, received: 0, last: 1000 });
});

test("company addresses that only ever wrote to you aren't people", () => {
  for (const a of ["partner@rapido.bike", "service@updates.paypal.com", "connect@easemytrip.com", "alerts@hdfcbank.net", "info@mail.shop.in"]) expect(automated(a)).toBe(true);
  for (const a of ["priya.shah@gmail.com", "28-rahul.saxena@fiib.edu.in", "infosys.hr@x.com"]) expect(automated(a)).toBe(false);
  const t = tally([{ internalDate: "1", payload: { headers: [{ name: "From", value: "Rapido <partner@rapido.bike>" }] } }, { internalDate: "2", payload: { headers: [{ name: "From", value: "me@x.com" }, { name: "To", value: "support@shop.com" }] } }], new Set(["me@x.com"]));
  expect([...t.keys()]).toEqual(["support@shop.com"]); // written to: counts
});
