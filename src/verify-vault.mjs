import { encryptIdentity, decryptIdentity, VaultError } from "./src/identity-vault.js";

let failures = 0;
function check(label, pass) {
  if (!pass) failures++;
  console.log(`[${pass ? "PASS" : "FAIL"}] ${label}`);
}

async function run() {
  const fakePrivateKeyBytes = crypto.getRandomValues(new Uint8Array(48)); // PKCS8-ish size
  const did = "did:key:z6MkTestDidForVaultRoundTripCheckOnly1234567";
  const passphrase = "correct horse battery staple";

  const vault = await encryptIdentity(fakePrivateKeyBytes, did, passphrase);
  check("Vault has expected format tag", vault.format === "technocore-web-identity-v1");
  check("Vault stores DID in plaintext (public info)", vault.did === did);
  check("Vault does not contain raw key bytes as a field", !("privateKey" in vault));

  const decrypted = await decryptIdentity(vault, passphrase);
  check(
    "Decrypted bytes match original exactly",
    decrypted.length === fakePrivateKeyBytes.length &&
      decrypted.every((b, i) => b === fakePrivateKeyBytes[i])
  );

  // Wrong passphrase must fail, not silently return garbage
  try {
    await decryptIdentity(vault, "wrong passphrase entirely");
    check("Wrong passphrase correctly rejected", false);
  } catch (err) {
    check("Wrong passphrase correctly rejected", err instanceof VaultError);
  }

  // Tampered ciphertext must fail (AES-GCM auth tag)
  const tampered = { ...vault, ciphertext: vault.ciphertext.slice(0, -4) + "AAAA" };
  try {
    await decryptIdentity(tampered, passphrase);
    check("Tampered ciphertext correctly rejected", false);
  } catch (err) {
    check("Tampered ciphertext correctly rejected", err instanceof VaultError);
  }

  // Malformed file (missing fields) must fail cleanly
  try {
    await decryptIdentity({ format: "technocore-web-identity-v1" }, passphrase);
    check("Malformed vault correctly rejected", false);
  } catch (err) {
    check("Malformed vault correctly rejected", err instanceof VaultError);
  }

  // Wrong format tag must fail cleanly (e.g. someone uploads an unrelated JSON file)
  try {
    await decryptIdentity({ format: "something-else", foo: "bar" }, passphrase);
    check("Unrecognized format correctly rejected", false);
  } catch (err) {
    check("Unrecognized format correctly rejected", err instanceof VaultError);
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error("Test harness crashed:", err);
  process.exit(1);
});
