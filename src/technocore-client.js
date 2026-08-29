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
const APP_VERSION = "1.0.0";

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
    {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": `technocore-web-app/${APP_VERSION}`,
      },
    },
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
 * Sign and post one message. privateKey is a CryptoKey, used only to
 * call signBytes() locally — the request body below contains only
 * did, sig, nonce, and text, matching the Python CLI's
 * post_signed_message() field-for-field.
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

  // Matches json.dumps(..., separators=(",", ":")) — compact, no
  // extra whitespace, same four fields, same order for readability
  // (order doesn't affect JSON semantics, but keeping it identical
  // makes this easy to diff against the Python source by eye).
  const requestBody = JSON.stringify({
    did,
    sig: signature,
    nonce,
    text: normalized,
  });

  const validBaseUrl = validateBaseUrl(baseUrl);
  const validRoom = validateName(room);
  const response = await fetchWithTimeout(
    `${validBaseUrl}/r/${validRoom}?format=json`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json; charset=utf-8",
        "User-Agent": `technocore-web-app/${APP_VERSION}`,
      },
      body: requestBody,
    },
    timeoutMs
  );
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
