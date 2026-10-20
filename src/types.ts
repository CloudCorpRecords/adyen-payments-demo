// Shared shapes for the simulated Sessions flow.
// Field names mirror Adyen's public Checkout API vocabulary
// (sessions, sessionData, resultCode, pspReference, notificationItems)
// so the demo teaches the real integration shape. All values are simulated.

export type Amount = {
  currency: string; // ISO 4217, e.g. "USD"
  value: number; // minor units, e.g. 1999 = $19.99
};

export type CreateSessionRequest = {
  merchantAccount: string;
  amount: Amount;
  reference: string; // your order reference
  returnUrl: string;
  countryCode?: string; // default "US"
  shopperReference?: string;
};

export type SessionRecord = {
  id: string;
  sessionData: string; // opaque simulated token, like Adyen's sessionData
  merchantAccount: string;
  amount: Amount;
  reference: string;
  returnUrl: string;
  countryCode: string;
  createdAt: number;
  expiresAt: number;
  status: "CREATED" | "AUTHORISED" | "REFUSED";
  pspReference?: string;
};

export type CardDetails = {
  type: "scheme";
  number: string;
  expiryMonth: string;
  expiryYear: string;
  cvc: string;
  holderName: string;
};

export type PaymentResult = {
  resultCode: "Authorised" | "Refused";
  pspReference: string;
  merchantReference: string;
  amount: Amount;
  refusalReason?: string;
  mode: "SIMULATED";
};

// Simplified notification item. Real Adyen notifications carry more fields;
// this keeps the HMAC lesson legible. See src/hmac.ts.
export type NotificationItem = {
  eventCode: string; // e.g. "AUTHORISATION"
  success: boolean;
  pspReference: string;
  merchantReference: string;
  merchantAccountCode: string;
  amount: Amount;
  eventDate: string; // ISO string
};

export type IncomingNotification = {
  notificationItems: Array<{
    NotificationRequestItem: NotificationItem & {
      additionalData: { hmacSignature: string };
    };
  }>;
};
