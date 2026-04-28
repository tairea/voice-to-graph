// PHAROS node/claim/context store. Source of truth during runtime is the
// in-memory Map+Array; persistence is synchronous JSON-file write on every
// mutation; network sync is via Gun (gun-store.js) which mirrors writes and
// receives remote shared subtrees.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gun, did, SEA, PATHS, $u, remoteEvents, identity } from './gun-store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, 'pharos-data.json');

// ─── In-memory store ─────────────────────────────────────────────────────────

const nodes = new Map();
const claims = [];
const contexts = new Map();
const codeMap = new Map();
const publicSpaces = new Map(); // spaceId → meta
const peers = new Map();        // peerDID → { name, relayAddress, addedAt }

let nextBranchCharCode = 65;
const branchCounters = {};

// ─── Persistence ─────────────────────────────────────────────────────────────

function persist() {
  const state = {
    nodes: Object.fromEntries(nodes),
    claims,
    contexts: Object.fromEntries(contexts),
    codeMap: Object.fromEntries(codeMap),
    publicSpaces: Object.fromEntries(publicSpaces),
    peers: Object.fromEntries(peers),
    branchCounters,
    nextBranchCharCode,
  };
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

function rehydrate() {
  try {
    if (!fs.existsSync(DATA_FILE)) return;
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    const state = JSON.parse(raw);
    if (state.nodes) for (const [id, n] of Object.entries(state.nodes)) nodes.set(id, n);
    if (state.claims) claims.push(...state.claims);
    if (state.contexts) for (const [id, c] of Object.entries(state.contexts)) contexts.set(id, c);
    if (state.codeMap) for (const [id, c] of Object.entries(state.codeMap)) codeMap.set(id, c);
    if (state.publicSpaces) for (const [id, m] of Object.entries(state.publicSpaces)) publicSpaces.set(id, m);
    if (state.peers) for (const [d, p] of Object.entries(state.peers)) peers.set(d, p);
    if (state.branchCounters) Object.assign(branchCounters, state.branchCounters);
    if (state.nextBranchCharCode) nextBranchCharCode = state.nextBranchCharCode;
    console.log(`[pharos-store] rehydrated — ${nodes.size} nodes, ${claims.length} claims, ${contexts.size} contexts`);
  } catch (err) {
    console.error('[pharos-store] rehydrate error:', err);
  }
}

rehydrate();

// ─── Mirror to Gun (fire-and-forget) ─────────────────────────────────────────

function mirrorNode(node) {
  try { PATHS.nodes(did).get(node.id).put(stripGunMeta(node)); } catch {}
}
function mirrorClaim(claim) {
  try { PATHS.claims(did).get(claim.id).put(stripGunMeta(claim)); } catch {}
}
function mirrorContext(ctx) {
  try { PATHS.contexts(did).get(ctx.id).put(stripGunMeta(ctx)); } catch {}
}

function stripGunMeta(obj) {
  if (!obj) return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === '_' || k === '#') continue;
    if (Array.isArray(v)) out[k] = v;
    else if (v && typeof v === 'object') out[k] = JSON.stringify(v);
    else out[k] = v;
  }
  return out;
}

// One-time mirror of existing data to Gun (idempotent under CRDT)
function mirrorExistingToGun() {
  let n = 0;
  for (const node of nodes.values()) { mirrorNode(node); n++; }
  let c = 0;
  for (const claim of claims) { mirrorClaim(claim); c++; }
  if (n + c > 0) console.log(`[pharos-store] mirrored ${n} nodes / ${c} claims to Gun`);
}
mirrorExistingToGun();

// ─── Bootstrap ───────────────────────────────────────────────────────────────

const bootstrapPromises = [Promise.resolve()];
export function awaitBootstrap() { return Promise.all(bootstrapPromises); }

// ─── Branch code management ──────────────────────────────────────────────────

export function allocBranch() {
  const letter = String.fromCharCode(nextBranchCharCode++);
  if (nextBranchCharCode > 90) nextBranchCharCode = 65;
  branchCounters[letter] = 0;
  return letter;
}

export function nextCodeInBranch(branch) {
  branchCounters[branch] = (branchCounters[branch] || 0) + 1;
  return `${branch}${branchCounters[branch]}`;
}

// ─── Node operations ─────────────────────────────────────────────────────────

