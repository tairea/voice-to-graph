// Gun graph init, DID identity, path helpers, and a remote event emitter
// used by pharos-store.js for network-mirrored writes and incoming-share
// subscriptions. Persistence is handled separately by pharos-store.js
// (synchronous JSON file). Gun is the network sync layer only.

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';

const require = createRequire(import.meta.url);
const Gun = require('gun');
require('gun/lib/radisk');
require('gun/lib/store');
require('gun/lib/rfs');
const SEA = require('gun/sea');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const IDENTITY_FILE = path.join(DATA_DIR, 'identity.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ─── DID identity (persistent SEA keypair) ───────────────────────────────────

async function getOrCreateIdentity() {
  if (fs.existsSync(IDENTITY_FILE)) {
    return JSON.parse(fs.readFileSync(IDENTITY_FILE, 'utf-8'));
  }
  const pair = await SEA.pair();
  const ident = {
    did: `did:gun:${pair.pub}`,
    pair,
    name: process.env.PHAROS_NAME || null,
    created: new Date().toISOString(),
  };
  fs.writeFileSync(IDENTITY_FILE, JSON.stringify(ident, null, 2), 'utf-8');
  console.log(`[gun-store] generated new identity: ${ident.did}`);
  return ident;
}

const identity = await getOrCreateIdentity();
export const did = identity.did;
export const seaPair = identity.pair;

// ─── Gun init ────────────────────────────────────────────────────────────────

const RELAY_URL = process.env.GUN_RELAY_URL || 'http://localhost:8765/gun';
const peers = RELAY_URL ? [RELAY_URL] : [];

const gun = Gun({
  peers,
  file: path.join(DATA_DIR, 'gun'),
  radisk: true,
  localStorage: false,
  multicast: false,
});

console.log(`[gun-store] DID: ${did}`);
console.log(`[gun-store] relay: ${RELAY_URL || '(none — offline mode)'}`);

// ─── Path helpers ────────────────────────────────────────────────────────────

export const $ = (p) => gun.get(`pharos>${p}`);
export const $u = (d, p) => $(`users>${d}>${p}`);
export const $pub = (sid, p) => $(`public>${sid}>${p}`);
export const $inbox = (d, sid, p) => $(`inbox>${d}>${sid}>${p}`);

export const PATHS = {
  profile:      (d) => $u(d, 'profile'),
  nodes:        (d) => $u(d, 'graph>nodes'),
  claims:       (d) => $u(d, 'graph>claims'),
  contexts:     (d) => $u(d, 'graph>contexts'),
  publicNodes:  (sid) => $pub(sid, 'graph>nodes'),
  publicClaims: (sid) => $pub(sid, 'graph>claims'),
  publicMeta:   (sid) => $pub(sid, 'meta'),
  publicIndex:  () => $('publicSpaces'),
  inboxNodes:   (d, sid) => $inbox(d, sid, 'graph>nodes'),
  inboxClaims:  (d, sid) => $inbox(d, sid, 'graph>claims'),
  inboxMeta:    (d, sid) => $inbox(d, sid, 'meta'),
  inboxRoot:    (d) => $(`inbox>${d}`),
  peers:        () => $('peers'),
  peer:         (peerDID) => $(`peers>${peerDID}`),
  peerShared:   (peerDID) => $u(peerDID, 'shared>nodes'),
  peerSharedClaims: (peerDID) => $u(peerDID, 'shared>claims'),
};

// ─── Profile publish (best-effort — visible in the network) ──────────────────

PATHS.profile(did).put({
  did,
  name: identity.name,
  pub: seaPair.pub,
  relayAddress: RELAY_URL,
  updated: new Date().toISOString(),
});

// ─── Remote event emitter (consumed by SSE) ──────────────────────────────────

export const remoteEvents = new EventEmitter();
remoteEvents.setMaxListeners(50);

export { gun, SEA, identity };
