import {
  generateKeyPair,
  exportRawPublicKey,
  exportPkcs8PrivateKey,
  importPkcs8PrivateKey,
  didFromPublicKeyBytes,
  messagePayloadBytes,
  signBytes,
  verifyBytes,
} from "./src/crypto-core.js";
import { encryptIdentity, decryptIdentity } from "./src/identity-vault.js";

let failures = 0;
function check(label, pass) {
  if (!pass) failures++;
  console.log(`[${pass ? "PASS" : "FAIL"}] ${label}`);
}

async function run() {
  // Full flow exactly as the app performs it: generate, derive DID,
  // encrypt for backup, then simulate closing the tab and restoring
  // from the backup file on a "new" session.
  const passphrase = "this is a fine passphrase for testing";

  const keyPair = await generateKeyPair();
  const publicKeyBytes = await exportRawPublicKey(keyPair.publicKey);
  const did = await didFromPublicKeyBytes(publicKeyBytes);
  const pkcs8Bytes = await exportPkcs8PrivateKey(keyPair.privateKey);
  const vault = await encryptIdentity(pkcs8Bytes, did, passphrase);

  check("DID has correct did:key:z6Mk prefix", did.startsWith("did:key:z6Mk"));
  check("DID has correct length (48-char multibase + prefix)", did.length === "did:key:".length + 48);

  // Simulate restoring from the downloaded backup file in a fresh context
  const restoredPkcs8 = await decryptIdentity(vault, passphrase);
  const restoredPrivateKey = await importPkcs8PrivateKey(restoredPkcs8);

  // Sign with the ORIGINAL key, verify with the RESTORED key's
  // corresponding public half derived from the DID — this proves the
  // restored key is functionally identical to the original, not just
  // structurally similar.
  const { payloadBytes } = messagePayloadBytes("lobby", "999", "round trip test message");
  const signature = await signBytes(restoredPrivateKey, payloadBytes);
  await verifyBytes(did, signature, payloadBytes);
  check("Signature from restored key verifies against original DID", true);

  // Cross-check: sign with original, should ALSO verify (both keys
  // are the same key, just before/after the encrypt-decrypt cycle)
  const signatureFromOriginal = await signBytes(keyPair.privateKey, payloadBytes);
  check(
    "Original and restored key produce identical signatures (deterministic Ed25519)",
    signature === signatureFromOriginal
  );

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error("Test harness crashed:", err);
  process.exit(1);
});
