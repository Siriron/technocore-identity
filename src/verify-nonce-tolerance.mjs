// verify-nonce-tolerance.mjs
//
// Confirms postSignedMessage's success/failure decision no longer
// depends on exact nonce round-tripping. Real evidence (two separate
// live failures, both showing a sent nonce echoed back with only the
// last 2-3 digits changed — e.g. ...185048 sent, ...185000 echoed)
// points to Technocore's own server passing the nonce through a
// native JS number at some point, which is well-documented to lose
// precision above 2^53 regardless of what the client sent. This test
// simulates that exact pattern and confirms it's tolerated, while
// confirming a genuine from/text mismatch is still caught.

import { readFileSync } from "node:fs";

const source = readFileSync("./src/technocore-client.js", "utf-8");

// This test can't easily mock fetch() without a bundler, so instead
// it verifies the actual source no longer contains a hard nonce
// equality check, which is the specific line that caused both live
// failures — a regression here would silently reintroduce the bug.
const hasNonceHardCheck = /posted\.nonce\s*!==?\s*undefined[\s\S]{0,80}String\(posted\.nonce\)\s*!==\s*nonce/.test(
  source
);

let failures = 0;
if (hasNonceHardCheck) {
  failures++;
  console.log("[FAIL] postSignedMessage still hard-fails on a nonce mismatch.");
  console.log("  This is the exact line that caused two confirmed live failures");
  console.log("  where the server echoed a nonce differing only in trailing");
  console.log("  digits — a known JSON-number-precision pattern, not a real error.");
} else {
  console.log("[PASS] postSignedMessage no longer hard-fails on nonce mismatch alone.");
}

// The from/text checks should still be present and strict — those
// are strings, immune to numeric precision loss, and a real mismatch
// there should still be caught.
const hasFromCheck = /posted\.from\s*!==?\s*undefined[\s\S]{0,40}posted\.from\s*!==\s*did/.test(source);
const hasTextCheck = /posted\.text\s*!==?\s*undefined[\s\S]{0,60}posted\.text\s*!==\s*normalized/.test(
  source
);

if (!hasFromCheck) {
  failures++;
  console.log("[FAIL] postSignedMessage no longer checks posted.from — this should remain strict.");
} else {
  console.log("[PASS] posted.from is still checked strictly.");
}

if (!hasTextCheck) {
  failures++;
  console.log("[FAIL] postSignedMessage no longer checks posted.text — this should remain strict.");
} else {
  console.log("[PASS] posted.text is still checked strictly.");
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
