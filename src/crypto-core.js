// crypto-core.js
//
// Mirrors technocore_agent.py's wire format exactly, so anything this
// module produces is byte-for-byte what the Python CLI would produce
// for the same inputs, and technocore.chat accepts either one
// identically.
//
// Uses only the browser's native Web Crypto (SubtleCrypto). Ed25519
// sign/verify is a standard Web Crypto algorithm as of 2024 (Chrome,
// Safari 17.4+, Firefox all support it natively) — no third-party
// crypto library, no hand-rolled elliptic-curve math. Base58btc below
// is pure data encoding, not a security primitive, so implementing it
// directly carries none of the risk hand-rolled *cryptography* would.

const MULTICODEC_ED25519 = new Uint8Array([0xed, 0x01]);
const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const MAX_MESSAGE_CHARS = 4096; // matches technocore_agent.py MAX_MESSAGE_CHARS exactly
const NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{86}$/;
const NONCE_PATTERN = /^[0-9]{1,19}$/;

class ProtocolError extends Error {}
class IdentityError extends Error {}

// ---- base58btc (Bitcoin alphabet), matching the Python encode/decode ----

function base58btcEncode(bytes) {
  if (bytes.length === 0) return "";
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;

  // Big-integer-free encode via repeated division, same approach the
  // reference implementation uses.
  let digits = [0];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let result = "1".repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i--) {
    result += BASE58_ALPHABET[digits[i]];
  }
  return result;
}

