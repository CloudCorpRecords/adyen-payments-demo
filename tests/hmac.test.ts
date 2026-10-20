// Unit tests for the simulated HMAC webhook signing.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  getHmacKey,
  notificationPayload,
  signNotification,
  verifyNotification,
} from "../src/hmac.ts";
import type { NotificationItem } from "../src/types.ts";

function sampleItem(): NotificationItem {
  return {
    eventCode: "AUTHORISATION",
    success: true,
    pspReference: "SIMABCDEF1234",
    merchantReference: "order-1",
    merchantAccountCode: "DEMO_MERCHANT",
    amount: { currency: "USD", value: 1999 },
    eventDate: new Date().toISOString(),
  };
}

describe("hmac", () => {
  it("sign then verify round-trips", () => {
    const item = sampleItem();
    const sig = signNotification(item);
    assert.equal(verifyNotification(item, sig), true);
  });

  it("signature is base64 of 32 bytes", () => {
    const sig = signNotification(sampleItem());
    assert.equal(Buffer.from(sig, "base64").length, 32);
  });

  it("tampering with any signed field fails verification", () => {
    const item = sampleItem();
    const sig = signNotification(item);
    const tampered = { ...item, amount: { ...item.amount, value: 1 } };
    assert.equal(verifyNotification(tampered, sig), false);
    const flipped = { ...item, success: false };
    assert.equal(verifyNotification(flipped, sig), false);
  });

  it("a different key fails verification", () => {
    const item = sampleItem();
    const sig = signNotification(item);
    const otherKey = randomBytes(32);
    assert.equal(verifyNotification(item, sig, otherKey), false);
  });

  it("empty or missing signature fails", () => {
    const item = sampleItem();
    assert.equal(verifyNotification(item, ""), false);
    // @ts-expect-error intentionally wrong type
    assert.equal(verifyNotification(item, undefined), false);
  });

  it("payload string joins the documented fields with colons", () => {
    const item = sampleItem();
    assert.equal(
      notificationPayload(item),
      "AUTHORISATION:order-1:SIMABCDEF1234:true:1999:USD",
    );
  });

  it("default dev key is 32 bytes", () => {
    assert.equal(getHmacKey().length, 32);
  });
});
