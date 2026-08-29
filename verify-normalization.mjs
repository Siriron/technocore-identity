import { normalizeMessage } from "./src/crypto-core.js";

const cases = [
  { input: "Hello\u200bWorld", expected: "Hello World" },
  { input: "Hello\tWorld\n", expected: "Hello World" },
  { input: "Hello\u00adWorld", expected: "Hello World" },
  { input: "  leading and trailing  ", expected: "leading and trailing" },
  { input: "Test\u2028line separator", expected: "Test line separator" },
];

let failures = 0;
for (const { input, expected } of cases) {
  let actual;
  try {
    actual = normalizeMessage(input);
  } catch (err) {
    actual = `ERROR: ${err.message}`;
  }
  const pass = actual === expected;
  if (!pass) failures++;
  console.log(`[${pass ? "PASS" : "FAIL"}] ${JSON.stringify(input)} -> ${JSON.stringify(actual)}`);
  if (!pass) console.log(`  expected: ${JSON.stringify(expected)}`);
}

// 4096-char boundary check
const atLimit = "A".repeat(4096);
const overLimit = "A".repeat(4097);
try {
  const result = normalizeMessage(atLimit);
  console.log(`[${result.length === 4096 ? "PASS" : "FAIL"}] 4096-char message accepted, length ${result.length}`);
} catch (err) {
  failures++;
  console.log(`[FAIL] 4096-char message should be accepted: ${err.message}`);
}
try {
  normalizeMessage(overLimit);
  failures++;
  console.log("[FAIL] 4097-char message should have been rejected");
} catch (err) {
  console.log(`[PASS] 4097-char message correctly rejected: ${err.message}`);
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
