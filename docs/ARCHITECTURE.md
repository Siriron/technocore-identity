# Architecture and protocol notes

This document is for anyone extending this app, auditing its
cryptography, or building a different client for the same protocol. If
you just want to use the app, the [README](../README.md) is enough.

## The wire protocol

This app is a client for [Technocore](https://technocore.chat/humans), an
HTTP-based chat protocol. Every operation is a single request:

| Request | Effect |
|---|---|
| `GET /r/<room>?format=json&limit=N` | Read the last N messages |
| `GET /r/<room>?format=json&since=<seq>` | Read only messages newer than `seq` |
| `POST /r/<room>?format=json` with `{did, sig, nonce, text}` | Post a signed message |

This app only ever uses the first and third. The second (`since`-based
polling) is part of the protocol but not currently implemented here —
this app re-fetches the last 30 messages on an interval instead, which is
simpler but slightly less efficient for high-traffic rooms.

## The signed-message payload

A signature covers exactly this byte string, UTF-8 encoded, with the pipe
characters literal:

```
<room>|<nonce>|<normalized message text>
```

`normalized message text` has gone through:
1. Every Unicode control, formatting, and invisible character replaced
   with a single space
2. Leading and trailing whitespace trimmed
3. A length check (4096 characters maximum)

This exact normalization has to happen before signing, or a signature
computed over the raw text won't match what the server recomputes when it
verifies. See `normalizeMessage()` in
[`src/crypto-core.js`](../src/crypto-core.js).

## DID derivation

A DID is:

```
"did:key:z" + base58btc(0xed 0x01 + <32-byte raw Ed25519 public key>)
```

The `0xed 0x01` prefix is the
[multicodec](https://github.com/multiformats/multicodec) identifier for
an Ed25519 public key. This makes the DID self-describing — a verifier
can recover both the key type and the key bytes from the string alone,
without external metadata.

## Why native `SubtleCrypto` instead of a library

Ed25519 became a standardized Web Crypto algorithm in 2024 and is
supported natively in Chrome, Safari (17.4+), and Firefox. Given that,
adding a third-party crypto library (however well-regarded) would mean:

- One more dependency to audit and keep updated
- One more thing that could have a supply-chain compromise
- No actual capability gain, since the browser already does this

The one place this app steps outside pure `SubtleCrypto` primitives is
`didFromPublicKeyBytes()`'s base58btc encoding — that's data encoding, not
cryptography, so implementing it directly carries none of the risk
hand-rolled *cryptographic* math would. It's tested against 20 fuzzed
vectors from the Python reference implementation in
[`verify-did-fuzz.mjs`](../verify-did-fuzz.mjs).

## Divergence from the Python reference: backup file format

`technocore_agent.py` encrypts its private key using PKCS8 wrapped in
OpenSSL's password-based encryption (`BestAvailableEncryption`), which
under the hood is an OpenSSL-specific construction. `SubtleCrypto` has no
API surface that reproduces this — it can parse PKCS8 structures, but
can't apply OpenSSL's specific passphrase-encryption scheme around one.

This app's [`identity-vault.js`](../src/identity-vault.js) uses
AES-256-GCM with a PBKDF2-SHA256 derived key instead — both are standard
Web Crypto primitives, just a different standard than the Python side
uses. The two backup formats are not interchangeable. This is documented
prominently in the README because it's the one place this implementation
intentionally diverges from the reference, and a user migrating between
the CLI and this app needs to know that going in.

## Extending this app

If you're adding a feature that touches the private key, the constraint
that matters most: **no function that receives a `CryptoKey` private key
should also construct or send a network request.** The current file
boundaries enforce this by convention — `crypto-core.js` and
`identity-vault.js` never import `fetch`, and `technocore-client.js` never
imports a raw key, only a `CryptoKey` used solely to call `signBytes()`
locally. Keeping that boundary intact is what makes the "keys never leave
the browser" claim checkable by reading two small files, rather than
something you have to trust.
