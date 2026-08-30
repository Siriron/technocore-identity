import { readFileSync } from "node:fs";
import { didFromPublicKeyBytes } from "./src/crypto-core.js";

const vectors = JSON.parse(readFileSync("./did-fuzz-vectors.json", "utf-8"));

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

let failures = 0;
for (const vector of vectors) {
  const pubkeyBytes = hexToBytes(vector.pubkey_hex);
  const did = await didFromPublicKeyBytes(pubkeyBytes);
  const pass = did === vector.did;
  if (!pass) failures++;
  console.log(`[${pass ? "PASS" : "FAIL"}] seed=${vector.seed_hex.slice(0, 8)}… -> ${did}`);
  if (!pass) console.log(`  expected: ${vector.did}`);
}

console.log(`\n${vectors.length} vectors checked. ${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
