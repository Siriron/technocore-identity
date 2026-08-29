import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  generateKeyPair,
  exportRawPublicKey,
  exportPkcs8PrivateKey,
  importPkcs8PrivateKey,
  didFromPublicKeyBytes,
  createContributionProof,
} from "./crypto-core.js";
import { encryptIdentity, decryptIdentity, VaultError } from "./identity-vault.js";
import { readRoom, postSignedMessage, NetworkError } from "./technocore-client.js";
import { Card, Button, Field, TextInput, TextArea, StatusMessage, Toggle } from "./components/ui.jsx";
import { SealMark } from "./components/SealMark.jsx";
import { DocsView } from "./components/DocsView.jsx";

const LOBBY_ROOM = "lobby";
const REFRESH_INTERVAL_MS = 8000;
const LOCAL_STORAGE_KEY = "technocore-web-vault-v1";

// ---------- identity creation flow ----------

function CreateIdentity({ onIdentityReady }) {
  const [step, setStep] = useState("intro");
  const [passphrase, setPassphrase] = useState("");
  const [passphraseConfirm, setPassphraseConfirm] = useState("");
  const [error, setError] = useState("");
  const [generated, setGenerated] = useState(null);
  const [backupConfirmed, setBackupConfirmed] = useState(false);
  const [downloadedOnce, setDownloadedOnce] = useState(false);

  const passphraseValid = passphrase.length >= 12;
  const passphrasesMatch = passphrase === passphraseConfirm && passphrase.length > 0;

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
            Download the backup file now. Closing this tab without
            downloading means starting over with a new identity.
          </StatusMessage>
          <Button onClick={handleDownload} variant="secondary">
            Download backup file
          </Button>
          {downloadedOnce && (
            <label className="flex items-start gap-3 cursor-pointer animate-fade-in">
              <input
                type="checkbox"
                checked={backupConfirmed}
                onChange={(e) => setBackupConfirmed(e.target.checked)}
                className="mt-0.5 h-5 w-5 rounded accent-verified shrink-0"
              />
              <span className="text-[13px] text-stone leading-relaxed">
                I've saved the backup file somewhere durable — not just this
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
  const [vaultObject, setVaultObject] = useState(null);
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleFile(e) {
    setError("");
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      setVaultObject(JSON.parse(text));
    } catch {
      setError("Could not read that file as a Technocore identity backup.");
      setVaultObject(null);
    }
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
      <div className="space-y-4">
        <Field label="Backup file">
          <input
            type="file"
            accept="application/json"
            onChange={handleFile}
            className="w-full text-[14px] text-stone file:mr-3 file:h-[44px] file:px-4 file:rounded-control file:border-0 file:bg-parchment file:text-ink file:font-medium file:text-[13px]"
          />
        </Field>
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

  function handleIdentityReady(newIdentity) {
    setIdentity(newIdentity);
    setMode("active");
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
    localStorage.removeItem(LOCAL_STORAGE_KEY);
    setRememberLocally(false);
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
            {mode === "choice" && (
              <Card title="Get started">
                <div className="space-y-3">
                  <Button onClick={() => setMode("create")}>Create a new identity</Button>
                  <Button onClick={() => setMode("restore")} variant="secondary">
                    Load an existing identity
                  </Button>
                </div>
              </Card>
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

                <PostMessage identity={identity} onPosted={() => setFeedRefreshKey((k) => k + 1)} />
                <LobbyFeed key={feedRefreshKey} ownDid={identity.did} />
                <ContributionProof identity={identity} />
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
