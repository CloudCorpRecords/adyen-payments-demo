# WALKTHROUGH.md - Adyen DevRel demo

Five bullets to present from in an interview or on a call. Everything below is grounded in the actual code in this folder.

## The 5 bullets

1. **It teaches the exact shape Adyen documents.** Three parts: `POST /api/sessions` on the server, a client payment form, and an HMAC-verified webhook endpoint. I mirrored the documented Sessions/Drop-in flow (docs.adyen.com, Sessions flow integration guide) so a developer reading it learns the real integration pattern, not a toy.
2. **The webhook is the source of truth, and the demo proves why.** Every notification carries an HMAC-SHA256 signature verified in constant time (`src/hmac.ts`); tampered payloads get a 401 and are never stored. The workshop's punchline: never trust the browser for the payment outcome, the signed webhook is the receipt.
3. **Every seam is labeled.** The client form says SIMULATED and is not Adyen's Web Drop-in component; the test cards are demo-only and documented as not Adyen's; the README separates simulated from real in its own section. A DevRel sample that misleads developers is worse than no sample.
4. **It is a real, tested codebase.** 26 tests, all passing, including 13 end-to-end HTTP tests against a live server: session lifecycle, validation errors, authorised and refused payments, and the webhook accept/reject/tamper paths. Zero dependencies, runs with `npm test` and `npm start`.
5. **It is built to be taught from.** The README ships a 15-minute workshop outline ("First payment in 15 minutes") with timings, live curl commands, and the audience take-home line. That is the DevRel deliverable: not just code, but the session plan around it.

## Likely follow-ups, answered honestly

**"Is this a live Adyen integration?"**
No. There are no Adyen credentials anywhere in this repo and no calls to Adyen's API. It reproduces the documented flow shape with a simulated payment engine. I say that on the page banner, in the README, and in every file header, because a sample must never imply a live integration.

**"Why didn't you use Adyen's real test environment?"**
No test credentials were available to me, so I built the honest version: a faithful structural simulation with every seam labeled. With a real test API key, the changes are mechanical: swap the simulated `/sessions` and `/payments` handlers for Adyen's Checkout API calls, drop in the real `@adyen/adyen-web` Drop-in component on the client, and use Adyen's documented test card set. The webhook verification logic and the workshop outline transfer directly.

**"Walk me through the HMAC verification."**
The server builds a colon-joined payload string from the notification fields (`src/hmac.ts`, `notificationPayload`), computes HMAC-SHA256 with the shared key, and compares against the submitted signature with `timingSafeEqual` so a wrong signature fails safely. The signed field set is simplified relative to Adyen's documented one; that simplification is called out in the code comment.

**"What would you change before this became an official sample?"**
Add the real Adyen test credentials path behind an env flag, expand the signed field set to Adyen's full documented list, add 3D Secure redirect handling to the client, and record a 5-minute walkthrough video. The structure would not change.

**"What are the honest limits of this work?"**
Three: payments are simulated, so it cannot demonstrate real authorization behavior; my production hosting experience is Replit, local machines, and GitHub Actions CI rather than large-scale cloud payment infrastructure; and I have not run this against Adyen's live or test APIs. What it does demonstrate is the integration pattern, the security reasoning, and the ability to write a sample developers can actually learn from.

## One-line summary for the recruiter screen

"I built a runnable teaching demo of Adyen's documented Sessions/Drop-in flow, with HMAC-verified webhooks and a 15-minute workshop plan, so I could speak concretely about how I would do DevRel here."
