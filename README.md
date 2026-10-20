# Adyen-style Sessions Flow Demo (DevRel teaching kit)

**Independent prototype built from Adyen's public documentation. Not affiliated with Adyen. Payments are simulated, no real Adyen API credentials are used.**

A compact, runnable teaching demo of the online-payments Sessions flow that Adyen documents for its Drop-in integration: a server creates a checkout session, a client-side payment form collects card details, and a webhook endpoint confirms the outcome with an HMAC signature check. Built as the kind of sample a Developer Relations Engineer would ship: small enough to read in one sitting, honest about every seam.

## Architecture

Three parts, matching how Adyen structures the integration in its docs:

1. **Payment server** (`src/server.ts`): `POST /api/sessions` validates the order (merchant account, amount in minor units, reference, return URL) and returns an opaque `sessionData` token, mirroring Adyen's `POST /sessions` shape.
2. **Client website** (`public/index.html`): a mock Drop-in style card form (clearly labeled simulated, not Adyen's Web Drop-in component) that submits to `POST /api/payments` and renders the `resultCode`.
3. **Webhook server** (`src/server.ts`): `POST /api/webhooks/notifications` verifies an HMAC-SHA256 signature on every incoming notification before trusting it, and answers with the literal `[accepted]` that Adyen expects.

Supporting modules: `src/hmac.ts` (sign/verify, constant-time compare), `src/cards.ts` (Luhn check, expiry check, simulated decision table), `src/store.ts` (in-memory sessions with 30 minute TTL, verified notification log), `src/types.ts` (shapes that mirror Adyen's public API vocabulary).

Zero runtime dependencies. TypeScript runs directly on Node 22.6+ via type stripping; tests use the built-in `node:test` runner.

## Run it in under 2 minutes

```bash
cd ~/workspace/job-search/prebuilt-proof/builds/adyen
npm test     # runs the suite, no install step needed
npm start    # serves the demo at http://localhost:3000
```

Then open http://localhost:3000, create a session, and pay with a demo card:

- `4111 1111 1111 1111` (any future expiry, any 3 digit CVC) -> **Authorised**
- `4000 0000 0000 0002` -> **Refused**

Watch the verified webhook log update on step 3 of the page, or query it directly:

```bash
curl -s http://localhost:3000/api/notifications | python3 -m json.tool
```

To use your own webhook signing key (hex, 32 bytes):

```bash
WEBHOOK_HMAC_KEY=<64 hex chars> npm start
```

## What is simulated vs real

**Simulated (demo-only, documented in code):**

- The "Adyen API" itself. There is no API key, no merchant account, no network call to Adyen. The `/sessions` and `/payments` endpoints reproduce the request/response *shape* of the documented flow, not the service.
- The payment decision. A small documented rule table: Luhn-valid cards ending in `1111` authorise, ending in `0002` are refused, anything else is declined. These are not Adyen's test cards and are labeled as demo-only in the UI and in `GET /api/config`.
- The client component. The card form imitates Drop-in's role in the flow; it is not Adyen's Web Drop-in library.

**Real:**

- The HMAC-SHA256 mechanism. Signatures are computed and verified with Node's `crypto`, compared in constant time, and tampered payloads are rejected with 401. The signed field set is simplified and documented as such.
- The integration pattern: session created server-side, payment submitted client-side, outcome confirmed from the webhook log rather than trusting the client response. That is the lesson the demo teaches, and it is how the real integration works.
- Input validation: Luhn check, expiry validation, amount/currency/returnUrl validation, session expiry.

## Test report (real run, 2026-10-19)

Command: `npm test` (`node --test tests/*.test.ts`)

```
tests 26, pass 26, fail 0, cancelled 0, skipped 0
```

Breakdown: 6 card validation tests, 7 HMAC signing tests, 13 end-to-end HTTP tests against a live server on an ephemeral port (session lifecycle, validation errors, authorised and refused payments, webhook accept/reject/tamper paths). No padded counts; the output above is the runner's own summary.

## 15-minute workshop outline (DevRel kit angle)

For a "First payment in 15 minutes" session, run live from this repo:

1. **(2 min) Why the Sessions flow exists.** One server call creates the session; the client component handles payment methods, 3D Secure, and result display. Draw the three boxes: payment server, client, webhook server.
2. **(3 min) Create a session.** `curl POST /api/sessions` with an amount and reference. Point at `sessionData`: opaque to the client, meaningful to the server. Show the validation errors by sending a bad currency.
3. **(4 min) Take a payment.** Use the mock form with both demo cards. Contrast `Authorised` vs `Refused` and show the `pspReference`. Ask: which of these two responses should your order system trust? (Neither yet.)
4. **(3 min) Webhooks are the source of truth.** Show `GET /api/notifications`. Tamper with a notification payload and re-sign it wrong; watch the 401. Explain why HMAC verification exists: the webhook URL is public, anyone can POST to it.
5. **(3 min) What changes with real Adyen.** API key in the test environment, real merchant account, the actual `@adyen/adyen-web` Drop-in component, Adyen's documented test card set, and going live. Everything in this repo maps one to one onto those steps.

Take-home line for the audience: never trust the browser for the payment outcome; the signed webhook is the receipt.
