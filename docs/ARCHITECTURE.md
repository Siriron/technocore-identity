# Architecture and Protocol Notes

This document is for anyone extending this app, auditing its cryptography, or building a different client for the same protocol. If you just want to use the app, the [README](../README.md) is enough.

---

## Trust model — read this first

**Private keys are generated and held server-side in this implementation.** `server/crypto-helper.js` generates keypairs, signs messages, and exports PEM backups; `server/identity-store.js` persists identity records on the server (with an in-memory fallback for Vercel's read-only serverless filesystem).

This is a meaningfully different trust model from a pure client-side signer where keys never leave the browser. If you are extending this app or auditing it, the thing to check is **who can read a private key**: currently, that's any code path that can reach `server/crypto-helper.js` or the `/api/crypto/*` routes in `server/server.js`, not just the browser tab the user is looking at. Keep this in mind before making claims about custody in any user-facing copy.

---

## The wire protocol

This app is a client for [Technocore Chat](https://technocore.chat), an HTTP-based chat protocol. The frontend never talks to it directly — every call goes through the Express proxy in `server/server.js` under `/api/proxy/*`, which forwards to the configured target node (see `/api/config/target`).

Key proxied operations:

| Request | Effect |
|---|---|
| `GET /api/proxy/rooms` | List available rooms |
| `GET /api/proxy/r/:room` | Read recent messages in a room |
| `POST /api/proxy/r/:room` | Post a message (signed or unsigned) |
| `GET /api/proxy/r/:room/say-signed/:did/:sig/:nonce/:text` | Post a pre-signed message via query path |
| `GET /api/proxy/kv/:ns/:key` / `POST /api/proxy/kv/:ns/:key` | Read/write a notes key-value entry |
| `GET /api/proxy/r/:room/export` | Export a room's chat log |

The frontend (`public/js/api.js`) polls rooms on an interval rather than using long-polling or websockets — simpler, and adequate for the message volumes this protocol sees in practice.

## The signed-message payload

A signature covers exactly this byte string, UTF-8 encoded, with the pipe characters literal:

```
<room>|<nonce>|<normalized message text>
```

`normalized message text` has gone through `normalizeMessage()` in `server/crypto-helper.js`:
1. Every Unicode control, formatting, surrogate, private-use, line- and paragraph-separator character replaced with a single space
2. Leading and trailing whitespace trimmed
3. Repeated whitespace collapsed to a single space

This normalization has to happen identically on sign and verify, or a signature computed over the raw text won't match what the server (or a remote verifier) recomputes.

## DID derivation

A DID is:

```
"did:key:z" + base58btc(0xed 0x01 + <32-byte raw Ed25519 public key>)
```

The `0xed 0x01` prefix is the [multicodec](https://github.com/multiformats/multicodec) identifier for an Ed25519 public key. This makes the DID self-describing — a verifier can recover both the key type and the key bytes from the string alone, without external metadata. See `generateIdentity()` and `verifySignature()` in `server/crypto-helper.js`.

## Contribution proofs

Separately from chat messages, `server/crypto-helper.js` supports signing a small canonical JSON record — `{ artifact_url, commit, schema }` with sorted keys — to produce a portable, independently verifiable proof that a given DID vouches for a given artifact/commit pair. This is unrelated to the chat signature scheme above; it uses the same keypair but a different payload shape (`contributionPayload()` / `createContributionProof()` / `verifyContributionProof()`).

## PEM backup format

`privateKeyHexToPem()` wraps the raw 32-byte Ed25519 private key in a PKCS8 DER envelope and exports it via Node's built-in `crypto.createPrivateKey()`/`.export()`, optionally encrypted with AES-256-CBC under a passphrase. `importFromPem()` reverses this. Because this uses Node's standard PKCS8 encoding rather than a bespoke format, keys exported here should be portable to any standard tool that reads Ed25519 PKCS8 PEM — but that portability claim is only as good as the passphrase-encryption parameters actually used, so verify against your specific interop target before relying on it.

## Extending this app

If you're adding a feature that touches a private key:
- Every current key-handling path lives in `server/crypto-helper.js` and is called from `server/server.js`'s `/api/crypto/*` routes. Keeping key material inside this module (rather than scattering `ed.signAsync`/`ed.getPublicKeyAsync` calls elsewhere) is what makes an eventual move to client-side signing tractable later, if that becomes a goal.
- `server/identity-store.js` is the only place identity records are persisted. It already handles the Vercel read-only-filesystem fallback — don't add a second persistence path elsewhere.
- The frontend (`public/js/app.js`, `public/js/api.js`) should keep treating the private key as opaque — it only ever sends it to `/api/crypto/*` and displays what comes back. If a change requires the frontend to parse or derive anything from raw key bytes, that's a sign the logic belongs in `crypto-helper.js` instead.
