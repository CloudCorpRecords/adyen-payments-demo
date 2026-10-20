// HMAC-SHA256 signing and verification for simulated webhook notifications.
// Adyen documents HMAC-signed webhooks: each notification carries a signature
// your server must verify before trusting the payment outcome. This module
// implements the same IDEA on a simplified, documented field set so the demo
// teaches the mechanism without needing a real Adyen HMAC key.
//
// Payload string: eventCode:merchantReference:pspReference:success:amountValue:amountCurrency
// Signature: base64(HMAC-SHA256(payload, key)).
// The key is read from WEBHOOK_HMAC_KEY (hex). A fixed dev key is used when
// unset, and it is clearly a demo key, never a real credential.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { NotificationItem } from "./types.ts";

export const DEV_HMAC_KEY_HEX =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

export function getHmacKey(): Buffer {
  const hex = process.env.WEBHOOK_HMAC_KEY || DEV_HMAC_KEY_HEX;
  const key = Buffer.from(hex, "hex");
  if (key.length !== 32) {
    throw new Error("WEBHOOK_HMAC_KEY must be 32 bytes, hex encoded");
  }
  return key;
}

export function notificationPayload(item: NotificationItem): string {
  return [
    item.eventCode,
    item.merchantReference,
    item.pspReference,
    String(item.success),
    String(item.amount.value),
    item.amount.currency,
  ].join(":");
}

export function signNotification(
  item: NotificationItem,
  key: Buffer = getHmacKey(),
): string {
  return createHmac("sha256", key)
    .update(notificationPayload(item), "utf8")
    .digest("base64");
}

// Constant-time comparison so a wrong signature fails safely.
export function verifyNotification(
  item: NotificationItem,
  signature: string,
  key: Buffer = getHmacKey(),
): boolean {
  if (typeof signature !== "string" || signature.length === 0) return false;
  const expected = Buffer.from(signNotification(item, key), "utf8");
  const actual = Buffer.from(signature, "utf8");
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
