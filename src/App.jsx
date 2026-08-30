import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  generateKeyPair,
  exportRawPublicKey,
  exportPkcs8PrivateKey,
  importPkcs8PrivateKey,
  didFromPublicKeyBytes,
  createContributionProof,
  normalizeMessage,
} from "./crypto-core.js";
import { encryptIdentity, decryptIdentity, VaultError } from "./identity-vault.js";
import { readRoom, postSignedMessage, NetworkError } from "./technocore-client.js";
import { Card, Button, Field, TextInput, TextArea, StatusMessage, Toggle } from "./components/ui.jsx";
import { SealMark } from "./components/SealMark.jsx";
import { DocsView } from "./components/DocsView.jsx";

const LOBBY_ROOM = "lobby";
const TECHNOCORE_ROOM = "technocore";
const REFRESH_INTERVAL_MS = 8000;
const LOCAL_STORAGE_KEY = "technocore-web-vault-v1";
const PROGRESS_STORAGE_KEY = "technocore-web-progress-v1";

const CONTRIBUTION_FORMATS = [
  { id: "video", label: "Video or stream" },
  { id: "thread", label: "X thread" },
  { id: "writing", label: "Written piece" },
  { id: "diagram", label: "Diagram" },
  { id: "translation", label: "Translation" },
  { id: "code", label: "Code or tool" },
];

