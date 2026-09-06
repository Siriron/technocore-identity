# Architecture and Protocol Notes

This document is for anyone extending this app, auditing its cryptography, or building a different client for the same protocol. If you just want to use the app, the [README](../README.md) is enough.

---

## Trust model — read this first

**Private keys are generated, signed with, and encrypted entirely in the browser.** `public/js/crypto-client.js` generates keypairs, signs messages, derives DIDs, and encrypts/decrypts identity backups using WebCrypto (PBKDF2 + AES-256-GCM). `public/js/local-vault.js` optionally stores an already-encrypted backup in that browser's own `localStorage` for "remember this login" — never anywhere else.

The server never receives a raw private key from a real user, under any code path. `server/crypto-helper.js` still exists, but it is only used for two things, neither of which touches user identity:
1. Public-key-only signature/proof **verification** (`/api/crypto/verify-signature`, `/api/crypto/verify-proof`) — these never need a private key.
2. The Agent Orchestrator simulator (`/api/orchestrator/run-workflow`), which generates disposable demo agent keypairs server-side for its own internal Planner/Implementer/Reviewer simulation. Those keys are never persisted and never returned to the client — only the resulting `did`s appear in the response log. This is a deliberately contained exception; it must never be extended to handle a real user's identity.

There used to be a server-side identity store (`server/identity-store.js` + `/api/identities`) that persisted user private keys, unauthenticated, in a single shared file. **This was a real vulnerability** — any visitor could `GET /api/identities` and receive every stored private key, and the "remember me" feature appeared to work per-browser but was actually reading from that one shared server file. That entire code path has been removed, not disabled. `server/identity-store.js` now only holds non-secret UI presets (favorite rooms, notes).

If you are extending this app or auditing it, the thing to check is **who can read a private key**: the answer should always be "only the browser tab the user generated or unlocked it in, for the lifetime of that page session, plus whatever that same browser's `localStorage` holds if the user opted into 'remember this login.'" If any change makes a private key reachable from a server process or from a different browser, that's a regression back to the original bug — stop and reconsider.

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

Room ownership claims and allow-list updates are signed client-side (`crypto-client.js`) and then posted through these same generic `kv`/`r` proxy paths — there's no dedicated `/api/ownership/claim` or `/api/ownership/allow` route anymore, since those used to require sending `privateKeyHex` to the server to do the signing. `GET /api/ownership/room-nonce/:room` still exists as a thin proxy helper since it only reads public state.

## The signed-message payload

A signature covers exactly this byte string, UTF-8 encoded, with the pipe characters literal:

```
<room>|<nonce>|<normalized message text>
```

`normalized message text` has gone through `normalizeMessage()` in `public/js/crypto-client.js` (mirrored server-side in `server/crypto-helper.js` for verification only):
1. Every Unicode control, formatting, surrogate, private-use, line- and paragraph-separator character replaced with a single space
2. Leading and trailing whitespace trimmed
3. Repeated whitespace collapsed to a single space

This normalization has to happen identically on sign and verify, or a signature computed over the raw text won't match what a verifier recomputes. Both implementations must stay byte-for-byte identical — if you change one, change the other.

## DID derivation

A DID is:

```
"did:key:z" + base58btc(0xed 0x01 + <32-byte raw Ed25519 public key>)
```

The `0xed 0x01` prefix is the [multicodec](https://github.com/multiformats/multicodec) identifier for an Ed25519 public key. This makes the DID self-describing — a verifier can recover both the key type and the key bytes from the string alone, without external metadata. See `didFromPublicKey()` / `publicKeyFromDid()` in `public/js/crypto-client.js` (the canonical, client-side implementation) and `verifySignature()` in `server/crypto-helper.js` (server-side verification mirror — produces byte-identical DIDs from the same public key).

## Contribution proofs

Separately from chat messages, `public/js/crypto-client.js` supports signing a small canonical JSON record — `{ artifact_url, commit, schema }` with sorted keys — to produce a portable, independently verifiable proof that a given DID vouches for a given artifact/commit pair. This is unrelated to the chat signature scheme above; it uses the same keypair but a different payload shape (`contributionPayload()` / `createContributionProof()` in `crypto-client.js`). Verification (`verifyContributionProof()`) exists both client-side and server-side (`/api/crypto/verify-proof`) since it's public-key-only and safe either way.

## Backup formats (JSON & PEM)

Both backup formats are produced client-side by `public/js/crypto-client.js` and both wrap the same thing: an AES-256-GCM ciphertext of the raw private key, with a PBKDF2-SHA256 (310,000 iterations) key derived from the user's passphrase, plus the salt/IV needed to reverse it. There is no unencrypted export path — `assertPassphraseStrength()` requires 12+ words before `encryptPrivateKey()`/`buildIdentityBackup()` will run.

- **JSON** (`buildIdentityBackup()` / `restoreFromBackup()`) — a plain JSON object: `{ schema, alias, did, publicKeyHex, encryptedKey: { kdf, iterations, cipher, salt, iv, ciphertext }, createdAt }`. This is the primary format; the PEM export below is just this same object, base64'd and wrapped in delimiter lines for people who prefer a PEM-looking artifact.
- **PEM** (`exportPem()` / `importPem()`) — **not** a standard PKCS8 DER PEM. It's `-----BEGIN FLOOP ENCRYPTED IDENTITY-----` / `-----END FLOOP ENCRYPTED IDENTITY-----` wrapped around base64(JSON.stringify(the same backup object above)). It is only readable by this app's own `importPem()` — don't advertise it as interoperable with generic PEM/OpenSSL tooling, since it isn't.

An earlier version of this app used Node's `crypto.createPrivateKey()`/`.export()` server-side to produce real PKCS8 PEM files. That code path is gone along with the rest of server-side identity handling — if you find references to `privateKeyHexToPem()` anywhere, they're stale.

## Extending this app

If you're adding a feature that touches a private key:
- Every key-handling path for real user identities lives in `public/js/crypto-client.js`, in the browser. Keep it that way — do not add a server route that accepts `privateKeyHex` (or any equivalent raw key material) in a request body, even for a seemingly low-risk feature. That's exactly the shape of the bug this architecture was rewritten to close.
- `public/js/local-vault.js` is the only place "remember this login" data is persisted, and it only ever stores the already-encrypted backup object, never a decrypted key. Don't add a second persistence path elsewhere, and don't decrypt-and-store — decrypt only happens transiently, in memory, right before signing.
- The frontend's in-session identity state (`this.identities` / `this.activeIdentity` in `public/js/app.js`) is memory-only and intentionally not persisted anywhere by the app itself — that's what makes it safe. If a feature seems to need identities to survive a hard refresh without the user re-entering a passphrase, the answer is prompting for the passphrase again or improving the "remember this browser" UX, not silently caching the decrypted key.
- `server/crypto-helper.js` and `server/identity-store.js` should stay limited to what they do today: public-key-only verification, the orchestrator's disposable demo agents, and non-secret UI presets. If a new feature seems to need `server/crypto-helper.js` to handle a real user's key, that's a sign the feature should be implemented in `crypto-client.js` instead, with only the final signature/proof (never the key) sent to the server.