export function addNode(node) {
  if (nodes.has(node.id)) return nodes.get(node.id);
  const enriched = { ...node, expressionCount: 0, created: new Date().toISOString() };
  nodes.set(node.id, enriched);
  persist();
  mirrorNode(enriched);
  return nodes.get(node.id);
}

export function getNode(id) { return nodes.get(id) || null; }
export function getAllNodes() { return [...nodes.values()]; }

export function updateNode(id, patch) {
  const node = nodes.get(id);
  if (!node) return null;
  const updated = { ...node, ...patch, updated: new Date().toISOString() };
  nodes.set(id, updated);
  persist();
  mirrorNode(updated);
  return updated;
}

export function incrementExpression(nodeId) {
  const node = nodes.get(nodeId);
  if (node) {
    node.expressionCount = (node.expressionCount || 0) + 1;
    persist();
    mirrorNode(node);
  }
}

export function removeNode(id) {
  if (!id || id === 'me' || !nodes.has(id)) return { removed: [], removedClaims: [] };

  // Compute id's ancestry BEFORE we mutate the tree so we know which public
  // spaces transitively contain it. (A space rooted at any ancestor of id
  // includes the subtree we are about to remove.)
  const ancestry = new Set();
  {
    let cur = id;
    const seen = new Set();
    while (cur && cur !== 'me' && !seen.has(cur) && nodes.has(cur)) {
      seen.add(cur);
      ancestry.add(cur);
      cur = nodes.get(cur).parent_id;
    }
  }

  // Categorise public spaces affected by this removal
  const spacesToStop = [];      // root being removed → entire space dies
  const spacesToTombstone = []; // subtree partially removed → null individual ids
  for (const space of publicSpaces.values()) {
    if (space.root_node_id === id) {
      spacesToStop.push(space.id);
    } else if (space.root_node_id === 'me' || ancestry.has(space.root_node_id)) {
      spacesToTombstone.push(space.id);
    }
  }

  const removed = [];
  const removedClaims = [];

  function visit(nodeId) {
    if (!nodes.has(nodeId)) return;
    const childIds = [];
    for (const [cid, child] of nodes) {
      if (child.parent_id === nodeId) childIds.push(cid);
    }
    for (const cid of childIds) visit(cid);

    for (let i = claims.length - 1; i >= 0; i--) {
      if (claims[i].subject_node === nodeId || claims[i].object_node === nodeId) {
        const cid = claims[i].id;
        try { PATHS.claims(did).get(cid).put(null); } catch {}
        removedClaims.push(cid);
        claims.splice(i, 1);
      }
    }
    nodes.delete(nodeId);
    codeMap.delete(nodeId);
    try { PATHS.nodes(did).get(nodeId).put(null); } catch {}
    // Avatar-linked shares are a flat namespace under our DID; null
    // best-effort regardless of whether this node was actually linked.
    try { $u(did, 'shared>nodes').get(nodeId).put(null); } catch {}
    removed.push(nodeId);
  }

  visit(id);

  // Tombstone the removed ids inside any public space that still exists
  for (const spaceId of spacesToTombstone) {
    for (const rid of removed) {
      try { PATHS.publicNodes(spaceId).get(rid).put(null); } catch {}
    }
    for (const cid of removedClaims) {
      try { PATHS.publicClaims(spaceId).get(cid).put(null); } catch {}
    }
  }
  for (const cid of removedClaims) {
    try { $u(did, 'shared>claims').get(cid).put(null); } catch {}
  }

  // Spaces whose root we just deleted are gone entirely
  for (const spaceId of spacesToStop) {
    stopPublic(spaceId);
  }

  persist();
  if (spacesToStop.length || spacesToTombstone.length) {
    console.log(`[pharos-store] removeNode ${id}: ${removed.length} nodes / ${removedClaims.length} claims; tombstoned in ${spacesToTombstone.length} space(s); stopped ${spacesToStop.length} space(s)`);
  }
  return { removed, removedClaims };
}

export function moveNode(id, newParentId) {
  const node = nodes.get(id);
  if (!node) return null;
  const updated = { ...node, parent_id: newParentId || 'me', updated: new Date().toISOString() };
  nodes.set(id, updated);
  persist();
  mirrorNode(updated);
  return updated;
}

// ─── Claim operations ────────────────────────────────────────────────────────

