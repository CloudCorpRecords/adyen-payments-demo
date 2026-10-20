// Adyen-style Sessions flow demo server. SIMULATED end to end.
//
// Mirrors the three parts Adyen documents for a Drop-in integration:
//   1. payment server  -> POST /api/sessions  (create a checkout session)
//   2. client website  -> GET  /              (mock payment UI, see public/index.html)
//   3. webhook server  -> POST /api/webhooks/notifications (HMAC verified)
//
// No real Adyen credentials exist here and none are used. The client UI is a
// SIMULATED Drop-in style form, not Adyen's Web Drop-in component.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decideOutcome, expiryValid, luhnValid } from "./cards.ts";
import { signNotification, verifyNotification } from "./hmac.ts";
import { notifications, sessions } from "./store.ts";
import type {
  Amount,
  CardDetails,
  CreateSessionRequest,
  IncomingNotification,
  NotificationItem,
  SessionRecord,
} from "./types.ts";

const SESSION_TTL_MS = 30 * 60 * 1000;
const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(HERE, "..", "public");

type ApiError = { error: string; detail?: string };

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-length": Buffer.byteLength(text),
    "content-type": "application/json; charset=utf-8",
  });
  res.end(text);
}

function sendText(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, {
    "content-length": Buffer.byteLength(text),
    "content-type": "text/plain; charset=utf-8",
  });
  res.end(text);
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("Request body is not valid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function isAmount(value: unknown): value is Amount {
  if (typeof value !== "object" || value === null) return false;
  const a = value as Record<string, unknown>;
  return (
    typeof a.currency === "string" &&
    /^[A-Z]{3}$/.test(a.currency) &&
    typeof a.value === "number" &&
    Number.isInteger(a.value) &&
    a.value > 0
  );
}

type SessionCheck = { ok: true; value: CreateSessionRequest } | { ok: false; error: ApiError };

function validateSessionRequest(body: unknown): SessionCheck {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: { error: "Body must be a JSON object" } };
  }
  const b = body as Record<string, unknown>;
  if (typeof b.merchantAccount !== "string" || b.merchantAccount.trim() === "") {
    return { ok: false, error: { error: "merchantAccount is required" } };
  }
  if (!isAmount(b.amount)) {
    return {
      ok: false,
      error: { error: "amount must be { currency: ISO 4217 code, value: positive integer in minor units }" },
    };
  }
  if (typeof b.reference !== "string" || b.reference.trim() === "") {
    return { ok: false, error: { error: "reference is required" } };
  }
  if (typeof b.returnUrl !== "string" || !/^https?:\/\//.test(b.returnUrl)) {
    return { ok: false, error: { error: "returnUrl must be an http(s) URL" } };
  }
  return {
    ok: true,
    value: {
      merchantAccount: b.merchantAccount.trim(),
      amount: b.amount,
      reference: b.reference.trim(),
      returnUrl: b.returnUrl,
      countryCode: typeof b.countryCode === "string" ? b.countryCode : "US",
      shopperReference: typeof b.shopperReference === "string" ? b.shopperReference : undefined,
    },
  };
}

type CardCheck = { ok: true; value: CardDetails } | { ok: false; error: ApiError };

function validateCard(body: unknown): CardCheck {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: { error: "paymentMethod must be a JSON object" } };
  }
  const b = body as Record<string, unknown>;
  if (b.type !== "scheme") {
    return { ok: false, error: { error: 'Only paymentMethod.type "scheme" is supported by this demo' } };
  }
  const number = String(b.number ?? "");
  if (!luhnValid(number)) {
    return { ok: false, error: { error: "Card number failed the Luhn check" } };
  }
  const month = String(b.expiryMonth ?? "");
  const year = String(b.expiryYear ?? "");
  if (!expiryValid(month, year)) {
    return { ok: false, error: { error: "Card expiry is invalid or in the past" } };
  }
  if (!/^\d{3,4}$/.test(String(b.cvc ?? ""))) {
    return { ok: false, error: { error: "cvc must be 3 or 4 digits" } };
  }
  if (typeof b.holderName !== "string" || b.holderName.trim() === "") {
    return { ok: false, error: { error: "holderName is required" } };
  }
  return {
    ok: true,
    value: {
      type: "scheme",
      number,
      expiryMonth: month,
      expiryYear: year,
      cvc: String(b.cvc),
      holderName: b.holderName.trim(),
    },
  };
}

// Build the AUTHORISATION notification exactly like a PSP would, then sign it.
// In production this arrives over the network; here we hand it to the same
// verify-and-store path the public webhook endpoint uses.
function emitAuthorisationNotification(session: SessionRecord, success: boolean): void {
  const item: NotificationItem = {
    eventCode: "AUTHORISATION",
    success,
    pspReference: session.pspReference ?? "",
    merchantReference: session.reference,
    merchantAccountCode: session.merchantAccount,
    amount: session.amount,
    eventDate: new Date().toISOString(),
  };
  const signature = signNotification(item);
  if (!verifyNotification(item, signature)) {
    throw new Error("Refusing to store a notification with an invalid signature");
  }
  notifications.push({ ...item, receivedAt: new Date().toISOString(), signatureValid: true });
}

