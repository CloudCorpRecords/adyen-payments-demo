// End to end tests: real HTTP against a live server on an ephemeral port.
// No mocks of the app itself; fetch is the only client.
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { signNotification } from "../src/hmac.ts";
import { clearStores } from "../src/store.ts";
import { start } from "../src/server.ts";
import type { NotificationItem } from "../src/types.ts";

let server: Server;
let base: string;

function post(path: string, body: unknown) {
  return fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function createSession(overrides: Record<string, unknown> = {}) {
  const res = await post("/api/sessions", {
    merchantAccount: "DEMO_MERCHANT",
    amount: { currency: "USD", value: 1999 },
    reference: "order-" + Date.now() + "-" + Math.floor(Math.random() * 1e6),
    returnUrl: "https://example.com/done",
    countryCode: "US",
    ...overrides,
  });
  const data = (await res.json()) as Record<string, any>;
  return { res, data };
}

function card(number: string) {
  return {
    type: "scheme",
    number,
    expiryMonth: "12",
    expiryYear: "2030",
    cvc: "737",
    holderName: "Simon Hopper",
  };
}

describe("server", () => {
  before(async () => {
    server = start(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const addr = server.address() as AddressInfo;
    base = "http://127.0.0.1:" + addr.port;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  beforeEach(() => clearStores());

  it("serves the client page with the simulated banner", async () => {
    const res = await fetch(base + "/");
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /SIMULATED DEMO/);
  });

  it("GET /api/config describes the simulated mode", async () => {
    const res = await fetch(base + "/api/config");
    const data = (await res.json()) as Record<string, any>;
    assert.equal(data.mode, "SIMULATED");
    assert.ok(Array.isArray(data.testCards) && data.testCards.length === 2);
  });

  it("creates a session and echoes the amount", async () => {
    const { res, data } = await createSession();
    assert.equal(res.status, 200);
    assert.match(data.id, /^sess_/);
    assert.ok(typeof data.sessionData === "string" && data.sessionData.length > 10);
    assert.deepEqual(data.amount, { currency: "USD", value: 1999 });
    assert.equal(data.mode, "SIMULATED");
  });

  it("rejects bad session requests with 400", async () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ["missing merchantAccount", { amount: { currency: "USD", value: 100 }, reference: "r", returnUrl: "https://x.test/" }],
      ["lowercase currency", { merchantAccount: "m", amount: { currency: "usd", value: 100 }, reference: "r", returnUrl: "https://x.test/" }],
      ["zero value", { merchantAccount: "m", amount: { currency: "USD", value: 0 }, reference: "r", returnUrl: "https://x.test/" }],
      ["bad returnUrl", { merchantAccount: "m", amount: { currency: "USD", value: 100 }, reference: "r", returnUrl: "not-a-url" }],
    ];
    for (const [name, body] of cases) {
      const res = await post("/api/sessions", body);
      assert.equal(res.status, 400, name);
      const data = (await res.json()) as Record<string, any>;
      assert.ok(typeof data.error === "string" && data.error.length > 0, name);
    }
  });

  it("rejects invalid JSON with 400", async () => {
    const res = await fetch(base + "/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{oops",
    });
    assert.equal(res.status, 400);
  });

  it("authorises the 1111 card and records a verified webhook", async () => {
    const { data: session } = await createSession();
    const res = await post("/api/payments", { sessionId: session.id, paymentMethod: card("4111111111111111") });
    assert.equal(res.status, 200);
    const data = (await res.json()) as Record<string, any>;
    assert.equal(data.resultCode, "Authorised");
    assert.match(data.pspReference, /^SIM[0-9A-F]+$/);
    assert.equal(data.merchantReference, session.reference);

    const hooks = (await (await fetch(base + "/api/notifications")).json()) as Record<string, any>;
    assert.equal(hooks.count, 1);
    assert.equal(hooks.notifications[0].eventCode, "AUTHORISATION");
    assert.equal(hooks.notifications[0].success, true);
    assert.equal(hooks.notifications[0].signatureValid, true);
  });

  it("refuses the 0002 card with a refusal reason", async () => {
    const { data: session } = await createSession();
    const res = await post("/api/payments", { sessionId: session.id, paymentMethod: card("4000000000000002") });
    assert.equal(res.status, 200);
    const data = (await res.json()) as Record<string, any>;
    assert.equal(data.resultCode, "Refused");
    assert.ok(typeof data.refusalReason === "string" && data.refusalReason.length > 0);

    const hooks = (await (await fetch(base + "/api/notifications")).json()) as Record<string, any>;
    assert.equal(hooks.notifications[0].success, false);
  });

  it("rejects a Luhn-invalid card with 422", async () => {
    const { data: session } = await createSession();
    const res = await post("/api/payments", { sessionId: session.id, paymentMethod: card("4111111111111112") });
    assert.equal(res.status, 422);
  });

  it("rejects an expired card with 422", async () => {
    const { data: session } = await createSession();
    const res = await post("/api/payments", {
      sessionId: session.id,
      paymentMethod: { ...card("4111111111111111"), expiryMonth: "01", expiryYear: "2000" },
    });
    assert.equal(res.status, 422);
  });

  it("returns 404 for an unknown session", async () => {
    const res = await post("/api/payments", { sessionId: "sess_nope", paymentMethod: card("4111111111111111") });
    assert.equal(res.status, 404);
  });

  it("accepts a correctly signed external webhook with [accepted]", async () => {
    const item: NotificationItem = {
      eventCode: "AUTHORISATION",
      success: true,
      pspReference: "SIMEXT123456",
      merchantReference: "order-external",
      merchantAccountCode: "DEMO_MERCHANT",
      amount: { currency: "EUR", value: 5000 },
      eventDate: new Date().toISOString(),
    };
    const res = await post("/api/webhooks/notifications", {
      notificationItems: [
        { NotificationRequestItem: { ...item, additionalData: { hmacSignature: signNotification(item) } } },
      ],
    });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "[accepted]");

    const hooks = (await (await fetch(base + "/api/notifications")).json()) as Record<string, any>;
    assert.equal(hooks.count, 1);
    assert.equal(hooks.notifications[0].pspReference, "SIMEXT123456");
  });

  it("rejects a tampered webhook with 401", async () => {
    const item: NotificationItem = {
      eventCode: "AUTHORISATION",
      success: true,
      pspReference: "SIMTAMPER",
      merchantReference: "order-tamper",
      merchantAccountCode: "DEMO_MERCHANT",
      amount: { currency: "USD", value: 100 },
      eventDate: new Date().toISOString(),
    };
    const sig = signNotification(item);
    const tampered = { ...item, amount: { currency: "USD", value: 999999 } };
    const res = await post("/api/webhooks/notifications", {
      notificationItems: [
        { NotificationRequestItem: { ...tampered, additionalData: { hmacSignature: sig } } },
      ],
    });
    assert.equal(res.status, 401);
    const hooks = (await (await fetch(base + "/api/notifications")).json()) as Record<string, any>;
    assert.equal(hooks.count, 0);
  });

  it("rejects a webhook with no signature with 400", async () => {
    const res = await post("/api/webhooks/notifications", {
      notificationItems: [{ NotificationRequestItem: { eventCode: "AUTHORISATION" } }],
    });
    assert.equal(res.status, 400);
  });
});
