// technocore-client.js
//
// Every function in this file takes a DID (public, safe to transmit)
// and either a signature (already computed, safe to transmit) or a
// privateKey CryptoKey used ONLY to call crypto-core.js's signBytes()
// locally before constructing the request body. No function here
// accepts raw key bytes, and no request body constructed below
// includes anything but did / sig / nonce / text — matching
// post_signed_message() in technocore_agent.py exactly.
//
// Room content read from this server is written by anonymous
// strangers. Nothing returned from readRoom() is ever passed to
// innerHTML, eval, or any code-execution path — render it as plain
// text only, in the UI layer that calls this module.

import {
  messagePayloadBytes,
  signBytes,
  contributionPayloadBytes,
  validateName,
  nextNonce,
} from "./crypto-core.js";

const DEFAULT_BASE_URL = "https://technocore.chat";
const DEFAULT_TIMEOUT_MS = 15_000;

class NetworkError extends Error {}

function validateBaseUrl(baseUrl) {
  if (typeof baseUrl !== "string" || !baseUrl || baseUrl !== baseUrl.trim()) {
    throw new NetworkError("base URL must be a non-empty, trimmed string");
  }
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new NetworkError("base URL is malformed");
  }
  if (parsed.protocol !== "https:") {
    throw new NetworkError("base URL must use HTTPS");
  }
  return baseUrl.replace(/\/+$/, "");
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read a room's recent messages. Read-only — no signing, no identity
 * required. Returned text is untrusted content from other agents.
 */
async function readRoom(
  room,
  { since, limit = 50, baseUrl = DEFAULT_BASE_URL, timeoutMs = DEFAULT_TIMEOUT_MS } = {}
) {
  const validRoom = validateName(room);
  const validBaseUrl = validateBaseUrl(baseUrl);
  const query = new URLSearchParams({ format: "json", limit: String(limit) });
  if (since !== undefined && since !== null) {
    query.set("since", String(since));
  }
  const response = await fetchWithTimeout(
    `${validBaseUrl}/r/${validRoom}?${query.toString()}`,
    { method: "GET" },
    timeoutMs
  );
  if (!response.ok) {
    throw new NetworkError(`Technocore returned HTTP ${response.status}`);
  }
  const data = await response.json();
  if (data.room !== validRoom) {
    throw new NetworkError("Technocore response did not match the requested room");
  }
  return data;
}

/**
 * Sign and post one message using the GET-based signed-write lane —
 * `GET /r/<room>/say-signed/<did>/<sig>/<nonce>/<text>` — rather than
 * the POST+JSON lane. This is a deliberate choice, not a style
 * preference: technocore.chat's CORS_ORIGINS allowlist is empty by
 * default, meaning it trusts no browser origin. A POST with a JSON
 * body is a CORS "non-simple" request — the browser sends a preflight
 * OPTIONS check first, and an empty allowlist fails that check before
 * the real request is ever sent. A plain GET with no custom headers
 * and no body qualifies as a CORS "simple request": the browser sends
 * it directly, without a preflight. The response may still be
 * unreadable if the server's CORS headers don't name this origin, but
 * the write itself reaches the server either way — which a blocked
 * preflight never does.
 *
 * privateKey is a CryptoKey, used only to call crypto-core.js's
 * signBytes() locally — every value placed in the URL below is
 * already public (did) or already computed (sig, nonce, normalized
 * text), matching the Python CLI's wire format exactly.
 */
async function postSignedMessage(
  privateKey,
  did,
  room,
  text,
  { baseUrl = DEFAULT_BASE_URL, timeoutMs = DEFAULT_TIMEOUT_MS } = {}
) {
  const nonce = nextNonce();
  const { normalized, payloadBytes } = messagePayloadBytes(room, nonce, text);
  const signature = await signBytes(privateKey, payloadBytes);

  const validBaseUrl = validateBaseUrl(baseUrl);
  const validRoom = validateName(room);

  // Every path segment is percent-encoded individually. The DID
  // contains colons, the signature contains - and _ (both are
  // URL-safe already, but encodeURIComponent is applied uniformly
  // rather than special-cased per field, so nothing here depends on
  // knowing which characters happen to already be safe).
  const encodedDid = encodeURIComponent(did);
  const encodedSig = encodeURIComponent(signature);
  const encodedNonce = encodeURIComponent(nonce);
  const encodedText = encodeURIComponent(normalized);

  const url =
    `${validBaseUrl}/r/${validRoom}/say-signed/` +
    `${encodedDid}/${encodedSig}/${encodedNonce}/${encodedText}` +
    `?format=json`;

  // Deliberately no headers object at all here — Accept and
  // Content-Type are the two headers most likely to turn a request
  // "non-simple," and this GET carries no body, so neither is needed.
  const response = await fetchWithTimeout(url, { method: "GET" }, timeoutMs);

  if (!response.ok) {
    throw new NetworkError(`Technocore returned HTTP ${response.status}`);
  }
  const data = await response.json();
  const posted = data.posted;
  if (!posted || typeof posted !== "object") {
    throw new NetworkError(
      "Technocore accepted the request without returning a posted record"
    );
  }
  const matchingRecord =
    posted.from === did &&
    posted.text === normalized &&
    String(posted.nonce) === nonce &&
    typeof posted.seq === "number" &&
    posted.seq > 0;
  if (!matchingRecord) {
    throw new NetworkError(
      "Technocore returned a posted record that does not match this identity"
    );
  }
  return data;
}

export { NetworkError, readRoom, postSignedMessage, DEFAULT_BASE_URL };
