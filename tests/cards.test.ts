// Unit tests for card validation and the simulated decision table.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decideOutcome, expiryValid, luhnValid } from "../src/cards.ts";

describe("cards", () => {
  it("accepts known Luhn-valid PANs", () => {
    assert.equal(luhnValid("4111 1111 1111 1111"), true);
    assert.equal(luhnValid("4000000000000002"), true);
  });

  it("rejects PANs that fail Luhn", () => {
    assert.equal(luhnValid("4111 1111 1111 1112"), false);
    assert.equal(luhnValid("123"), false);
    assert.equal(luhnValid("not a card"), false);
  });

  it("validates expiry dates", () => {
    assert.equal(expiryValid("12", "2030"), true);
    assert.equal(expiryValid("01", "30"), true);
    assert.equal(expiryValid("13", "2030"), false);
    assert.equal(expiryValid("00", "2030"), false);
    assert.equal(expiryValid("01", "2000"), false);
    assert.equal(expiryValid("ab", "2030"), false);
  });

  it("authorises the 1111 test card", () => {
    assert.deepEqual(decideOutcome("4111111111111111"), { resultCode: "Authorised" });
  });

  it("refuses the 0002 test card with a reason", () => {
    const d = decideOutcome("4000000000000002");
    assert.equal(d.resultCode, "Refused");
    assert.match((d as { refusalReason: string }).refusalReason, /0002/);
  });

  it("refuses other Luhn-valid cards with a generic reason", () => {
    // 4242 4242 4242 4242 is Luhn-valid.
    const d = decideOutcome("4242424242424242");
    assert.equal(d.resultCode, "Refused");
    assert.ok((d as { refusalReason: string }).refusalReason.length > 0);
  });
});