export function addClaim(claim) {
  const existing = claims.find(c => c.id === claim.id);
  if (existing) return existing;
  const enriched = { ...claim, created: new Date().toISOString() };
  claims.push(enriched);
  persist();
  mirrorClaim(enriched);
  return enriched;
}

export function getClaimsForNode(nodeId) {
  return claims.filter(c => c.subject_node === nodeId || c.object_node === nodeId);
}
export function getAllClaims() { return [...claims]; }

// ─── Context operations ──────────────────────────────────────────────────────

export function addContext(ctx) {
  contexts.set(ctx.id, ctx);
  persist();
  mirrorContext(ctx);
  return ctx;
}
export function getContext(id) { return contexts.get(id) || null; }

// ─── Code management ─────────────────────────────────────────────────────────

export function assignCode(nodeId, parentId) {
  if (codeMap.has(nodeId)) return codeMap.get(nodeId);
  const parentCode = codeMap.get(parentId);
  const branch = parentId === 'me' || !parentCode
    ? allocBranch()
    : parentCode.replace(/\d+$/, '');
  const code = nextCodeInBranch(branch);
  codeMap.set(nodeId, code);
  updateNode(nodeId, { code, branch });
  return code;
}

export function getCode(nodeId) { return codeMap.get(nodeId) || null; }

export function findByCode(code) {
  for (const [nodeId, c] of codeMap) {
    if (c.toLowerCase() === code.toLowerCase()) return getNode(nodeId);
  }
  return null;
}

export function findByName(name) {
  const lower = name.toLowerCase();
  for (const node of nodes.values()) {
    if (node.canonical_name?.toLowerCase() === lower) return node;
    if (node.aliases && node.aliases.some(a => a.toLowerCase() === lower)) return node;
  }
  return null;
}

export function resolveRef(ref) {
  if (!ref || ref === 'me') return null;
  return findByCode(ref) || findByName(ref) || getNode(ref) || null;
}

export function getStoreSummary() {
  return getAllNodes().map(n => ({
    id: n.id,
    code: n.code || null,
    canonical_name: n.canonical_name,
    definition_core: n.definition_core,
    type: n.type,
    resonance_state: n.resonance_state,
    confidence: n.confidence,
  }));
}

// ─── Identity ────────────────────────────────────────────────────────────────

export function getDid() { return did; }
export function getIdentity() {
  return { did, name: identity.name, pub: identity.pair?.pub || null };
}

// ─── Subtree collection ──────────────────────────────────────────────────────

export function collectSubtree(rootId) {
  const subtreeNodes = new Map();
  const subtreeClaims = new Map();

  // 'me' is the avatar pseudo-root: treat it as the whole graph
  if (rootId === 'me') {
    for (const [nid, n] of nodes) subtreeNodes.set(nid, n);
    for (const c of claims) subtreeClaims.set(c.id, c);
    return { nodes: subtreeNodes, claims: subtreeClaims };
  }

  const queue = [rootId];
  while (queue.length) {
    const id = queue.shift();
    if (subtreeNodes.has(id)) continue;
    const node = nodes.get(id);
    if (!node) continue;
    subtreeNodes.set(id, node);
    for (const c of claims) {
      if (c.subject_node === id || c.object_node === id) {
        subtreeClaims.set(c.id, c);
      }
    }
    for (const [nid, n] of nodes) {
      if (n.parent_id === id) queue.push(nid);
    }
  }
  return { nodes: subtreeNodes, claims: subtreeClaims };
}

// ─── Public sharing ──────────────────────────────────────────────────────────

function shareRootDescriptor(rootNodeId) {
  if (rootNodeId === 'me') {
    return { id: 'me', canonical_name: identity.name ? `${identity.name}'s graph` : 'graph' };
  }
  return nodes.get(rootNodeId);
}

export function makePublic(rootNodeId) {
  const subtree = collectSubtree(rootNodeId);
  const rootNode = shareRootDescriptor(rootNodeId);
  if (!rootNode) throw new Error(`node ${rootNodeId} not found`);
  const spaceId = `public-${rootNodeId}`;
  const meta = {
    id: spaceId,
    name: rootNode.canonical_name || 'shared',
    owner_did: did,
    owner_name: identity.name || null,
    root_node_id: rootNodeId,
    created: new Date().toISOString(),
  };

  publicSpaces.set(spaceId, meta);
  persist();

  PATHS.publicMeta(spaceId).put(meta);
  PATHS.publicIndex().get(spaceId).put({ id: spaceId, owner_did: did, name: meta.name });

  for (const [id, node] of subtree.nodes) {
    PATHS.publicNodes(spaceId).get(id).put(stripGunMeta({ ...node, _sharedSpace: spaceId, _owner_did: did }));
  }
  for (const [id, claim] of subtree.claims) {
    PATHS.publicClaims(spaceId).get(id).put(stripGunMeta({ ...claim, _sharedSpace: spaceId, _owner_did: did }));
  }
  console.log(`[share] makePublic ${rootNodeId} → ${spaceId} (${subtree.nodes.size} nodes / ${subtree.claims.size} claims)`);
  return spaceId;
}

