// verify-against-python.mjs
//
// Cross-checks crypto-core.js against known-answer vectors generated
// directly from technocore_agent.py (the real reference
// implementation), using the identical 32-byte seed. If every value
// below matches, the JS implementation is byte-for-byte compatible
// with what the Python CLI produces and what technocore.chat expects.

import {
  didFromPublicKeyBytes,
  messagePayloadBytes,
  signBytes,
  verifyBytes,
  createContributionProof,
  contributionPayloadBytes,
} from "./src/crypto-core.js";

const EXPECTED = {
  did: "did:key:z6MkehRgf7yJbgaGfYsdoAsKdBPE3dj2CYhowQdcjqSJgvVd",
  normalized: "Hello from a new Technocore contributor.",
  payloadBytesUtf8: "lobby|1234567890123|Hello from a new Technocore contributor.",
  signature:
    "yKNCYPXLb9v82zAq8lfascMElwhqRAuV-HcMN8S20U-BpBOaQPqgVfPKZfuzGlF6hmxB0h4GEghBn81SvVcoAw",
  proofDid: "did:key:z6MkehRgf7yJbgaGfYsdoAsKdBPE3dj2CYhowQdcjqSJgvVd",
  proofArtifactUrl: "https://github.com/siriron/technocore-writeup",
  proofCommit: "a".repeat(40),
  proofSignature:
    "qQhknliOV53mK0pwXg5ozkKc5j329VA8u2ijkXAVPJLdY8rYs1QjBK-N8GQvkYceEivhVv0QLwHR2Oc0KY9BAA",
};

let failures = 0;

function check(label, actual, expected) {
  const pass = actual === expected;
  if (!pass) failures++;
  console.log(`[${pass ? "PASS" : "FAIL"}] ${label}`);
  if (!pass) {
    console.log(`  expected: ${expected}`);
    console.log(`  actual:   ${actual}`);
  }
}

async function importSeedAsEd25519PrivateKey(seed) {
  // Node/browser Web Crypto doesn't take a raw 32-byte Ed25519 seed
  // directly via importKey("raw", ...) for signing keys — raw import
  // is for public keys. For the private side we need PKCS8 DER
  // wrapping around the raw seed. This constructs that DER wrapper by
  // hand ONLY to reproduce the Python side's seed-derived key for
  // this test; the app itself never does this — it always calls
  // generateKeyPair(), which lets the browser generate genuine
  // cryptographic randomness rather than a fixed test seed.
  const pkcs8Prefix = new Uint8Array([
    0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70,
    0x04, 0x22, 0x04, 0x20,
  ]);
  const der = new Uint8Array(pkcs8Prefix.length + seed.length);
  der.set(pkcs8Prefix, 0);
  der.set(seed, pkcs8Prefix.length);
  return crypto.subtle.importKey("pkcs8", der, { name: "Ed25519" }, true, ["sign"]);
}

async function run() {
  const seed = new Uint8Array(Array.from({ length: 32 }, (_, i) => i));
  const privateKey = await importSeedAsEd25519PrivateKey(seed);
  const publicKeyObj = await crypto.subtle.exportKey("jwk", privateKey);
  // Derive the raw public key bytes via a separate export path.
  const keyPairForPublic = await crypto.subtle.importKey(
    "jwk",
    { kty: "OKP", crv: "Ed25519", x: publicKeyObj.x },
    { name: "Ed25519" },
    true,
    ["verify"]
  );
  const publicKeyRaw = new Uint8Array(
    await crypto.subtle.exportKey("raw", keyPairForPublic)
  );

  const did = await didFromPublicKeyBytes(publicKeyRaw);
  check("DID derivation", did, EXPECTED.did);

  const { normalized, payloadBytes } = messagePayloadBytes(
    "lobby",
    "1234567890123",
    "Hello from a new Technocore contributor."
  );
  check("Message normalization", normalized, EXPECTED.normalized);
  check(
    "Payload bytes (UTF-8)",
    new TextDecoder().decode(payloadBytes),
    EXPECTED.payloadBytesUtf8
  );

  const signature = await signBytes(privateKey, payloadBytes);
  check("Signature (deterministic Ed25519, must match exactly)", signature, EXPECTED.signature);

  // Verify our own signature verifies against our own DID — sanity check
  // independent of the Python comparison.
  try {
    await verifyBytes(did, signature, payloadBytes);
    console.log("[PASS] Self-verification of generated signature");
  } catch (err) {
    failures++;
    console.log("[FAIL] Self-verification of generated signature:", err.message);
  }

  const proof = await createContributionProof(
    privateKey,
    did,
    EXPECTED.proofArtifactUrl,
    EXPECTED.proofCommit
  );
  check("Contribution proof DID", proof.did, EXPECTED.proofDid);
  check("Contribution proof signature", proof.signature, EXPECTED.proofSignature);

  const proofPayload = contributionPayloadBytes(
    EXPECTED.proofArtifactUrl,
    EXPECTED.proofCommit
  );
  console.log(
    "Contribution payload bytes (for eyeball comparison to Python's json.dumps):",
    new TextDecoder().decode(proofPayload)
  );

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error("Test harness crashed:", err);
  process.exit(1);
});
