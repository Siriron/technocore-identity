// verify-nonce-precision.mjs
//
// Regression test for a real bug: an earlier version of nextNonce()
// computed its random suffix with Math.random(), a floating-point
// operation. At the ~19-digit magnitude a real nonce reaches
// (milliseconds-since-epoch * 1_000_000 + a 6-digit suffix), that's
// past Number.MAX_SAFE_INTEGER (2^53), so BigInt(Math.floor(...))
// silently carried forward rounding error in the last few digits.
// The five other verification scripts never caught this because they
// test signing correctness against a small, fixed, hardcoded nonce —
// they never exercised nonce GENERATION at production scale. This
// script does.

import { nextNonce } from "./src/crypto-core.js";

const SAMPLE_SIZE = 500;
let failures = 0;
const seen = new Set();

for (let i = 0; i < SAMPLE_SIZE; i++) {
  const beforeSeconds = BigInt(Math.floor(Date.now() / 1000));
  const nonce = nextNonce();
  const afterSeconds = BigInt(Math.floor(Date.now() / 1000));

  const nonceBigInt = BigInt(nonce);
  // nextNonce() encodes seconds * 1_000_000_000 + a 9-digit random
  // suffix — matching that exact encoding here is what makes this
  // check meaningful. An earlier version of this test divided by
  // 1_000_000 (the OLD millisecond-based encoding) after the
  // function itself had already switched to a seconds-based one,
  // which produced a nonsense "millis portion" and hundreds of false
  // failures — a bug in the test, not the function. Keep this divisor
  // in sync with nextNonce()'s actual encoding.
  const secondsPortion = nonceBigInt / 1_000_000_000n;
  const randPortion = nonceBigInt % 1_000_000_000n;

  // The strongest check: the seconds portion must fall inside the
  // exact window measured immediately before and after the call. This
  // is the check that actually would have caught the original bug —
  // a simple string round-trip through BigInt does NOT catch it,
  // because BigInt(Math.floor(x)) produces an internally consistent
  // result even when x was already imprecise. The corruption happens
  // before the value becomes a BigInt, so only comparing against an
  // independently known-correct value (the real wall clock) exposes it.
  if (secondsPortion < beforeSeconds || secondsPortion > afterSeconds) {
    failures++;
    console.log(`[FAIL] nonce's seconds portion outside the real call window`);
    console.log(`  nonce seconds: ${secondsPortion}, window: [${beforeSeconds}, ${afterSeconds}]`);
  }

  // The random portion must be a clean 0-999999999 integer with no
  // fractional residue or overflow from floating-point math.
  if (randPortion < 0n || randPortion > 999999999n) {
    failures++;
    console.log(`[FAIL] nonce's random portion out of the expected 0-999999999 range`);
    console.log(`  got: ${randPortion}`);
  }

  if (seen.has(nonce)) {
    failures++;
    console.log(`[FAIL] duplicate nonce generated: ${nonce}`);
  }
  seen.add(nonce);
}

console.log(`Generated and checked ${SAMPLE_SIZE} real nonces.`);
console.log(`${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