function loadProgress() {
  try {
    const raw = localStorage.getItem(PROGRESS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveProgress(partial) {
  try {
    const current = loadProgress();
    const next = { ...current, ...partial };
    localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(next));
    return next;
  } catch {
    return { ...loadProgress(), ...partial };
  }
}

/**
 * A post can fail on the client side (a blocked CORS response, a
 * dropped connection after the request already reached the server)
 * even though the write itself landed — the GET-based signed-write
 * lane reaches the server as a "simple" CORS request regardless of
 * whether the browser will be allowed to read the reply. This looks
 * for a message from `did` in `room` matching `text` exactly, so a
 * failed post can be confirmed or ruled out with certainty rather
 * than left as a guess.
 */
async function checkIfPostLanded(room, did, text) {
  const normalized = normalizeMessage(text);
  const data = await readRoom(room, { limit: 50 });
  const messages = data.messages || [];
  const match = messages.find((m) => m.from === did && m.text === normalized);
  return match ? match.seq : null;
}

// ---------- identity creation flow ----------

function CreateIdentity({ onIdentityReady }) {
  const [step, setStep] = useState("intro");
  const [passphrase, setPassphrase] = useState("");
  const [passphraseConfirm, setPassphraseConfirm] = useState("");
  const [error, setError] = useState("");
  const [generated, setGenerated] = useState(null);
  const [backupConfirmed, setBackupConfirmed] = useState(false);
  const [downloadedOnce, setDownloadedOnce] = useState(false);
  const [showBackupText, setShowBackupText] = useState(false);

  const passphraseValid = passphrase.length >= 12;
  const passphrasesMatch = passphrase === passphraseConfirm && passphrase.length > 0;

  function handleCopyBackupText() {
    const text = JSON.stringify(generated.vaultObject, null, 2);
    navigator.clipboard?.writeText(text).catch(() => {});
    setDownloadedOnce(true);
  }

  async function handleGenerate() {
    setError("");
    if (!passphraseValid) {
      setError("Passphrase must be at least 12 characters.");
      return;
    }
    if (!passphrasesMatch) {
      setError("Passphrases do not match.");
      return;
    }
    setStep("generating");
    try {
      const keyPair = await generateKeyPair();
      const publicKeyBytes = await exportRawPublicKey(keyPair.publicKey);
      const did = await didFromPublicKeyBytes(publicKeyBytes);
      const pkcs8Bytes = await exportPkcs8PrivateKey(keyPair.privateKey);
      const vaultObject = await encryptIdentity(pkcs8Bytes, did, passphrase);
      setGenerated({ did, keyPair, vaultObject });
      setStep("backup");
    } catch (err) {
      setError(`Could not generate identity: ${err.message}`);
      setStep("passphrase");
    }
  }

  function handleDownload() {
    const blob = new Blob([JSON.stringify(generated.vaultObject, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const shortDid = generated.did.slice(-8);
    a.href = url;
    a.download = `technocore-identity-${shortDid}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setDownloadedOnce(true);
  }

  function handleFinish() {
    onIdentityReady({
      did: generated.did,
      privateKey: generated.keyPair.privateKey,
      vaultObject: generated.vaultObject,
    });
  }

  if (step === "intro") {
    return (
      <Card eyebrow="Step 1 of 2" title="Create your identity">
        <div className="space-y-4">
          <p className="text-[14px] text-stone leading-relaxed">
            This generates a signing key entirely on this device, using your
            browser's own cryptography. Nothing is sent anywhere while it's
            being created — not even to this app's own server.
          </p>
          <StatusMessage tone="warn">
            There is no password reset. If the backup file and passphrase
            are both lost, this identity cannot be recovered by anyone.
          </StatusMessage>
          <Button onClick={() => setStep("passphrase")}>Continue</Button>
        </div>
      </Card>
    );
  }

  if (step === "passphrase" || step === "generating") {
    return (
      <Card eyebrow="Step 1 of 2" title="Set a passphrase">
        <div className="space-y-5">
          <p className="text-[14px] text-stone leading-relaxed">
            This encrypts your private key. Choose something memorable or
            save it in a password manager — it's never sent anywhere and
            can't be recovered if lost.
          </p>
          <Field label="Passphrase" hint="At least 12 characters">
            <TextInput
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              disabled={step === "generating"}
              autoComplete="new-password"
            />
          </Field>
          <Field label="Confirm passphrase">
            <TextInput
              type="password"
              value={passphraseConfirm}
              onChange={(e) => setPassphraseConfirm(e.target.value)}
              disabled={step === "generating"}
              autoComplete="new-password"
            />
          </Field>
          {error && <StatusMessage tone="bad">{error}</StatusMessage>}
          <Button onClick={handleGenerate} disabled={step === "generating"}>
            {step === "generating" ? "Generating…" : "Generate identity"}
          </Button>
        </div>
      </Card>
    );
  }

  if (step === "backup") {
    return (
      <Card eyebrow="Step 2 of 2" title="Save your backup file">
        <div className="space-y-4">
          <div className="bg-parchment rounded-control px-4 py-3.5 flex items-center gap-3">
            <SealMark size={32} animate />
            <div className="min-w-0">
              <span className="block text-[11px] uppercase tracking-wide text-stone-light font-medium">
                Your DID
              </span>
              <span className="block text-[12px] font-mono text-verified-dark break-all">
                {generated.did}
              </span>
            </div>
          </div>
          <StatusMessage tone="warn">
            Save the backup now. Closing this tab without saving it means
            starting over with a new identity.
          </StatusMessage>
          <Button onClick={handleDownload} variant="secondary">
            Download backup file
          </Button>
          <button
            type="button"
            onClick={() => setShowBackupText((v) => !v)}
            className="w-full text-center text-[13px] text-stone underline underline-offset-2 py-1"
          >
            {showBackupText ? "Hide text version" : "Download not working? Show text to copy instead"}
          </button>
          {showBackupText && (
            <div className="space-y-2 animate-fade-in">
              <StatusMessage tone="neutral">
                Select all the text below, copy it, and paste it somewhere
                safe — a notes app or password manager. This is the same
                content as the downloaded file, just as plain text.
              </StatusMessage>
              <TextArea
                readOnly
                value={JSON.stringify(generated.vaultObject, null, 2)}
                onClick={(e) => {
                  e.target.select();
                  setDownloadedOnce(true);
                }}
                onFocus={(e) => {
                  e.target.select();
                  setDownloadedOnce(true);
                }}
                className="font-mono text-[11px] min-h-[160px]"
              />
              <Button onClick={handleCopyBackupText} variant="secondary">
                Copy to clipboard
              </Button>
            </div>
          )}
          {downloadedOnce && (
            <label className="flex items-start gap-3 cursor-pointer animate-fade-in">
              <input
                type="checkbox"
                checked={backupConfirmed}
                onChange={(e) => setBackupConfirmed(e.target.checked)}
                className="mt-0.5 h-5 w-5 rounded accent-verified shrink-0"
              />
              <span className="text-[13px] text-stone leading-relaxed">
                I've saved the backup somewhere durable — not just this
                device's downloads folder.
              </span>
            </label>
          )}
          <Button onClick={handleFinish} disabled={!downloadedOnce || !backupConfirmed}>
            Continue to lobby
          </Button>
        </div>
      </Card>
    );
  }

  return null;
}

// ---------- restore from existing backup file ----------

function RestoreIdentity({ onIdentityReady, onCancel }) {
  const [inputMode, setInputMode] = useState("file"); // "file" | "paste"
  const [vaultObject, setVaultObject] = useState(null);
  const [pastedText, setPastedText] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function parseVaultText(text) {
    try {
      const parsed = JSON.parse(text);
      setVaultObject(parsed);
      setError("");
    } catch {
      setError("That doesn't look like valid backup file contents — check for missing or extra characters.");
      setVaultObject(null);
    }
  }

  async function handleFile(e) {
    setError("");
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      parseVaultText(text);
    } catch {
      setError("Could not read that file as a Technocore identity backup.");
      setVaultObject(null);
    }
  }

  function handlePasteChange(e) {
    const text = e.target.value;
    setPastedText(text);
    if (!text.trim()) {
      setVaultObject(null);
      setError("");
      return;
    }
    parseVaultText(text);
  }

  function switchMode(mode) {
    setInputMode(mode);
    setVaultObject(null);
    setPastedText("");
    setError("");
  }

  async function handleUnlock() {
    setError("");
    setLoading(true);
    try {
      const pkcs8Bytes = await decryptIdentity(vaultObject, passphrase);
      const privateKey = await importPkcs8PrivateKey(pkcs8Bytes);
      onIdentityReady({ did: vaultObject.did, privateKey, vaultObject });
    } catch (err) {
      setError(err instanceof VaultError ? err.message : `Could not unlock identity: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card eyebrow="Restore" title="Load an existing identity">
      <div className="space-y-5">
        <div className="flex gap-1 bg-parchment rounded-control p-1">
          <button
            type="button"
            onClick={() => switchMode("file")}
            className={`flex-1 h-9 rounded-[10px] text-[13px] font-medium transition-colors ${
              inputMode === "file" ? "bg-panel text-ink shadow-soft" : "text-stone"
            }`}
          >
            Choose file
          </button>
          <button
            type="button"
            onClick={() => switchMode("paste")}
            className={`flex-1 h-9 rounded-[10px] text-[13px] font-medium transition-colors ${
              inputMode === "paste" ? "bg-panel text-ink shadow-soft" : "text-stone"
            }`}
          >
            Paste text
          </button>
        </div>

        {inputMode === "file" ? (
          <Field label="Backup file">
            <input
              type="file"
              accept="application/json"
              onChange={handleFile}
              className="w-full text-[14px] text-stone file:mr-3 file:h-[44px] file:px-4 file:rounded-control file:border-0 file:bg-parchment file:text-ink file:font-medium file:text-[13px]"
            />
          </Field>
        ) : (
          <Field
            label="Backup file contents"
            hint="Open the backup file in any text or notes app, copy everything, and paste it here."
          >
            <TextArea
              value={pastedText}
              onChange={handlePasteChange}
              placeholder="Paste the full contents of your backup file here…"
              className="font-mono text-[12px]"
            />
            {pastedText.trim() && (
              <span
                className={`block text-[12px] mt-1.5 ${
                  vaultObject ? "text-verified-dark" : "text-seal-dark"
                }`}
              >
                {vaultObject ? "✓ Recognized as a valid backup file" : "Not recognized yet — check for missing text"}
              </span>
            )}
          </Field>
        )}

        {vaultObject && (
          <div className="bg-parchment rounded-control px-4 py-3 animate-fade-in">
            <span className="block text-[11px] uppercase tracking-wide text-stone-light font-medium">
              DID in file
            </span>
            <span className="block text-[12px] font-mono text-verified-dark break-all">
              {vaultObject.did}
            </span>
          </div>
        )}
        <Field label="Passphrase">
          <TextInput
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            autoComplete="current-password"
          />
        </Field>
        {error && <StatusMessage tone="bad">{error}</StatusMessage>}
        <div className="flex flex-col md:flex-row gap-3">
          <Button onClick={handleUnlock} disabled={!vaultObject || !passphrase || loading}>
            {loading ? "Unlocking…" : "Unlock"}
          </Button>
          <Button onClick={onCancel} variant="secondary">
            Back
          </Button>
        </div>
      </div>
    </Card>
  );
}

// ---------- unlock a remembered identity (no file needed) ----------

function UnlockRemembered({ vaultObject, onIdentityReady, onUseDifferentIdentity }) {
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleUnlock() {
    setError("");
    setLoading(true);
    try {
      const pkcs8Bytes = await decryptIdentity(vaultObject, passphrase);
      const privateKey = await importPkcs8PrivateKey(pkcs8Bytes);
      onIdentityReady({ did: vaultObject.did, privateKey, vaultObject });
    } catch (err) {
      setError(err instanceof VaultError ? err.message : `Could not unlock identity: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card eyebrow="Welcome back" title="Unlock your identity">
      <div className="space-y-5">
        <div className="bg-parchment rounded-control px-4 py-3">
          <span className="block text-[11px] uppercase tracking-wide text-stone-light font-medium">
            Remembered on this device
          </span>
          <span className="block text-[12px] font-mono text-verified-dark break-all">
            {vaultObject.did}
          </span>
        </div>
        <Field label="Passphrase">
          <TextInput
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            autoComplete="current-password"
            autoFocus
          />
        </Field>
        {error && <StatusMessage tone="bad">{error}</StatusMessage>}
        <Button onClick={handleUnlock} disabled={!passphrase || loading}>
          {loading ? "Unlocking…" : "Unlock"}
        </Button>
        <button
          type="button"
          onClick={onUseDifferentIdentity}
          className="w-full text-center text-[13px] text-stone underline underline-offset-2 py-1"
        >
          Use a different identity instead
        </button>
      </div>
    </Card>
  );
}

// ---------- pipeline step: introduction ----------

function Introduction({ identity, onDone }) {
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState("");
  const [posted, setPosted] = useState(null);
  const [checking, setChecking] = useState(false);
  const [lastAttemptedText, setLastAttemptedText] = useState("");

  async function handlePost() {
    setError("");
    if (!text.trim()) return;
    setPosting(true);
    setLastAttemptedText(text);
    try {
      const result = await postSignedMessage(identity.privateKey, identity.did, LOBBY_ROOM, text);
      setPosted(result.posted);
      saveProgress({ introSeq: result.posted.seq, introText: text });
    } catch (err) {
      setError(err instanceof NetworkError ? err.message : `Could not post: ${err.message}`);
    } finally {
      setPosting(false);
    }
  }

  async function handleCheckAnyway() {
    setChecking(true);
    setError("");
    try {
      const seq = await checkIfPostLanded(LOBBY_ROOM, identity.did, lastAttemptedText);
      if (seq) {
        setPosted({ seq });
        saveProgress({ introSeq: seq, introText: lastAttemptedText });
      } else {
        setError("Not found in the last 50 messages — it likely didn't post. Try again.");
      }
    } catch (err) {
      setError(`Could not check: ${err.message}`);
    } finally {
      setChecking(false);
    }
  }

  return (
    <Card eyebrow="Step 2 of 6" title="Introduce yourself">
      <div className="space-y-5">
        <p className="text-[14px] text-stone leading-relaxed">
          One signed message to the lobby — the first public proof that your
          key works and this DID is yours. Say who you are and what you plan
          to make, in your own words.
        </p>
        <Field label="Your introduction" hint="One honest sentence beats a template — identical messages are easy to spot.">
          <TextArea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="I build Telegram bots. Making a short explainer on what a signature actually proves."
            maxLength={4096}
          />
        </Field>
        <div className="flex items-center justify-between">
          <span className="text-[12px] text-stone-light font-mono">{text.length}/4096</span>
        </div>
        {error && <StatusMessage tone="bad">{error}</StatusMessage>}
        {posted ? (
          <>
            <StatusMessage tone="good">
              Posted as #{posted.seq} — this is your receipt, saved to this
              device.
            </StatusMessage>
            <Button onClick={() => onDone(posted.seq)}>Next: make something →</Button>
          </>
        ) : (
          <>
            <Button onClick={handlePost} disabled={posting || !text.trim()} variant="seal">
              {posting ? "Signing & posting…" : "Sign & publish to lobby"}
            </Button>
            {error && lastAttemptedText && (
              <button
                type="button"
                onClick={handleCheckAnyway}
                disabled={checking}
                className="w-full text-center text-[13px] text-stone underline underline-offset-2 py-1"
              >
                {checking ? "Checking the room…" : "It may have posted anyway — check the room"}
              </button>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

// ---------- pipeline step: contribution builder ----------

function ContributionBuilder({ onDone }) {
  const [format, setFormat] = useState(null);
  const [url, setUrl] = useState("");
  const [checks, setChecks] = useState({
    mentionsFlop: false,
    didInPost: false,
    publicPermanent: false,
    selfMade: false,
  });
  const [error, setError] = useState("");

  const allChecked = Object.values(checks).every(Boolean);
  const urlValid = (() => {
    if (!url.trim()) return false;
    try {
      const parsed = new URL(url.trim());
      return parsed.protocol === "https:";
    } catch {
      return false;
    }
  })();
  const canContinue = format && urlValid && allChecked;

  function toggle(key) {
    setChecks((c) => ({ ...c, [key]: !c[key] }));
  }

  function handleContinue() {
    if (!canContinue) {
      setError("Pick a format, add an https:// link, and confirm every item below.");
      return;
    }
    setError("");
    saveProgress({ contributionFormat: format, contributionUrl: url.trim() });
    onDone({ format, url: url.trim() });
  }

  return (
    <Card eyebrow="Step 3 of 6" title="Make something useful">
      <div className="space-y-5">
        <p className="text-[14px] text-stone leading-relaxed">
          This is the real work — something that leaves a stranger knowing
          more about Technocore than they did before. Not made it yet? Your
          progress is saved; come back whenever you're ready.
        </p>
        <div>
          <span className="block text-[13px] font-medium text-stone mb-2">What are you making?</span>
          <div className="grid grid-cols-2 gap-2">
            {CONTRIBUTION_FORMATS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFormat(f.id)}
                className={`h-[52px] rounded-control text-[13px] font-medium border transition-colors ${
                  format === f.id
                    ? "bg-verified-light border-verified text-verified-dark"
                    : "border-hairline-strong text-ink hover:bg-parchment"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <Field label="Public link to what you made" hint="Must stay reachable — delete it later and your record points at nothing.">
          <TextInput
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
          />
        </Field>
        <div className="space-y-2.5">
          {[
            ["mentionsFlop", "It mentions @flop_labs"],
            ["didInPost", "My DID is written in the post itself"],
            ["publicPermanent", "It is public and I will not delete it"],
            ["selfMade", "I made it myself, and somebody will get something out of it"],
          ].map(([key, label]) => (
            <label key={key} className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={checks[key]}
                onChange={() => toggle(key)}
                className="mt-0.5 h-5 w-5 rounded accent-verified shrink-0"
              />
              <span className="text-[13px] text-stone leading-relaxed">{label}</span>
            </label>
          ))}
        </div>
        {error && <StatusMessage tone="bad">{error}</StatusMessage>}
        <Button onClick={handleContinue} disabled={!canContinue}>
          Next: record it →
        </Button>
      </div>
    </Card>
  );
}

// ---------- pipeline step: record contribution ----------

function RecordContribution({ identity, contribution, onDone }) {
  const [description, setDescription] = useState(
    `Made a ${CONTRIBUTION_FORMATS.find((f) => f.id === contribution.format)?.label.toLowerCase() || "contribution"}: ${contribution.url}`
  );
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState("");
  const [posted, setPosted] = useState(null);
  const [checking, setChecking] = useState(false);
  const [lastAttemptedText, setLastAttemptedText] = useState("");

  async function handlePublish() {
    setError("");
    if (!description.trim()) return;
    setPosting(true);
    setLastAttemptedText(description);
    try {
      const result = await postSignedMessage(
        identity.privateKey,
        identity.did,
        TECHNOCORE_ROOM,
        description
      );
      setPosted(result.posted);
      saveProgress({ recordSeq: result.posted.seq, recordText: description });
    } catch (err) {
      setError(err instanceof NetworkError ? err.message : `Could not post: ${err.message}`);
    } finally {
      setPosting(false);
    }
  }

  async function handleCheckAnyway() {
    setChecking(true);
    setError("");
    try {
      const seq = await checkIfPostLanded(TECHNOCORE_ROOM, identity.did, lastAttemptedText);
      if (seq) {
        setPosted({ seq });
        saveProgress({ recordSeq: seq, recordText: lastAttemptedText });
      } else {
        setError("Not found in the last 50 messages — it likely didn't post. Try again.");
      }
    } catch (err) {
      setError(`Could not check: ${err.message}`);
    } finally {
      setChecking(false);
    }
  }

  return (
    <Card eyebrow="Step 4 of 6" title="Put it on the record">
      <div className="space-y-5">
        <p className="text-[14px] text-stone leading-relaxed">
          A second signed message, posted to the technocore room, tying your
          work to your DID — in public, permanently. Describe what someone
          will learn from it, then publish. Edit freely first.
        </p>
        <Field label="Message" hint={`Posts to the ${TECHNOCORE_ROOM} room, signed by your DID.`}>
          <TextArea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={4096}
          />
        </Field>
        <div className="flex items-center justify-between">
          <span className="text-[12px] text-stone-light font-mono">{description.length}/4096</span>
        </div>
        {error && <StatusMessage tone="bad">{error}</StatusMessage>}
        {posted ? (
          <>
            <StatusMessage tone="good">Published as #{posted.seq}.</StatusMessage>
            <Button onClick={() => onDone(posted.seq)}>Next: share it →</Button>
          </>
        ) : (
          <>
            <Button onClick={handlePublish} disabled={posting || !description.trim()} variant="seal">
              {posting ? "Signing & publishing…" : `Sign & publish to ${TECHNOCORE_ROOM}`}
            </Button>
            {error && lastAttemptedText && (
              <button
                type="button"
                onClick={handleCheckAnyway}
                disabled={checking}
                className="w-full text-center text-[13px] text-stone underline underline-offset-2 py-1"
              >
                {checking ? "Checking the room…" : "It may have posted anyway — check the room"}
              </button>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

// ---------- pipeline step: share ----------

function SharePrompt({ identity, progress, onDone }) {
  const [copied, setCopied] = useState(false);

  const shareText = `Just made my DID on @flop_labs' Technocore protocol and put a real contribution on the record.\n\nDID: ${identity.did}\nRecord: technocore.chat/humans#r/${TECHNOCORE_ROOM} (seq #${progress.recordSeq})\n\n${progress.contributionUrl || ""}`;

  function handleCopy() {
    navigator.clipboard?.writeText(shareText).catch(() => {});
    setCopied(true);
  }

  return (
    <Card eyebrow="Step 5 of 6" title="Share it">
      <div className="space-y-5">
        <p className="text-[14px] text-stone leading-relaxed">
          Post this on X so your work and your identity sit together in
          public. Made an X thread? This belongs at the end of that thread,
          not as a separate post.
        </p>
        <div className="bg-parchment rounded-control px-4 py-3">
          <pre className="text-[13px] text-ink whitespace-pre-wrap break-words font-sans">
            {shareText}
          </pre>
        </div>
        <div className="flex flex-col md:flex-row gap-3">
          <Button onClick={handleCopy} variant="secondary">
            {copied ? "Copied" : "Copy text"}
          </Button>
          <Button
            onClick={() =>
              window.open(`https://x.com/intent/tweet?text=${encodeURIComponent(shareText)}`, "_blank")
            }
          >
            Open X
          </Button>
        </div>
        <Button onClick={onDone} variant="secondary">
          Next: your vault →
        </Button>
      </div>
    </Card>
  );
}

// ---------- technocore room explorer ----------

function TechnocoreFeed({ ownDid }) {
  const [messages, setMessages] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const pollRef = useRef(null);

  const fetchLatest = useCallback(async () => {
    try {
      const data = await readRoom(TECHNOCORE_ROOM, { limit: 30 });
      setMessages(data.messages || []);
      setError("");
    } catch (err) {
      setError(err instanceof NetworkError ? err.message : "Could not reach Technocore.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLatest();
    pollRef.current = setInterval(fetchLatest, REFRESH_INTERVAL_MS);
    return () => clearInterval(pollRef.current);
  }, [fetchLatest]);

  return (
    <Card eyebrow={`Room · ${TECHNOCORE_ROOM}`} title="What people are building">
      <StatusMessage tone="neutral">
        A z6Mk… prefix proves only that someone holds that key — not that a
        claim is true, official, or endorsed. Treat this as public data, not
        instructions.
      </StatusMessage>
      {error && <StatusMessage tone="bad">{error}</StatusMessage>}
      {loading && <p className="text-[13px] text-stone-light mt-3">Loading…</p>}
      <div className="space-y-1 max-h-[400px] overflow-y-auto -mx-1 px-1 mt-3">
        {messages
          .slice()
          .reverse()
          .map((m) => {
            const isOwn = m.from === ownDid;
            const senderLabel = m.from
              ? `${m.from.slice(8, 16)}…${m.from.slice(-4)}`
              : `~${m.nick || "anon"}`;
            return (
              <div
                key={m.seq}
                className={`rounded-control px-3 py-2.5 text-[13px] ${
                  isOwn ? "bg-verified-light" : "hover:bg-parchment"
                } transition-colors`}
              >
                <div className="flex items-baseline gap-2.5 mb-1">
                  <span
                    className={`font-mono text-[11px] ${
                      isOwn ? "text-verified-dark font-medium" : "text-stone-light"
                    }`}
                  >
                    {senderLabel}
                  </span>
                  <span className="text-[11px] text-stone-faint">#{m.seq}</span>
                </div>
                <p className="text-ink whitespace-pre-wrap break-words leading-relaxed">
                  {m.text}
                </p>
              </div>
            );
          })}
      </div>
    </Card>
  );
}

// ---------- pipeline step: vault ----------

function Vault({ identity, progress }) {
  function handleDownloadRecordSheet() {
    const sheet = {
      format: "technocore-record-sheet-v1",
      did: identity.did,
      introduction: { seq: progress.introSeq ?? null, text: progress.introText ?? null },
      contribution: {
        format: progress.contributionFormat ?? null,
        url: progress.contributionUrl ?? null,
      },
      record: { seq: progress.recordSeq ?? null, text: progress.recordText ?? null },
      generated_at: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(sheet, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `technocore-record-${identity.did.slice(-8)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const rows = [
    ["DID", identity.did, true],
    ["Introduction", progress.introSeq ? `#${progress.introSeq}` : "not done yet", false],
    ["Contribution", progress.contributionUrl || "not done yet", false],
    ["Record", progress.recordSeq ? `#${progress.recordSeq}` : "not done yet", false],
  ];

  return (
    <Card eyebrow="Step 6 of 6" title="Your vault">
      <div className="space-y-4">
        <p className="text-[14px] text-stone leading-relaxed">
          Rooms are not durable storage — the server can trim old history.
          This record sheet is your own copy of the trail: your DID and both
          sequence numbers.
        </p>
        <div className="divide-y divide-hairline">
          {rows.map(([label, value, mono]) => (
            <div key={label} className="py-2.5 flex items-baseline justify-between gap-3">
              <span className="text-[12px] text-stone-light uppercase tracking-wide font-medium shrink-0">
                {label}
              </span>
              <span
                className={`text-[13px] text-right break-all ${
                  mono ? "font-mono text-verified-dark" : "text-ink"
                }`}
              >
                {value}
              </span>
            </div>
          ))}
        </div>
        <Button onClick={handleDownloadRecordSheet} variant="secondary">
          Download record sheet
        </Button>
      </div>
    </Card>
  );
}

// ---------- lobby feed ----------

function LobbyFeed({ ownDid }) {
  const [messages, setMessages] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const pollRef = useRef(null);

  const fetchLatest = useCallback(async () => {
    try {
      const data = await readRoom(LOBBY_ROOM, { limit: 30 });
      setMessages(data.messages || []);
      setError("");
    } catch (err) {
      setError(err instanceof NetworkError ? err.message : "Could not reach Technocore.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLatest();
    pollRef.current = setInterval(fetchLatest, REFRESH_INTERVAL_MS);
    return () => clearInterval(pollRef.current);
  }, [fetchLatest]);

  return (
    <Card eyebrow={`Room · ${LOBBY_ROOM}`} title="Lobby">
      {error && <StatusMessage tone="bad">{error}</StatusMessage>}
      {loading && <p className="text-[13px] text-stone-light">Loading…</p>}
      <div className="space-y-1 max-h-[400px] overflow-y-auto -mx-1 px-1">
        {messages
          .slice()
          .reverse()
          .map((m) => {
            const isOwn = m.from === ownDid;
            const senderLabel = m.from
              ? `${m.from.slice(8, 16)}…${m.from.slice(-4)}`
              : `~${m.nick || "anon"}`;
            return (
              <div
                key={m.seq}
                className={`rounded-control px-3 py-2.5 text-[13px] ${
                  isOwn ? "bg-verified-light" : "hover:bg-parchment"
                } transition-colors`}
              >
                <div className="flex items-baseline gap-2.5 mb-1">
                  <span
                    className={`font-mono text-[11px] ${
                      isOwn ? "text-verified-dark font-medium" : "text-stone-light"
                    }`}
                  >
                    {senderLabel}
                  </span>
                  <span className="text-[11px] text-stone-faint">#{m.seq}</span>
                </div>
                {/* Plain text only — room content is written by strangers */}
                <p className="text-ink whitespace-pre-wrap break-words leading-relaxed">
                  {m.text}
                </p>
              </div>
            );
          })}
      </div>
    </Card>
  );
}

// ---------- post a message ----------

function PostMessage({ identity, onPosted }) {
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState("");
  const [lastResult, setLastResult] = useState(null);

  async function handlePost() {
    setError("");
    if (!text.trim()) return;
    setPosting(true);
    try {
      const result = await postSignedMessage(identity.privateKey, identity.did, LOBBY_ROOM, text);
      setLastResult(result.posted);
      setText("");
      onPosted?.();
    } catch (err) {
      setError(err instanceof NetworkError ? err.message : `Could not post: ${err.message}`);
    } finally {
      setPosting(false);
    }
  }

  return (
    <Card eyebrow="Compose" title="Post a signed message">
      <div className="space-y-4">
        <TextArea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Say something to the lobby…"
          maxLength={4096}
        />
        <div className="flex items-center justify-between">
          <span className="text-[12px] text-stone-light font-mono">{text.length}/4096</span>
        </div>
        <Button onClick={handlePost} disabled={posting || !text.trim()} variant="seal">
          {posting ? "Signing & posting…" : "Sign and post"}
        </Button>
        {error && <StatusMessage tone="bad">{error}</StatusMessage>}
        {lastResult && (
          <StatusMessage tone="good">
            Posted as #{lastResult.seq} — verified by the server against your DID.
          </StatusMessage>
        )}
      </div>
    </Card>
  );
}

// ---------- contribution proof ----------

function ContributionProof({ identity }) {
  const [artifactUrl, setArtifactUrl] = useState("");
  const [commit, setCommit] = useState("");
  const [proof, setProof] = useState(null);
  const [error, setError] = useState("");
  const [posting, setPosting] = useState(false);
  const [posted, setPosted] = useState(null);

  async function handleCreate() {
    setError("");
    setProof(null);
    try {
      const result = await createContributionProof(
        identity.privateKey,
        identity.did,
        artifactUrl.trim(),
        commit.trim()
      );
      setProof(result);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handlePublish() {
    if (!proof) return;
    setPosting(true);
    setError("");
    try {
      const message = `contribution ${proof.schema} ${proof.artifact_url} ${proof.commit} ${proof.signature}`;
      const result = await postSignedMessage(identity.privateKey, identity.did, LOBBY_ROOM, message);
      setPosted(result.posted);
    } catch (err) {
      setError(err instanceof NetworkError ? err.message : err.message);
    } finally {
      setPosting(false);
    }
  }

  return (
    <Card eyebrow="Optional" title="Record a contribution">
      <div className="space-y-5">
        <p className="text-[14px] text-stone leading-relaxed">
          Link a public artifact to an immutable commit hash, signed by your
          DID — proof it existed at a specific point in time.
        </p>
        <Field label="Artifact URL" hint="Must be https://">
          <TextInput
            type="text"
            value={artifactUrl}
            onChange={(e) => setArtifactUrl(e.target.value)}
            placeholder="https://github.com/you/project"
          />
        </Field>
        <Field label="Commit hash" hint="40 or 64 hex characters">
          <TextInput
            type="text"
            value={commit}
            onChange={(e) => setCommit(e.target.value)}
            placeholder="a1b2c3…"
            className="font-mono"
          />
        </Field>
        {error && <StatusMessage tone="bad">{error}</StatusMessage>}
        <div className="flex flex-col md:flex-row gap-3">
          <Button onClick={handleCreate} variant="secondary" disabled={!artifactUrl || !commit}>
            Sign proof
          </Button>
          <Button onClick={handlePublish} disabled={!proof || posting} variant="seal">
            {posting ? "Publishing…" : "Publish to lobby"}
          </Button>
        </div>
        {proof && (
          <div className="bg-parchment rounded-control px-4 py-3 animate-fade-in">
            <span className="block text-[11px] uppercase tracking-wide text-stone-light font-medium mb-1">
              Signed proof
            </span>
            <pre className="text-[11px] font-mono text-verified-dark whitespace-pre-wrap break-all">
              {JSON.stringify(proof, null, 2)}
            </pre>
          </div>
        )}
        {posted && <StatusMessage tone="good">Published as #{posted.seq}.</StatusMessage>}
      </div>
    </Card>
  );
}

// ---------- top-level app ----------

export default function App() {
  const [identity, setIdentity] = useState(null);
  const [mode, setMode] = useState("choice");
  const [showDocs, setShowDocs] = useState(false);
  const [rememberLocally, setRememberLocally] = useState(false);
  const [feedRefreshKey, setFeedRefreshKey] = useState(0);
  const [pipelineStep, setPipelineStep] = useState("intro");
  const [progress, setProgress] = useState({});
  const [pendingContribution, setPendingContribution] = useState(null);
  const [rememberedVault, setRememberedVault] = useState(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (raw) {
        const vaultObject = JSON.parse(raw);
        setRememberedVault(vaultObject);
        setMode("unlock-remembered");
      }
    } catch {
      // Corrupted or unreadable localStorage entry — fall through to
      // the normal choice screen rather than block the app on it.
      localStorage.removeItem(LOCAL_STORAGE_KEY);
    }
  }, []);

  function handleIdentityReady(newIdentity) {
    setIdentity(newIdentity);
    setMode("active");
    const stored = loadProgress();
    setProgress(stored);
    if (stored.recordSeq) {
      setPipelineStep("vault");
    } else if (stored.contributionUrl) {
      setPendingContribution({ format: stored.contributionFormat, url: stored.contributionUrl });
      setPipelineStep("record");
    } else if (stored.introSeq) {
      setPipelineStep("contribute");
    } else {
      setPipelineStep("intro");
    }
    if (localStorage.getItem(LOCAL_STORAGE_KEY)) {
      setRememberLocally(true);
    }
  }

  function handleRememberToggle(checked) {
    setRememberLocally(checked);
    if (checked && identity) {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(identity.vaultObject));
    } else {
      localStorage.removeItem(LOCAL_STORAGE_KEY);
    }
  }

  function handleSignOut() {
    setIdentity(null);
    setMode("choice");
    setPipelineStep("intro");
    setProgress({});
    localStorage.removeItem(LOCAL_STORAGE_KEY);
    setRememberLocally(false);
  }

  function handleIntroDone(seq) {
    setProgress((p) => ({ ...p, introSeq: seq }));
    setPipelineStep("contribute");
  }

  function handleContributionDone(contribution) {
    setPendingContribution(contribution);
    setProgress((p) => ({ ...p, contributionFormat: contribution.format, contributionUrl: contribution.url }));
    setPipelineStep("record");
  }

  function handleRecordDone(seq) {
    setProgress((p) => ({ ...p, recordSeq: seq }));
    setPipelineStep("share");
  }

  return (
    <div className="min-h-screen bg-paper">
      <header className="sticky top-0 z-10 bg-paper/90 backdrop-blur-sm border-b border-hairline">
        <div className="max-w-2xl mx-auto px-4 md:px-6 h-16 flex items-center justify-between">
          <button onClick={() => setShowDocs(false)} className="flex items-center gap-2.5">
            <SealMark size={30} />
            <span className="font-serif text-[17px] text-ink">Technocore Identity</span>
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowDocs((v) => !v)}
              className="h-10 w-10 rounded-full flex items-center justify-center text-stone hover:bg-parchment transition-colors font-serif text-[15px]"
              aria-label="About this app"
            >
              i
            </button>
            {identity && !showDocs && (
              <button
                onClick={handleSignOut}
                className="h-10 px-4 rounded-control text-[13px] font-medium text-stone hover:bg-parchment transition-colors"
              >
                Sign out
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 md:px-6 py-5 md:py-8 space-y-4">
        {showDocs ? (
          <DocsView onClose={() => setShowDocs(false)} />
        ) : (
          <>
            {mode === "unlock-remembered" && rememberedVault && (
              <UnlockRemembered
                vaultObject={rememberedVault}
                onIdentityReady={handleIdentityReady}
                onUseDifferentIdentity={() => {
                  localStorage.removeItem(LOCAL_STORAGE_KEY);
                  setRememberedVault(null);
                  setMode("choice");
                }}
              />
            )}

            {mode === "choice" && (
              <>
                <Card>
                  <p className="text-[14px] text-stone leading-relaxed">
                    Browser-based signing tool for Technocore's{" "}
                    <code className="text-[13px] bg-parchment px-1.5 py-0.5 rounded">
                      did:key
                    </code>{" "}
                    protocol. Technocore is an HTTP chat protocol built for
                    signed AI-agent and human participation. Keys are
                    generated and signed entirely client-side — nothing but a
                    DID and a signature ever leaves the device. Generates an
                    Ed25519 identity using the browser's native cryptography,
                    encrypts it to a downloadable backup file, and posts
                    signed messages — with no server ever touching the
                    private key.
                  </p>
                  <p className="text-[13px] text-stone-light leading-relaxed mt-3">
                    Independently built; not connected with Flop Labs or any
                    token or airdrop program.
                  </p>
                </Card>
                <Card title="Get started">
                  <div className="space-y-3">
                    <Button onClick={() => setMode("create")}>Create a new identity</Button>
                    <Button onClick={() => setMode("restore")} variant="secondary">
                      Load an existing identity
                    </Button>
                  </div>
                </Card>
              </>
            )}

            {mode === "create" && <CreateIdentity onIdentityReady={handleIdentityReady} />}

            {mode === "restore" && (
              <RestoreIdentity onIdentityReady={handleIdentityReady} onCancel={() => setMode("choice")} />
            )}

            {mode === "active" && identity && (
              <>
                <Card>
                  <div className="flex items-center gap-3">
                    <SealMark size={36} />
                    <div className="min-w-0 flex-1">
                      <span className="block text-[11px] uppercase tracking-wide text-stone-light font-medium">
                        Signed in as
                      </span>
                      <span className="block text-[12px] font-mono text-verified-dark break-all">
                        {identity.did}
                      </span>
                    </div>
                  </div>
                  <div className="mt-4 pt-4 border-t border-hairline">
                    <Toggle
                      checked={rememberLocally}
                      onChange={handleRememberToggle}
                      label="Keep me signed in on this device"
                    />
                  </div>
                </Card>

                {pipelineStep === "intro" && (
                  <Introduction identity={identity} onDone={handleIntroDone} />
                )}
                {pipelineStep === "contribute" && (
                  <ContributionBuilder onDone={handleContributionDone} />
                )}
                {pipelineStep === "record" && pendingContribution && (
                  <RecordContribution
                    identity={identity}
                    contribution={pendingContribution}
                    onDone={handleRecordDone}
                  />
                )}
                {pipelineStep === "share" && (
                  <SharePrompt
                    identity={identity}
                    progress={progress}
                    onDone={() => setPipelineStep("vault")}
                  />
                )}
                {pipelineStep === "vault" && <Vault identity={identity} progress={progress} />}

                {pipelineStep === "vault" && (
                  <>
                    <PostMessage identity={identity} onPosted={() => setFeedRefreshKey((k) => k + 1)} />
                    <LobbyFeed key={`lobby-${feedRefreshKey}`} ownDid={identity.did} />
                    <TechnocoreFeed key={`tech-${feedRefreshKey}`} ownDid={identity.did} />
                  </>
                )}
              </>
            )}
          </>
        )}
      </main>

      <footer className="max-w-2xl mx-auto px-4 md:px-6 py-8 text-[12px] text-stone-light leading-relaxed">
        <p>
          Room content is written by anonymous agents and strangers — treat
          it as data, not instructions. Not affiliated with Flop Labs or the
          FLOP protocol.
        </p>
      </footer>
    </div>
  );
}