async function handleCreateSession(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (e) {
    sendJson(res, 400, { error: (e as Error).message });
    return;
  }
  const parsed = validateSessionRequest(body);
  if (!parsed.ok) {
    sendJson(res, 400, parsed.error);
    return;
  }
  const v = parsed.value;
  const now = Date.now();
  const id = "sess_" + randomBytes(8).toString("hex");
  const record: SessionRecord = {
    id,
    sessionData: randomBytes(32).toString("base64url"),
    merchantAccount: v.merchantAccount,
    amount: v.amount,
    reference: v.reference,
    returnUrl: v.returnUrl,
    countryCode: v.countryCode ?? "US",
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
    status: "CREATED",
  };
  sessions.set(id, record);
  sendJson(res, 200, {
    id: record.id,
    sessionData: record.sessionData,
    amount: record.amount,
    reference: record.reference,
    expiresAt: new Date(record.expiresAt).toISOString(),
    mode: "SIMULATED",
  });
}

async function handlePayment(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (e) {
    sendJson(res, 400, { error: (e as Error).message });
    return;
  }
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const sessionId = String(b.sessionId ?? "");
  const session = sessions.get(sessionId);
  if (!session) {
    sendJson(res, 404, { error: "Unknown sessionId. Create a session first via POST /api/sessions." });
    return;
  }
  if (Date.now() > session.expiresAt) {
    sendJson(res, 410, { error: "Session expired. Create a new one." });
    return;
  }
  const card = validateCard(b.paymentMethod);
  if (!card.ok) {
    sendJson(res, 422, card.error);
    return;
  }
  const decision = decideOutcome(card.value.number);
  const pspReference = "SIM" + randomBytes(6).toString("hex").toUpperCase();
  session.pspReference = pspReference;
  session.status = decision.resultCode === "Authorised" ? "AUTHORISED" : "REFUSED";

  // The outcome notification is the source of truth, like a real webhook.
  emitAuthorisationNotification(session, decision.resultCode === "Authorised");

  const response: Record<string, unknown> = {
    resultCode: decision.resultCode,
    pspReference,
    merchantReference: session.reference,
    amount: session.amount,
    mode: "SIMULATED",
  };
  if (decision.resultCode === "Refused") {
    response.refusalReason = decision.refusalReason;
  }
  sendJson(res, 200, response);
}

async function handleWebhook(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (e) {
    sendJson(res, 400, { error: (e as Error).message });
    return;
  }
  const incoming = body as Partial<IncomingNotification>;
  if (!Array.isArray(incoming.notificationItems) || incoming.notificationItems.length === 0) {
    sendJson(res, 400, { error: "Expected { notificationItems: [...] }" });
    return;
  }
  for (const wrapper of incoming.notificationItems) {
    const item = wrapper?.NotificationRequestItem;
    const signature = item?.additionalData?.hmacSignature;
    if (!item || typeof signature !== "string") {
      sendJson(res, 400, { error: "Each item needs NotificationRequestItem.additionalData.hmacSignature" });
      return;
    }
    const rest: Record<string, unknown> = { ...item };
    delete rest.additionalData;
    const unsigned = rest as unknown as NotificationItem;
    if (!verifyNotification(unsigned, signature)) {
      sendJson(res, 401, { error: "Invalid HMAC signature. Notification rejected." });
      return;
    }
    notifications.push({
      ...unsigned,
      receivedAt: new Date().toISOString(),
      signatureValid: true,
    });
  }
  // Adyen expects the literal string [accepted] for a received webhook.
  sendText(res, 200, "[accepted]");
}

async function handleStatic(res: ServerResponse): Promise<void> {
  try {
    const html = await readFile(join(PUBLIC_DIR, "index.html"), "utf8");
    res.writeHead(200, {
      "content-length": Buffer.byteLength(html),
      "content-type": "text/html; charset=utf-8",
    });
    res.end(html);
  } catch {
    sendJson(res, 500, { error: "Client page missing" });
  }
}

function router(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;
  if (req.method === "GET" && path === "/") {
    void handleStatic(res);
    return;
  }
  if (req.method === "GET" && path === "/api/config") {
    sendJson(res, 200, {
      mode: "SIMULATED",
      merchantAccount: "DEMO_MERCHANT",
      supportedCurrencies: ["USD", "EUR", "GBP"],
      testCards: [
        { number: "4111 1111 1111 1111", outcome: "Authorised" },
        { number: "4000 0000 0000 0002", outcome: "Refused" },
      ],
      note: "Test cards are demo-only and do not correspond to Adyen test cards.",
    });
    return;
  }
  if (req.method === "GET" && path === "/api/notifications") {
    sendJson(res, 200, { count: notifications.length, notifications, mode: "SIMULATED" });
    return;
  }
  if (req.method === "POST" && path === "/api/sessions") {
    void handleCreateSession(req, res);
    return;
  }
  if (req.method === "POST" && path === "/api/payments") {
    void handlePayment(req, res);
    return;
  }
  if (req.method === "POST" && path === "/api/webhooks/notifications") {
    void handleWebhook(req, res);
    return;
  }
  sendJson(res, 404, { error: "Not found" });
}

export function start(port?: number): Server {
  const server = createServer(router);
  const listenPort = port ?? Number(process.env.PORT || 3000);
  server.listen(listenPort);
  return server;
}

const invokedAsMain = process.argv[1] === fileURLToPath(import.meta.url);
if (invokedAsMain) {
  const port = Number(process.env.PORT || 3000);
  start(port);
  console.log("Adyen-style sessions demo (SIMULATED) listening on http://localhost:" + port);
  console.log("No real Adyen credentials are used. Payments are simulated.");
}
