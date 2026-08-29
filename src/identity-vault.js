// identity-vault.js
//
// Encrypts the raw Ed25519 private key with a user passphrase, using
// only native SubtleCrypto primitives: PBKDF2 for key derivation,
// AES-256-GCM for authenticated encryption. This is NOT the same file
// format as technocore_agent.py's PKCS8/OpenSSL-encrypted PEM — browsers
// have no native API to produce that specific OpenSSL construction, so
// this uses the browser-native equivalent standard instead. A backup
// file made here will not load into the Python CLI, and vice versa.
// Pick one tool as your source of truth.
//
// The private key material touches three places in this file: the
// CryptoKey object from crypto-core.js, the derived AES key, and the
// plaintext bytes during encrypt/decrypt. None of it is ever passed to
// fetch(), console.log, or any storage that isn't the ciphertext this
// module produces.

const PBKDF2_ITERATIONS = 600_000; // OWASP-recommended floor for PBKDF2-SHA256, 2023+
const SALT_BYTES = 16;
const IV_BYTES = 12; // standard AES-GCM nonce size

class VaultError extends Error {}

async function deriveAesKey(passphrase, salt) {
  const passphraseBytes = new TextEncoder().encode(passphrase);
  const baseKey = await crypto.subtle.importKey(
    "raw",
    passphraseBytes,
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false, // not extractable — never leaves as raw key material
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypt a raw PKCS8 private key export with a passphrase.
 * Returns a JSON-serializable vault object suitable for a backup file.
 */
async function encryptIdentity(pkcs8PrivateKeyBytes, did, passphrase) {
  if (typeof passphrase !== "string" || passphrase.length < 12) {
    throw new VaultError("identity passphrase must contain at least 12 characters");
  }
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const aesKey = await deriveAesKey(passphrase, salt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    aesKey,
    pkcs8PrivateKeyBytes
  );
  return {
    format: "technocore-web-identity-v1",
    did,
    kdf: "PBKDF2-SHA256",
    iterations: PBKDF2_ITERATIONS,
    salt: bufferToBase64(salt),
    iv: bufferToBase64(iv),
    ciphertext: bufferToBase64(new Uint8Array(ciphertext)),
    created_at: new Date().toISOString(),
  };
}

/**
 * Decrypt a vault object back into raw PKCS8 private key bytes.
 * Throws VaultError on wrong passphrase or corrupted/tampered data —
 * AES-GCM's built-in authentication tag makes tampering detectable,
 * it doesn't silently decrypt to garbage.
 */
async function decryptIdentity(vault, passphrase) {
  if (!vault || vault.format !== "technocore-web-identity-v1") {
    throw new VaultError("not a recognized Technocore web identity backup file");
  }
  const requiredFields = ["salt", "iv", "ciphertext", "did", "iterations"];
  for (const field of requiredFields) {
    if (!(field in vault)) {
      throw new VaultError(`backup file is missing required field: ${field}`);
    }
  }
  const salt = base64ToBuffer(vault.salt);
  const iv = base64ToBuffer(vault.iv);
  const ciphertext = base64ToBuffer(vault.ciphertext);
  const aesKey = await deriveAesKeyWithIterations(
    passphrase,
    salt,
    vault.iterations
  );
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      aesKey,
      ciphertext
    );
    return new Uint8Array(plaintext);
  } catch {
    // AES-GCM throws on auth-tag mismatch — this covers both a wrong
    // passphrase and a corrupted/tampered file, indistinguishably,
    // which is the correct behavior (don't leak which one it was).
    throw new VaultError("incorrect passphrase or corrupted backup file");
  }
}

async function deriveAesKeyWithIterations(passphrase, salt, iterations) {
  const passphraseBytes = new TextEncoder().encode(passphrase);
  const baseKey = await crypto.subtle.importKey(
    "raw",
    passphraseBytes,
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

function bufferToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBuffer(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export { VaultError, encryptIdentity, decryptIdentity };
