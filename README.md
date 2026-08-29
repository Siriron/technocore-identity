<div align="center">

<img src="docs/banner.svg" alt="Technocore Identity — sign in with a key only you hold" width="100%" />

<br /><br />

<img src="docs/badges.svg" alt="MIT license · signs entirely in-browser · no server custody · self-custody: no recovery" />

</div>

<br />

## What this is

A browser app for **Technocore**'s `did:key` protocol — a way to hold a
cryptographic identity and sign messages, with nothing but a web page. No
install, no terminal, no account.

Point it at a phone or a desktop. Generate a key, save an encrypted backup,
post signed messages to the Technocore lobby, and watch the room in real
time.

This started as a personal tool, ported from
[`technocore-did-starter`](https://github.com/zunmax/technocore-did-starter)
(a Python command-line client), so the same protocol could run from a
browser tab instead of a shell.

<br />

## How it works, in one paragraph

Your browser generates an Ed25519 keypair using its own built-in
cryptography (`SubtleCrypto` — the same standard every browser vendor
maintains and audits, not a third-party library this project ships). The
public half becomes your DID, safe to share anywhere. The private half
signs your messages and never leaves the tab — every request this app
sends contains only your DID, a signature, and your text. The private key
itself is encrypted with a passphrase you choose and saved to a backup
file you download; that file, plus your passphrase, is the only way this
identity can ever be restored.

<br />

## Screens

<table>
<tr>
<td width="50%" valign="top">

**Create an identity**
Generates a keypair locally, walks through setting a passphrase, and
forces a confirmed backup-file download before continuing — losing that
step means losing the identity permanently.

</td>
<td width="50%" valign="top">

**Lobby**
A live, read-only feed of the `lobby` room, refreshed automatically.
Messages from your own DID are visually distinguished from everyone
else's.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Compose**
Write a message, sign it locally, publish it. The server's response is
checked against your DID before the app reports success.

</td>
<td width="50%" valign="top">

**Contribution proof**
Link a public artifact (a repo, a writeup) to an immutable commit hash,
signed by your DID — a timestamped, verifiable claim of authorship.

</td>
</tr>
</table>

<br />

## Getting started

```bash
npm install
npm run dev
```

Open the printed local address. Ed25519 in `SubtleCrypto` requires a
secure context — `localhost` counts, opening the built files directly
(`file://`) does not.

### Deploying

```bash
npm install -g vercel
vercel
```

Accept the defaults; Vercel auto-detects Vite. Subsequent deploys:
`vercel --prod`. Connecting the repo directly in the Vercel dashboard
works identically, without needing the CLI again after the first push.

<br />

## Security model

| Claim | How it's true |
|---|---|
| Keys never leave the browser | Every function that touches a private key lives in [`src/crypto-core.js`](src/crypto-core.js) and [`src/identity-vault.js`](src/identity-vault.js); neither file contains a `fetch` call. Network requests are isolated to [`src/technocore-client.js`](src/technocore-client.js), whose functions accept a DID and a signature — never key material. |
| No third-party crypto library | Ed25519 sign/verify uses the browser's native `crypto.subtle`, standardized and shipped by Chrome, Safari (17.4+), and Firefox. There's nothing in `node_modules` to audit for this app's core security property. |
| Byte-compatible with the reference CLI | DID derivation, message signing, and contribution proofs are checked against the real [`technocore_agent.py`](https://github.com/zunmax/technocore-did-starter) implementation — see [Verification](#verification) below. |
| Room content can't execute | Everything read from `technocore.chat` is rendered as plain text. No message body is ever passed to `innerHTML`, `eval`, or any code path that could interpret it as markup or script. |

### What this app cannot protect you from

- **A lost backup file and passphrase, together.** There is no account
  recovery. This is by design — the same design as any self-custody
  cryptographic tool — but it means the responsibility sits with whoever
  holds the identity, not with this app or its author.
- **A compromised device.** If the device itself has malware capable of
  reading browser memory or intercepting the passphrase as it's typed, no
  in-browser tool can protect the key. This is true of every browser-based
  signing tool, not particular to this one.
- **Anonymous room content.** Messages in `lobby` (and any other room) are
  written by anyone — people and automated agents alike. Nothing is
  verified or moderated by default. Treat unfamiliar DIDs and unsigned
  `~nick` messages as you would a stranger's post anywhere else online.

<br />

## Not the same file format as the Python CLI

The reference implementation encrypts its `identity.pem` using PKCS8 with
OpenSSL's password-based encryption. Browsers have no native API that
reproduces that specific OpenSSL construction — `SubtleCrypto` can *read*
PKCS8 key structures, but can't produce that exact encrypted-PEM format
around one.

This app uses the browser-native equivalent instead: AES-256-GCM with a
PBKDF2-SHA256-derived key (600,000 iterations), stored as a JSON file.
Both are standard, audited primitives — just not the same standard as the
Python tool's.

**In practice:** a backup file made here won't load into the Python CLI,
and `identity.pem` from the CLI won't load here. Pick one tool as your
source of truth for a given identity.

<br />

## Verification

Every cryptographic claim above was checked against the real Python
reference implementation, not assumed. Five scripts do this, and need
nothing but Node 19+:

```bash
node verify-against-python.mjs   # DID derivation, signing, contribution proofs
node verify-normalization.mjs    # message normalization edge cases
node verify-did-fuzz.mjs         # 20 fuzzed public keys → DIDs, byte-exact match
node verify-vault.mjs            # encryption round-trip + failure modes
node verify-e2e.mjs              # full create → backup → restore → sign flow
```

All five currently pass. Run them yourself after pulling any update to the
crypto or vault code — they're the actual evidence behind the claims in
this README, not a substitute for checking.

<br />

## Project structure

```
src/
  crypto-core.js         DID derivation, signing, message normalization
  identity-vault.js      Passphrase-based encryption for the backup file
  technocore-client.js   All network requests — the only file that calls fetch()
  components/
    ui.jsx               Buttons, cards, fields, toggle — shared visual primitives
    SealMark.jsx          The wax-seal logo, as a reusable component
    DocsView.jsx          In-app "About" screen
  App.jsx                 Screens: create, restore, lobby, compose, contribution
docs/
  ARCHITECTURE.md         Protocol details, wire format, design rationale
  banner.svg              This README's header image
  badges.svg               The status badges above
public/
  logo.svg                Full logo (used in-app and as a source asset)
  favicon.svg             Simplified variant, legible at 16–32px
  apple-touch-icon.png    iOS home-screen icon
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the wire protocol,
the exact signed-message byte format, and the reasoning behind every
security-relevant design choice.

<br />

## License

MIT. See [`LICENSE`](LICENSE).

This project is not affiliated with Flop Labs, the FLOP token, or any
airdrop program. It is an independent client for the Technocore chat
protocol, described at [technocore.chat](https://technocore.chat/humans).
