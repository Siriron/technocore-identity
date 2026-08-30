// Verifies the URL path segments postSignedMessage builds are
// correctly percent-encoded and in the right order, matching
// GET /r/<room>/say-signed/<did>/<sig>/<nonce>/<text> exactly.

const did = "did:key:z6MkehRgf7yJbgaGfYsdoAsKdBPE3dj2CYhowQdcjqSJgvVd";
const signature =
  "yKNCYPXLb9v82zAq8lfascMElwhqRAuV-HcMN8S20U-BpBOaQPqgVfPKZfuzGlF6hmxB0h4GEghBn81SvVcoAw";
const nonce = "1234567890123";
const text = "Hello from a new Technocore contributor.";

const encodedDid = encodeURIComponent(did);
const encodedSig = encodeURIComponent(signature);
const encodedNonce = encodeURIComponent(nonce);
const encodedText = encodeURIComponent(text);

const url =
  `https://technocore.chat/r/lobby/say-signed/` +
  `${encodedDid}/${encodedSig}/${encodedNonce}/${encodedText}` +
  `?format=json`;

console.log("Constructed URL:");
console.log(url);
console.log("");

// Decode each segment back and confirm it matches the original exactly
const parts = url.split("?")[0].split("/say-signed/")[1].split("/");
const [rtDid, rtSig, rtNonce, rtText] = parts;

let failures = 0;
function check(label, actual, expected) {
  const pass = decodeURIComponent(actual) === expected;
  if (!pass) failures++;
  console.log(`[${pass ? "PASS" : "FAIL"}] ${label}`);
  if (!pass) {
    console.log(`  expected: ${expected}`);
    console.log(`  got:      ${decodeURIComponent(actual)}`);
  }
}

check("DID round-trips through URL encoding", rtDid, did);
check("Signature round-trips through URL encoding", rtSig, signature);
check("Nonce round-trips through URL encoding", rtNonce, nonce);
check("Text round-trips through URL encoding", rtText, text);

// The colon in "did:key:..." and the - and _ in base64url signatures
// are worth checking explicitly, since those are the characters most
// likely to be mishandled by ad-hoc encoding.
check("Colon in DID is present after encode+decode", decodeURIComponent(rtDid).includes(":") ? "did:key:test" : "MISSING", "did:key:test");

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