function base58btcDecode(value) {
  if (value.length === 0) return new Uint8Array();
  let zeros = 0;
  while (zeros < value.length && value[zeros] === "1") zeros++;

  let bytes = [0];
  for (let i = zeros; i < value.length; i++) {
    const charIndex = BASE58_ALPHABET.indexOf(value[i]);
    if (charIndex === -1) {
      throw new ProtocolError("invalid base58btc character");
    }
    let carry = charIndex;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  const leadingZeroBytes = new Array(zeros).fill(0);
  return new Uint8Array([...leadingZeroBytes, ...bytes.reverse()]);
}

// ---- did:key derivation (matches did_from_private_key / public_key_from_did) ----

async function didFromPublicKeyBytes(publicKeyBytes) {
  const prefixed = new Uint8Array(MULTICODEC_ED25519.length + publicKeyBytes.length);
  prefixed.set(MULTICODEC_ED25519, 0);
  prefixed.set(publicKeyBytes, MULTICODEC_ED25519.length);
  const multibase = "z" + base58btcEncode(prefixed);
  if (multibase.length !== 48 || !multibase.startsWith("z6Mk")) {
    throw new IdentityError("generated an invalid Ed25519 did:key");
  }
  return "did:key:" + multibase;
}

function publicKeyBytesFromDid(did) {
  const prefix = "did:key:";
  if (typeof did !== "string" || !did.startsWith(prefix)) {
    throw new ProtocolError("DID must start with 'did:key:z6Mk'");
  }
  const multibase = did.slice(prefix.length);
  if (multibase.length !== 48 || !multibase.startsWith("z6Mk")) {
    throw new ProtocolError(
      "DID must be the canonical 48-character Ed25519 multibase form"
    );
  }
  const decoded = base58btcDecode(multibase.slice(1));
  if (
    decoded.length !== 34 ||
    decoded[0] !== MULTICODEC_ED25519[0] ||
    decoded[1] !== MULTICODEC_ED25519[1]
  ) {
    throw new ProtocolError("DID must contain an ed25519-pub key");
  }
  return decoded.slice(2);
}

// ---- message normalization (matches normalize_message) ----

// Unicode categories the Python side treats as invisible/control and
// collapses to a space before signing. This mirrors the same
// intent: strip anything that could hide non-printing bytes inside a
// signed message.
const INVISIBLE_CATEGORY_REGEX =
  /[\u0000-\u001F\u007F-\u009F\u00AD\u200B-\u200F\u2028-\u202E\u2060-\u2064\uFEFF]/g;

function normalizeMessage(text) {
  if (typeof text !== "string") {
    throw new ProtocolError("message text must be a string");
  }
  const normalized = text.replace(INVISIBLE_CATEGORY_REGEX, " ").trim();
  if (!normalized) {
    throw new ProtocolError("message has no visible text after normalization");
  }
  if (normalized.length > MAX_MESSAGE_CHARS) {
    throw new ProtocolError(
      `message has ${normalized.length} characters; maximum is ${MAX_MESSAGE_CHARS}`
    );
  }
  return normalized;
}

function validateName(value, label = "room") {
  if (typeof value !== "string" || !NAME_PATTERN.test(value)) {
    throw new ProtocolError(`${label} must match ^[a-z0-9][a-z0-9_-]{0,47}$`);
  }
  return value;
}

function validateNonce(value) {
  const nonce = String(value);
  if (!NONCE_PATTERN.test(nonce)) {
    throw new ProtocolError("nonce must contain 1-19 ASCII digits");
  }
  return nonce;
}

function nextNonce() {
  // High-resolution wall-clock nonce, matching time.time_ns() in spirit.
  // Date.now() is milliseconds; pad with a random 6-digit suffix to
  // keep monotonic-ish uniqueness without claiming false nanosecond
  // precision the browser can't actually provide.
  const millis = BigInt(Date.now());
  const rand = BigInt(Math.floor(Math.random() * 1_000_000));
  const nonce = (millis * 1_000_000n + rand).toString();
  return validateNonce(nonce);
}

// ---- signing payload construction (matches message_payload) ----

function messagePayloadBytes(room, nonce, text) {
  const validRoom = validateName(room);
  const validNonce = validateNonce(nonce);
  const normalized = normalizeMessage(text);
  const payloadString = `${validRoom}|${validNonce}|${normalized}`;
  return { normalized, payloadBytes: new TextEncoder().encode(payloadString) };
}

// ---- Ed25519 sign/verify via native Web Crypto ----

async function generateKeyPair() {
  // Native browser Ed25519 support (Chrome, Safari 17.4+, Firefox).
  const keyPair = await crypto.subtle.generateKey(
    { name: "Ed25519" },
    true, // extractable — we need to export for the encrypted backup file
    ["sign", "verify"]
  );
  return keyPair;
}

async function exportRawPublicKey(publicKey) {
  const raw = await crypto.subtle.exportKey("raw", publicKey);
  return new Uint8Array(raw);
}

async function exportPkcs8PrivateKey(privateKey) {
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", privateKey);
  return new Uint8Array(pkcs8);
}

async function importPkcs8PrivateKey(pkcs8Bytes) {
  return crypto.subtle.importKey(
    "pkcs8",
    pkcs8Bytes,
    { name: "Ed25519" },
    true,
    ["sign"]
  );
}

async function importRawPublicKey(rawBytes) {
  return crypto.subtle.importKey(
    "raw",
    rawBytes,
    { name: "Ed25519" },
    true,
    ["verify"]
  );
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const withPadding = padded + "=".repeat((4 - (padded.length % 4)) % 4);
  const binary = atob(withPadding);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function signBytes(privateKey, payloadBytes) {
  const signature = await crypto.subtle.sign(
    { name: "Ed25519" },
    privateKey,
    payloadBytes
  );
  const encoded = bytesToBase64Url(new Uint8Array(signature));
  if (!SIGNATURE_PATTERN.test(encoded)) {
    throw new IdentityError("generated an invalid Ed25519 signature encoding");
  }
  return encoded;
}

async function verifyBytes(did, signature, payloadBytes) {
  if (!SIGNATURE_PATTERN.test(signature || "")) {
    throw new ProtocolError("signature must contain 86 unpadded base64url characters");
  }
  const rawSignature = base64UrlToBytes(signature);
  const publicKeyBytes = publicKeyBytesFromDid(did);
  const publicKey = await importRawPublicKey(publicKeyBytes);
  const valid = await crypto.subtle.verify(
    { name: "Ed25519" },
    publicKey,
    rawSignature,
    payloadBytes
  );
  if (!valid) {
    throw new IdentityError("signature does not match the DID and payload");
  }
}

// ---- contribution proof (matches contribution_payload / create_contribution_proof) ----

const COMMIT_PATTERN = /^[0-9a-fA-F]{40}$|^[0-9a-fA-F]{64}$/;

function contributionPayloadBytes(artifactUrl, commit) {
  if (typeof artifactUrl !== "string" || typeof commit !== "string") {
    throw new ProtocolError("artifact URL and commit must be strings");
  }
  if (artifactUrl !== artifactUrl.trim()) {
    throw new ProtocolError("artifact URL must not contain surrounding whitespace");
  }
  let parsed;
  try {
    parsed = new URL(artifactUrl);
  } catch {
    throw new ProtocolError("artifact URL is malformed");
  }
  if (parsed.protocol !== "https:" || !parsed.host || parsed.hash) {
    throw new ProtocolError(
      "artifact URL must be an absolute HTTPS URL without a fragment"
    );
  }
  if (parsed.username || parsed.password) {
    throw new ProtocolError("artifact URL must not contain embedded credentials");
  }
  if (!COMMIT_PATTERN.test(commit)) {
    throw new ProtocolError(
      "commit must be a complete 40- or 64-character hexadecimal revision"
    );
  }
  // Matches json.dumps(record, sort_keys=True, separators=(",", ":"))
  // — alphabetical keys, no whitespace, so the byte string signed
  // here is identical to what the Python CLI would sign.
  const record = {
    artifact_url: artifactUrl,
    commit: commit.toLowerCase(),
    schema: "technocore-contribution-v1",
  };
  const canonical = `{"artifact_url":${JSON.stringify(
    record.artifact_url
  )},"commit":${JSON.stringify(record.commit)},"schema":${JSON.stringify(
    record.schema
  )}}`;
  return new TextEncoder().encode(canonical);
}

async function createContributionProof(privateKey, did, artifactUrl, commit) {
  const payload = contributionPayloadBytes(artifactUrl, commit);
  return {
    schema: "technocore-contribution-proof-v1",
    did,
    artifact_url: artifactUrl,
    commit: commit.toLowerCase(),
    signature: await signBytes(privateKey, payload),
  };
}

export {
  ProtocolError,
  IdentityError,
  generateKeyPair,
  exportRawPublicKey,
  exportPkcs8PrivateKey,
  importPkcs8PrivateKey,
  didFromPublicKeyBytes,
  publicKeyBytesFromDid,
  normalizeMessage,
  validateName,
  validateNonce,
  nextNonce,
  messagePayloadBytes,
  signBytes,
  verifyBytes,
  contributionPayloadBytes,
  createContributionProof,
  bytesToBase64Url,
  base64UrlToBytes,
};
