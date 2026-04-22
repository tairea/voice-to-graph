// In-memory PHAROS node/claim/context store.
// Server-side source of truth for identity resolution.

const nodes = new Map();   // id → node object
const claims = [];          // all claims
const contexts = new Map(); // id → context object
const codeMap = new Map();  // pharos-id → display code (e.g. "A1")

let nextBranchCharCode = 65;
const branchCounters = {};

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

export function addNode(node) {
  if (nodes.has(node.id)) return nodes.get(node.id);
  nodes.set(node.id, { ...node, expressionCount: 0, created: new Date().toISOString() });
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
  Object.assign(node, patch, { updated: new Date().toISOString() });
  return node;
}

export function incrementExpression(nodeId) {
  const node = nodes.get(nodeId);
  if (node) node.expressionCount = (node.expressionCount || 0) + 1;
}

export function addClaim(claim) {
  const existing = claims.find(c => c.id === claim.id);
  if (existing) return existing;
  claims.push({ ...claim, created: new Date().toISOString() });
  return claims[claims.length - 1];
}

export function getClaimsForNode(nodeId) {
  return claims.filter(c => c.subject_node === nodeId || c.object_node === nodeId);
}

export function getAllClaims() {
  return [...claims];
}

export function addContext(ctx) {
  contexts.set(ctx.id, ctx);
  return ctx;
}

export function getContext(id) {
  return contexts.get(id) || null;
}

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