export function stopPublic(spaceId) {
  publicSpaces.delete(spaceId);
  persist();
  PATHS.publicMeta(spaceId).put(null);
  PATHS.publicIndex().get(spaceId).put(null);
  console.log(`[share] stopPublic ${spaceId}`);
}

export function getPublicSpaces() {
  return [...publicSpaces.values()];
}

// ─── Specific (encrypted) sharing ────────────────────────────────────────────

export async function shareWithSpecific(rootNodeId, recipientDID) {
  if (!recipientDID) throw new Error('recipientDID required');
  const subtree = collectSubtree(rootNodeId);
  const rootNode = shareRootDescriptor(rootNodeId);
  if (!rootNode) throw new Error(`node ${rootNodeId} not found`);

  const spaceId = `inbox-${rootNodeId}-${Date.now()}`;
  const sharedKey = await SEA.secret(recipientDID, identity.pair);
  if (!sharedKey) throw new Error('failed to derive shared key');

  const meta = {
    id: spaceId,
    name: rootNode.canonical_name || 'shared',
    owner_did: did,
    owner_name: identity.name || null,
    recipient_did: recipientDID,
    root_node_id: rootNodeId,
    created: new Date().toISOString(),
  };

  PATHS.inboxMeta(recipientDID, spaceId).put(meta);

  for (const [id, node] of subtree.nodes) {
    const enc = await SEA.encrypt({ ...node, _sharedSpace: spaceId, _owner_did: did }, sharedKey);
    PATHS.inboxNodes(recipientDID, spaceId).get(id).put({ enc });
  }
  for (const [id, claim] of subtree.claims) {
    const enc = await SEA.encrypt({ ...claim, _sharedSpace: spaceId, _owner_did: did }, sharedKey);
    PATHS.inboxClaims(recipientDID, spaceId).get(id).put({ enc });
  }
  console.log(`[share] shareWithSpecific ${rootNodeId} → ${recipientDID} (${spaceId})`);
  return spaceId;
}

// ─── Avatar (peer-to-peer) sharing ───────────────────────────────────────────

export function linkToAvatar(rootNodeId) {
  const subtree = collectSubtree(rootNodeId);
  const spaceId = `peer-${rootNodeId}`;
  for (const [id, node] of subtree.nodes) {
    $u(did, `shared>nodes`).get(id).put(stripGunMeta({ ...node, _sharedSpace: spaceId, _owner_did: did }));
  }
  for (const [id, claim] of subtree.claims) {
    $u(did, `shared>claims`).get(id).put(stripGunMeta({ ...claim, _sharedSpace: spaceId, _owner_did: did }));
  }
  console.log(`[share] linkToAvatar ${rootNodeId} → ${spaceId}`);
  return spaceId;
}

// ─── Peer management ─────────────────────────────────────────────────────────

export function addPeer(peerDID, info = {}) {
  const entry = {
    did: peerDID,
    name: info.name || null,
    relayAddress: info.relayAddress || null,
    addedAt: new Date().toISOString(),
  };
  peers.set(peerDID, entry);
  persist();
  PATHS.peer(peerDID).put(entry);
  // Auto-subscribe to that peer's shared-with-avatar space
  subscribeToPeerShared(peerDID);
  return entry;
}

export function removePeer(peerDID) {
  peers.delete(peerDID);
  persist();
  PATHS.peer(peerDID).put(null);
}

export function getPeerList() { return [...peers.values()]; }

// ─── Remote subscription handlers ────────────────────────────────────────────

function ingestRemoteNode(rawNode, spaceId, ownerDID) {
  if (!rawNode || !rawNode.id) return;
  const enriched = {
    ...rawNode,
    _sharedSpace: spaceId,
    _owner_did: ownerDID || rawNode._owner_did || null,
  };
  remoteEvents.emit('node', { node: enriched, spaceId });
}

