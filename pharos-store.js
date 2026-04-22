// In-memory PHAROS node/claim/context store with GUN file persistence.
// Server-side source of truth for identity resolution.

import Gun from 'gun';
import 'gun/sea';

// ─── GUN setup ───────────────────────────────────────────────────────────────

// Local file persistence — no relay server needed for single-user.
const gun = Gun({
  file: 'pharos-data.json',
  radisk: true,
  localStorage: false
});

const gunNodes = gun.get('pharos').get('nodes');
const gunClaims = gun.get('pharos').get('claims');
const gunContexts = gun.get('pharos').get('contexts');

// ─── In-memory store (source of truth during runtime) ───────────────────────

const nodes = new Map();   // id → node object
const claims = [];          // all claims
const contexts = new Map(); // id → context object
const codeMap = new Map();  // pharos-id → display code (e.g. "A1")

let nextBranchCharCode = 65;
const branchCounters = {};

// ─── Bootstrap: load persisted data from GUN into memory ──────────────────────

let bootstrapped = false;
const bootstrapPromises = [];

export function awaitBootstrap() {
  return Promise.all(bootstrapPromises);
}

function bootstrap() {
  return new Promise((resolve) => {
    let nodesLoaded = false;
    let claimsLoaded = false;
    let contextsLoaded = false;

    function checkDone() {
      if (nodesLoaded && claimsLoaded && contextsLoaded) {
        bootstrapped = true;
        console.log(`[pharos-store] bootstrapped from GUN — ${nodes.size} nodes, ${claims.length} claims, ${contexts.size} contexts`);
        resolve();
      }
    }

    gunNodes.map().on((nodeData, nodeId) => {
      if (!nodeData || typeof nodeData !== 'object') return;
      if (nodes.has(nodeId)) return; // already in memory, skip (latest write wins)
      nodes.set(nodeId, { ...nodeData, expressionCount: nodeData.expressionCount || 0 });
    });

    gunClaims.map().on((claimData, claimId) => {
      if (!claimData || typeof claimData !== 'object') return;
      if (claims.find(c => c.id === claimId)) return;
      claims.push({ ...claimData, created: claimData.created || new Date().toISOString() });
    });

    gunContexts.map().on((ctxData, ctxId) => {
      if (!ctxData || typeof ctxData !== 'object') return;
      if (contexts.has(ctxId)) return;
      contexts.set(ctxId, ctxData);
    });

    // Give GUN a moment to load from file, then resolve
    setTimeout(() => {
      nodesLoaded = true;
      claimsLoaded = true;
      contextsLoaded = true;
      checkDone();
    }, 500);
  });
}

bootstrapPromises.push(bootstrap());

// ─── Branch code management ────────────────────────────────────────────────────

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

// ─── Node operations ───────────────────────────────────────────────────────────

export function addNode(node) {
  if (nodes.has(node.id)) return nodes.get(node.id);
  const enriched = { ...node, expressionCount: 0, created: new Date().toISOString() };
  nodes.set(node.id, enriched);
  // Persist to GUN
  gunNodes.get(node.id).put(enriched);
  return nodes.get(node.id);
}

export function getNode(id) {
  return nodes.get(id) || null;
}

export function getAllNodes() {
  return [...nodes.values()];
}

export function updateNode(id, patch) {
  const node = nodes.get(id);
  if (!node) return null;
  const updated = { ...node, ...patch, updated: new Date().toISOString() };
  nodes.set(id, updated);
  // Persist to GUN
  gunNodes.get(id).put(updated);
  return updated;
}

export function incrementExpression(nodeId) {
  const node = nodes.get(nodeId);
  if (node) {
    node.expressionCount = (node.expressionCount || 0) + 1;
    // Persist updated expression count to GUN
    gunNodes.get(nodeId).put({ ...node });
  }
}

// ─── Claim operations ─────────────────────────────────────────────────────────

export function addClaim(claim) {
  const existing = claims.find(c => c.id === claim.id);
  if (existing) return existing;
  const enriched = { ...claim, created: new Date().toISOString() };
  claims.push(enriched);
  // Persist to GUN
  gunClaims.get(claim.id).put(enriched);
  return enriched;
}

export function getClaimsForNode(nodeId) {
  return claims.filter(c => c.subject_node === nodeId || c.object_node === nodeId);
}

export function getAllClaims() {
  return [...claims];
}

// ─── Context operations ───────────────────────────────────────────────────────

export function addContext(ctx) {
  contexts.set(ctx.id, ctx);
  // Persist to GUN
  gunContexts.get(ctx.id).put(ctx);
  return ctx;
}

export function getContext(id) {
  return contexts.get(id) || null;
}

// ─── Code management ──────────────────────────────────────────────────────────

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

export function getCode(nodeId) {
  return codeMap.get(nodeId) || null;
}

export function findByCode(code) {
  for (const [nodeId, c] of codeMap) {
    if (c.toLowerCase() === code.toLowerCase()) return getNode(nodeId);
  }
  return null;
}

export function findByName(name) {
  const lower = name.toLowerCase();
  for (const node of nodes.values()) {
    if (node.canonical_name.toLowerCase() === lower) return node;
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
    confidence: n.confidence
  }));
}

// ─── Debug ────────────────────────────────────────────────────────────────────

export function getGun() { return gun; }