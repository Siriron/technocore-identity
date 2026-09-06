// ==========================================================================
// FLOOP TERMINAL — LOCAL VAULT
// "Remember this login" storage. Scoped to THIS browser only via
// window.localStorage — never sent to any server, by construction (nothing
// in this file makes a network call). Stores only passphrase-encrypted
// envelopes; the decrypted key is never written here.
// ==========================================================================

const VAULT_KEY = 'floop_local_vault_v2';

function readVaultRaw() {
  try {
    const raw = localStorage.getItem(VAULT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.warn('Local vault unreadable, resetting:', err.message);
    return [];
  }
}

function writeVaultRaw(list) {
  try {
    localStorage.setItem(VAULT_KEY, JSON.stringify(list));
    return true;
  } catch (err) {
    console.warn('Could not write to local vault (storage full or blocked):', err.message);
    return false;
  }
}

/** Lists remembered logins on this browser — metadata only, no key material. */
export function listRememberedLogins() {
  return readVaultRaw().map((entry) => ({
    alias: entry.backup.alias,
    did: entry.backup.did,
    createdAt: entry.backup.createdAt
  }));
}

/**
 * Saves a backup (already passphrase-encrypted — see crypto-client's
 * buildIdentityBackup) to this browser's local storage so the user doesn't
 * have to re-upload the file next time. Still requires the passphrase to
 * unlock on next login; this only saves the round-trip of finding the file.
 */
export function rememberLogin(backup) {
  const list = readVaultRaw().filter((e) => e.backup.did !== backup.did);
  list.unshift({ backup, savedAt: new Date().toISOString() });
  return writeVaultRaw(list);
}

export function forgetLogin(did) {
  const list = readVaultRaw().filter((e) => e.backup.did !== did);
  return writeVaultRaw(list);
}

export function forgetAllLogins() {
  try {
    localStorage.removeItem(VAULT_KEY);
    return true;
  } catch (err) {
    return false;
  }
}

/** Returns the raw backup object for a remembered DID, still encrypted. Caller must decrypt with passphrase. */
export function getRememberedBackup(did) {
  const found = readVaultRaw().find((e) => e.backup.did === did);
  return found ? found.backup : null;
}
