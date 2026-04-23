// In-memory PHAROS node/claim/context store with synchronous JSON file persistence.
// Server-side source of truth for identity resolution.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, 'pharos-data.json');

// ─── In-memory store (source of truth during runtime) ───────────────────────

const nodes = new Map();   // id → node object
const claims = [];          // all claims
const contexts = new Map(); // id → context object
const codeMap = new Map();  // pharos-id → display code (e.g. "A1")

let nextBranchCharCode = 65;
const branchCounters = {};

// ─── Persistence ─────────────────────────────────────────────────────────────

function persist() {
  const state = {
    nodes: Object.fromEntries(nodes),
    claims,
    contexts: Object.fromEntries(contexts),
    codeMap: Object.fromEntries(codeMap),
    branchCounters,
    nextBranchCharCode
  };
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

function rehydrate() {
  try {
    if (!fs.existsSync(DATA_FILE)) return;
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    const state = JSON.parse(raw);
    if (state.nodes) {
      for (const [id, node] of Object.entries(state.nodes)) {
        nodes.set(id, node);
      }
    }
    if (state.claims) {
      claims.push(...state.claims);
    }
    if (state.contexts) {
      for (const [id, ctx] of Object.entries(state.contexts)) {
        contexts.set(id, ctx);
      }
    }
    if (state.codeMap) {
      for (const [id, code] of Object.entries(state.codeMap)) {
        codeMap.set(id, code);
      }
    }
    if (state.branchCounters) Object.assign(branchCounters, state.branchCounters);
    if (state.nextBranchCharCode) nextBranchCharCode = state.nextBranchCharCode;
    console.log(`[pharos-store] rehydrated — ${nodes.size} nodes, ${claims.length} claims, ${contexts.size} contexts`);
  } catch (err) {
    console.error('[pharos-store] rehydrate error:', err);
  }
}

rehydrate();

// ─── Bootstrap promise (resolved immediately since rehydrate is sync) ─────────

let bootstrapped = true;
const bootstrapPromises = [Promise.resolve()];

export function awaitBootstrap() {
  return Promise.all(bootstrapPromises);
}

// ─── Branch code management ───────────────────────────────────────────────────

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
  persist();
  return updated;
}

export function incrementExpression(nodeId) {
  const node = nodes.get(nodeId);
  if (node) {
    node.expressionCount = (node.expressionCount || 0) + 1;
    persist();
  }
}

// ─── Claim operations ────────────────────────────────────────────────────────

export function addClaim(claim) {
  const existing = claims.find(c => c.id === claim.id);
  if (existing) return existing;
  const enriched = { ...claim, created: new Date().toISOString() };
  claims.push(enriched);
  persist();
  return enriched;
}

export function getClaimsForNode(nodeId) {
  return claims.filter(c => c.subject_node === nodeId || c.object_node === nodeId);
}

export function getAllClaims() {
  return [...claims];
}

// ─── Context operations ──────────────────────────────────────────────────────

export function addContext(ctx) {
  contexts.set(ctx.id, ctx);
  persist();
  return ctx;
}

export function getContext(id) {
  return contexts.get(id) || null;
}

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