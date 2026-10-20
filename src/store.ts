// In-memory stores. A teaching demo does not need a database;
// sessions expire after 30 minutes, like a real checkout session would.
import type { NotificationItem, SessionRecord } from "./types.ts";

export const sessions = new Map<string, SessionRecord>();

export type StoredNotification = NotificationItem & {
  receivedAt: string;
  signatureValid: true;
};

export const notifications: StoredNotification[] = [];

export function clearStores(): void {
  sessions.clear();
  notifications.length = 0;
}