function ingestRemoteClaim(rawClaim, spaceId, ownerDID) {
  if (!rawClaim || !rawClaim.id) return;
  const enriched = {
    ...rawClaim,
    _sharedSpace: spaceId,
    _owner_did: ownerDID || rawClaim._owner_did || null,
  };
  remoteEvents.emit('claim', { claim: enriched, spaceId });
}

export function onRemoteNode(cb) {
  remoteEvents.on('node', cb);
  return () => remoteEvents.off('node', cb);
}
export function onRemoteClaim(cb) {
  remoteEvents.on('claim', cb);
  return () => remoteEvents.off('claim', cb);
}

// ─── Subscribe to public spaces ──────────────────────────────────────────────

const subscribedSpaces = new Set();

export function subscribeToPublicSpace(spaceId) {
  if (subscribedSpaces.has(`pub:${spaceId}`)) return;
  subscribedSpaces.add(`pub:${spaceId}`);
  PATHS.publicMeta(spaceId).on(meta => {
    if (!meta) return;
    PATHS.publicNodes(spaceId).map().on((node, id) => {
      if (!node || id === '_') return;
      ingestRemoteNode({ ...node, id }, spaceId, meta.owner_did);
    });
    PATHS.publicClaims(spaceId).map().on((claim, id) => {
      if (!claim || id === '_') return;
      ingestRemoteClaim({ ...claim, id }, spaceId, meta.owner_did);
    });
  });
}

export function subscribeToPublicIndex() {
  PATHS.publicIndex().map().on((info, spaceId) => {
    if (!info || spaceId === '_') return;
    if (info.owner_did === did) return; // skip our own
    subscribeToPublicSpace(spaceId);
  });
}

// ─── Subscribe to inbox (decrypt with derived shared key) ────────────────────

export function subscribeToInbox() {
  PATHS.inboxRoot(did).map().on(async (spaceData, spaceId) => {
    if (!spaceData || spaceId === '_') return;
    if (subscribedSpaces.has(`inbox:${spaceId}`)) return;
    subscribedSpaces.add(`inbox:${spaceId}`);

    const meta = await new Promise(resolve =>
      PATHS.inboxMeta(did, spaceId).once(m => resolve(m))
    );
    if (!meta || !meta.owner_did) {
      subscribedSpaces.delete(`inbox:${spaceId}`);
      return;
    }

    const sharedKey = await SEA.secret(meta.owner_did, identity.pair);
    if (!sharedKey) return;

    PATHS.inboxNodes(did, spaceId).map().on(async (entry, id) => {
      if (!entry || id === '_' || !entry.enc) return;
      try {
        const node = await SEA.decrypt(entry.enc, sharedKey);
        if (node) ingestRemoteNode({ ...node, id }, spaceId, meta.owner_did);
      } catch (err) {
        console.warn('[inbox] decrypt failed for node', id, err.message);
      }
    });
    PATHS.inboxClaims(did, spaceId).map().on(async (entry, id) => {
      if (!entry || id === '_' || !entry.enc) return;
      try {
        const claim = await SEA.decrypt(entry.enc, sharedKey);
        if (claim) ingestRemoteClaim({ ...claim, id }, spaceId, meta.owner_did);
      } catch (err) {
        console.warn('[inbox] decrypt failed for claim', id, err.message);
      }
    });
  });
}

// ─── Subscribe to a peer's avatar-shared space ──────────────────────────────

export function subscribeToPeerShared(peerDID) {
  if (subscribedSpaces.has(`peer:${peerDID}`)) return;
  subscribedSpaces.add(`peer:${peerDID}`);
  const spaceId = `peer-${peerDID}`;
  PATHS.peerShared(peerDID).map().on((node, id) => {
    if (!node || id === '_') return;
    ingestRemoteNode({ ...node, id }, spaceId, peerDID);
  });
  PATHS.peerSharedClaims(peerDID).map().on((claim, id) => {
    if (!claim || id === '_') return;
    ingestRemoteClaim({ ...claim, id }, spaceId, peerDID);
  });
}

// Auto-subscribe to all known peers on startup
for (const peerDID of peers.keys()) subscribeToPeerShared(peerDID);
// Auto-subscribe to inbox + public index
subscribeToInbox();
subscribeToPublicIndex();
