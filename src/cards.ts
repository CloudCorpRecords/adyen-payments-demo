// Card validation and the SIMULATED decision table.
// Real Adyen test cards live in Adyen's docs; here we use our own small,
// documented rule set so nothing is presented as Adyen's behavior:
//
//   Luhn-valid PAN ending in 1111 -> Authorised
//   Luhn-valid PAN ending in 0002 -> Refused (simulated issuer decline)
//   Any other Luhn-valid PAN      -> Refused (simulated decline)
//
// Invalid PANs and expired cards are rejected with 422 before any decision.

export function luhnValid(pan: string): boolean {
  const digits = pan.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let doubleDigit = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (doubleDigit) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    doubleDigit = !doubleDigit;
  }
  return sum % 10 === 0;
}

export function expiryValid(month: string, year: string): boolean {
  if (!/^(0[1-9]|1[0-2])$/.test(month)) return false;
  let fullYear: number;
  if (/^\d{2}$/.test(year)) fullYear = 2000 + Number(year);
  else if (/^\d{4}$/.test(year)) fullYear = Number(year);
  else return false;
  const now = new Date();
  const endOfMonth = new Date(fullYear, Number(month), 1);
  return endOfMonth > now;
}

export type Decision =
  | { resultCode: "Authorised" }
  | { resultCode: "Refused"; refusalReason: string };

// Assumes the PAN already passed luhnValid.
export function decideOutcome(pan: string): Decision {
  const digits = pan.replace(/\D/g, "");
  if (digits.endsWith("1111")) return { resultCode: "Authorised" };
  if (digits.endsWith("0002")) {
    return {
      resultCode: "Refused",
      refusalReason: "Simulated refusal: test card ending 0002",
    };
  }
  return {
    resultCode: "Refused",
    refusalReason: "Simulated decline: unrecognized test card",
  };
}
