// ==========================================================================
// FLOOP TERMINAL — CLIENT-SIDE IDENTITY & CRYPTO
// Everything here runs in the browser. A private key is NEVER sent to any
// server, in any request, under any circumstance. Only a DID (public) and a
// signature ever leave this module's memory boundary.
// ==========================================================================

import * as ed from 'https://esm.sh/@noble/ed25519@2.2.3';
import bs58 from 'https://esm.sh/bs58@6.0.0';

// ---- text helpers --------------------------------------------------------

function toHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex) {
  const clean = hex.trim().toLowerCase();
  if (!/^[0-9a-f]+$/.test(clean) || clean.length % 2 !== 0) {
    throw new Error('Invalid hex string.');
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function base64url(bytes) {
  let str = btoa(String.fromCharCode(...bytes));
  return str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(str) {
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function normalizeMessage(text) {
  if (typeof text !== 'string') return '';
  const cleaned = text.replace(/[\u0000-\u001f\u007f-\u009f\ufdd0-\ufdef\ufffe\uffff]/g, ' ').trim();
  return cleaned.replace(/\s+/g, ' ');
}

// ---- DID derivation -------------------------------------------------------

export async function didFromPublicKey(pubBytes) {
  const multicodec = new Uint8Array(2 + pubBytes.length);
  multicodec[0] = 0xed;
  multicodec[1] = 0x01;
  multicodec.set(pubBytes, 2);
  const multibase = 'z' + bs58.encode(multicodec);
  return 'did:key:' + multibase;
}

export function publicKeyFromDid(did) {
  if (!did || !did.startsWith('did:key:z')) throw new Error('Not a did:key identifier.');
  const multibase = did.slice('did:key:'.length);
  const decoded = bs58.decode(multibase.slice(1));
  if (decoded.length !== 34 || decoded[0] !== 0xed || decoded[1] !== 0x01) {
    throw new Error('Unsupported did:key key type (expected Ed25519).');
  }
  return decoded.slice(2);
}

// ---- fingerprint / note path (same derivation as server had) -------------

async function sha256Hex(str) {
  const data = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return toHex(new Uint8Array(digest));
}

async function derivedNotePaths(did) {
  const fingerprint = (await sha256Hex(did)).slice(0, 16);
  const noteShard = `did-${fingerprint.slice(0, 2)}`;
  const noteKey = fingerprint.slice(2, 16);
  return { fingerprint, noteShard, noteKey, notePath: `kv/${noteShard}/${noteKey}` };
}

// ---- keypair generation ----------------------------------------------------

/**
 * Generates a brand-new Ed25519 identity entirely in-browser.
 * Returns the raw private key bytes ONLY in memory — caller is responsible
 * for encrypting it (see encryptIdentity) before it touches disk or storage.
 */
export async function generateIdentity(alias = 'Agent-' + Math.floor(Math.random() * 10000)) {
  const privBytes = ed.utils.randomPrivateKey();
  const pubBytes = await ed.getPublicKeyAsync(privBytes);
  const did = await didFromPublicKey(pubBytes);
  const { fingerprint, noteShard, noteKey, notePath } = await derivedNotePaths(did);
  return {
    alias,
    privateKeyHex: toHex(privBytes), // stays in memory only — never persisted raw
    publicKeyHex: toHex(pubBytes),
    did,
    fingerprint,
    noteShard,
    noteKey,
    notePath,
    createdAt: new Date().toISOString()
  };
}

// ---- signing (never leaves the browser) -----------------------------------

export function generateNonce() {
  // High-resolution, monotonic-ish nonce; matches the server's 19-digit budget.
  const now = BigInt(Date.now()) * 1000000n + BigInt(Math.floor(performance.now() * 1000) % 1000000);
  return now.toString().slice(0, 19);
}

export async function signMessage(privateKeyHex, room, nonce, text) {
  const normalized = normalizeMessage(text);
  const payloadStr = `${room}|${nonce}|${normalized}`;
  const payloadBytes = new TextEncoder().encode(payloadStr);
  const privBytes = fromHex(privateKeyHex);
  const sigBytes = await ed.signAsync(payloadBytes, privBytes);
  return {
    normalized,
    payload: payloadStr,
    sig: base64url(sigBytes),
    nonce: String(nonce)
  };
}

export async function verifySignature(did, room, nonce, text, sig) {
  try {
    const pubKey = publicKeyFromDid(did);
    const normalized = normalizeMessage(text);
    const payloadBytes = new TextEncoder().encode(`${room}|${nonce}|${normalized}`);
    const sigBytes = base64urlDecode(sig);
    return await ed.verifyAsync(sigBytes, payloadBytes, pubKey);
  } catch (err) {
    return false;
  }
}

function contributionPayload(artifactUrl, commit) {
  const record = {
    artifact_url: artifactUrl.trim(),
    commit: commit.toLowerCase().trim(),
    schema: 'technocore-contribution-v1'
  };
  const sortedKeys = Object.keys(record).sort();
  const canonical = JSON.stringify(record, sortedKeys);
  return new TextEncoder().encode(canonical);
}

export async function createContributionProof(privateKeyHex, did, artifactUrl, commit) {
  const payload = contributionPayload(artifactUrl, commit);
  const privBytes = fromHex(privateKeyHex);
  const sigBytes = await ed.signAsync(payload, privBytes);
  return {
    schema: 'technocore-contribution-proof-v1',
    did,
    artifact_url: artifactUrl.trim(),
    commit: commit.toLowerCase().trim(),
    signature: base64url(sigBytes),
    created_at: new Date().toISOString()
  };
}

export async function verifyContributionProof(proof) {
  try {
    if (proof.schema !== 'technocore-contribution-proof-v1') return false;
    const { did, artifact_url, commit, signature } = proof;
    if (!did || !artifact_url || !commit || !signature) return false;
    const payload = contributionPayload(artifact_url, commit);
    const pubKey = publicKeyFromDid(did);
    const sigBytes = base64urlDecode(signature);
    return await ed.verifyAsync(sigBytes, payload, pubKey);
  } catch (err) {
    return false;
  }
}

// ---- passphrase-based encryption (WebCrypto AES-256-GCM + PBKDF2) --------
// This is what makes a downloaded/pasted JSON or PEM file safe at rest, and
// what makes the "remember me" localStorage blob safe to keep in-browser.

const PBKDF2_ITERATIONS = 310000; // OWASP-recommended floor for PBKDF2-SHA256 (2024+)
const MIN_PASSPHRASE_WORDS = 12;

export function passphraseWordCount(passphrase) {
  return passphrase.trim().split(/\s+/).filter(Boolean).length;
}

export function assertPassphraseStrength(passphrase) {
  if (typeof passphrase !== 'string' || passphraseWordCount(passphrase) < MIN_PASSPHRASE_WORDS) {
    throw new Error(`Passphrase must contain at least ${MIN_PASSPHRASE_WORDS} words.`);
  }
}

async function deriveKey(passphrase, saltBytes) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypts a private key (hex) with a user passphrase.
 * Returns a portable, storage-safe envelope — safe to write to a JSON file,
 * a PEM-style wrapper, or localStorage. Contains no plaintext key material.
 */
export async function encryptPrivateKey(privateKeyHex, passphrase) {
  assertPassphraseStrength(passphrase);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const plaintext = fromHex(privateKeyHex);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)
  );
  return {
    kdf: 'PBKDF2-SHA256',
    iterations: PBKDF2_ITERATIONS,
    cipher: 'AES-256-GCM',
    salt: toHex(salt),
    iv: toHex(iv),
    ciphertext: toHex(ciphertext)
  };
}

/** Decrypts an envelope produced by encryptPrivateKey. Wrong passphrase throws. */
export async function decryptPrivateKey(envelope, passphrase) {
  try {
    const salt = fromHex(envelope.salt);
    const iv = fromHex(envelope.iv);
    const key = await deriveKey(passphrase, salt);
    const ciphertext = fromHex(envelope.ciphertext);
    const plaintext = new Uint8Array(
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)
    );
    return toHex(plaintext);
  } catch (err) {
    throw new Error('Incorrect passphrase or corrupted identity data.');
  }
}

// ---- portable identity file (JSON) — download / copy / paste -------------

/**
 * Builds the downloadable/copyable JSON backup. The private key inside is
 * always the encrypted envelope, never raw hex — safe to paste in a chat,
 * upload to cloud storage, whatever the user does with it after this.
 */
export async function buildIdentityBackup(identity, passphrase) {
  const encryptedKey = await encryptPrivateKey(identity.privateKeyHex, passphrase);
  return {
    schema: 'floop-identity-backup-v2',
    alias: identity.alias,
    did: identity.did,
    publicKeyHex: identity.publicKeyHex,
    encryptedKey,
    createdAt: identity.createdAt || new Date().toISOString()
  };
}

/** Restores an identity from a backup JSON object + the passphrase that encrypted it. */
export async function restoreFromBackup(backupObj, passphrase) {
  if (!backupObj || !backupObj.encryptedKey || !backupObj.did) {
    throw new Error('Not a valid Floop identity backup file.');
  }
  const privateKeyHex = await decryptPrivateKey(backupObj.encryptedKey, passphrase);
  const pubBytes = await ed.getPublicKeyAsync(fromHex(privateKeyHex));
  const derivedDid = await didFromPublicKey(pubBytes);
  if (derivedDid !== backupObj.did) {
    throw new Error('Decrypted key does not match the DID in this backup file.');
  }
  const { fingerprint, noteShard, noteKey, notePath } = await derivedNotePaths(derivedDid);
  return {
    alias: backupObj.alias || `Imported-${derivedDid.slice(8, 14)}`,
    privateKeyHex,
    publicKeyHex: toHex(pubBytes),
    did: derivedDid,
    fingerprint,
    noteShard,
    noteKey,
    notePath,
    createdAt: backupObj.createdAt || new Date().toISOString()
  };
}

// ---- PEM-style export/import (kept for parity with existing UI tabs) -----
// Not a real PKCS8 DER/PEM (that required Node's crypto module server-side).
// This is a self-describing, passphrase-encrypted PEM-shaped text block —
// same security properties as the JSON backup, just wrapped for users who
// prefer a PEM-looking artifact. Only this app's import path can read it.

const PEM_HEADER = '-----BEGIN FLOOP ENCRYPTED IDENTITY-----';
const PEM_FOOTER = '-----END FLOOP ENCRYPTED IDENTITY-----';

export async function exportPem(identity, passphrase) {
  const backup = await buildIdentityBackup(identity, passphrase);
  const b64 = btoa(JSON.stringify(backup));
  const lines = b64.match(/.{1,64}/g) || [b64];
  return [PEM_HEADER, ...lines, PEM_FOOTER].join('\n');
}

export async function importPem(pemText, passphrase) {
  const body = pemText
    .replace(PEM_HEADER, '')
    .replace(PEM_FOOTER, '')
    .replace(/\s+/g, '');
  let backup;
  try {
    backup = JSON.parse(atob(body));
  } catch (err) {
    throw new Error('Could not parse this PEM block — is it a Floop-exported identity?');
  }
  return restoreFromBackup(backup, passphrase);
}

// ---- raw seed hex import (unencrypted, explicit "I know the risk" path) --

export async function importFromSeedHex(seedHex, alias) {
  const privBytes = fromHex(seedHex);
  if (privBytes.length !== 32) throw new Error('Seed must be exactly 64 hex characters (32 bytes).');
  const pubBytes = await ed.getPublicKeyAsync(privBytes);
  const did = await didFromPublicKey(pubBytes);
  const { fingerprint, noteShard, noteKey, notePath } = await derivedNotePaths(did);
  return {
    alias: alias || 'Seed-Agent',
    privateKeyHex: toHex(privBytes),
    publicKeyHex: toHex(pubBytes),
    did,
    fingerprint,
    noteShard,
    noteKey,
    notePath,
    createdAt: new Date().toISOString()
  };
}
