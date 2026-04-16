import ForceGraph3D from '3d-force-graph';
import * as THREE from 'three';
import { getAvatar } from './avatar.js';

const fontReady = document.fonts.ready;

let graph;
let tipEl;
let mouse = { x: 0, y: 0 };

let cachedAvatarTexture = null;
let cachedAvatarUrl = null;
let lastConceptId = null;
let fitTimer = null;
let branchCounters = {};
let nextBranchCharCode = 65;
let meHoverCb = null;

const AVATAR_TEXTURE_SIZE = 256;
const AVATAR_SPRITE_SIZE = 28;
const CONCEPT_NODE_RADIUS = 4;

function drawFallbackAvatar(ctx, size) {
  const cx = size / 2;

  // dark circle background with subtle radial gradient
  const bg = ctx.createRadialGradient(cx, cx, 0, cx, cx, cx);
  bg.addColorStop(0, '#141e35');
  bg.addColorStop(1, '#0a0f1c');
  ctx.beginPath();
  ctx.arc(cx, cx, cx, 0, Math.PI * 2);
  ctx.fillStyle = bg;
  ctx.fill();

  // outer ring — thin glowing border
  ctx.beginPath();
  ctx.arc(cx, cx, cx - 2, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(80,140,255,0.2)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // clip everything inside the circle
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cx, cx - 2, 0, Math.PI * 2);
  ctx.clip();

  // head — soft glowing circle
  const headR = size * 0.14;
  const headY = size * 0.35;
  const headGlow = ctx.createRadialGradient(cx, headY, 0, cx, headY, headR * 1.6);
  headGlow.addColorStop(0, 'rgba(100,160,255,0.12)');
  headGlow.addColorStop(1, 'transparent');
  ctx.fillStyle = headGlow;
  ctx.fillRect(0, 0, size, size);

  ctx.beginPath();
  ctx.arc(cx, headY, headR, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(120,170,255,0.35)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(120,170,255,0.45)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // body — shoulders/torso arc
  const bodyTop = size * 0.56;
  const bodyGlow = ctx.createRadialGradient(cx, bodyTop + size * 0.12, 0, cx, bodyTop + size * 0.12, size * 0.35);
  bodyGlow.addColorStop(0, 'rgba(100,160,255,0.1)');
  bodyGlow.addColorStop(1, 'transparent');
  ctx.fillStyle = bodyGlow;
  ctx.fillRect(0, bodyTop - 20, size, size);

  ctx.beginPath();
  ctx.ellipse(cx, bodyTop + size * 0.2, size * 0.3, size * 0.26, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(120,170,255,0.25)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(120,170,255,0.35)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.restore();
}

function getAvatarTexture(dataUrl) {
  if (cachedAvatarTexture && cachedAvatarUrl === dataUrl) return cachedAvatarTexture;

  const size = AVATAR_TEXTURE_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  // draw fallback immediately so there's never a blank frame
  drawFallbackAvatar(ctx, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;

  // if dataUrl is a real image (data: or uploaded), overlay it
  if (dataUrl && !dataUrl.endsWith('.png')) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      ctx.clearRect(0, 0, size, size);
      ctx.save();
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      const srcSize = Math.min(img.width, img.height);
      const sx = (img.width - srcSize) / 2;
      const sy = (img.height - srcSize) / 2;
      ctx.drawImage(img, sx, sy, srcSize, srcSize, 0, 0, size, size);
      ctx.restore();
      texture.needsUpdate = true;
    };
    img.onerror = () => {}; // fallback already drawn
    img.src = dataUrl;
  }

  cachedAvatarUrl = dataUrl;
  cachedAvatarTexture = texture;
  return texture;
}

function makeTextSprite(text) {
  const pad = 16;
  const fontSize = 44;
  const measureCanvas = document.createElement('canvas');
  const mctx = measureCanvas.getContext('2d');
  mctx.font = `300 ${fontSize}px 'Sora', system-ui, sans-serif`;
  const textWidth = Math.ceil(mctx.measureText(text).width);

  const w = textWidth + pad * 2;
  const h = fontSize + pad * 2;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  const r = 12;
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(w - r, 0);
  ctx.quadraticCurveTo(w, 0, w, r);
  ctx.lineTo(w, h - r);
  ctx.quadraticCurveTo(w, h, w - r, h);
  ctx.lineTo(r, h);
  ctx.quadraticCurveTo(0, h, 0, h - r);
  ctx.lineTo(0, r);
  ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath();
  ctx.fillStyle = 'rgba(8,14,28,0.6)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(100,150,255,0.12)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.font = `300 ${fontSize}px 'Sora', system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(200,215,240,0.9)';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(text, w / 2, h / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, depthTest: false });
  const sprite = new THREE.Sprite(material);
  const scale = 0.12;
  sprite.scale.set(w * scale, h * scale, 1);
  sprite.renderOrder = 999;
  return sprite;
}

function buildNodeObject(node) {
  const group = new THREE.Group();

  if (node.id === 'me') {
    const mat = new THREE.SpriteMaterial({
      map: getAvatarTexture(node.avatar || getAvatar()),
      transparent: true,
      depthWrite: false
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(AVATAR_SPRITE_SIZE, AVATAR_SPRITE_SIZE, 1);
    group.add(sprite);
  } else {
    const geom = new THREE.SphereGeometry(CONCEPT_NODE_RADIUS, 16, 16);
    const mat = new THREE.MeshLambertMaterial({ color: 0x6f86ff });
    group.add(new THREE.Mesh(geom, mat));
  }

  const display = node.id === 'me'
    ? 'me'
    : (node.code ? `${node.code}: ${node.label}` : node.label);
  if (display) {
    const label = makeTextSprite(display);
    const yOffset = node.id === 'me' ? AVATAR_SPRITE_SIZE / 2 + 3 : CONCEPT_NODE_RADIUS + 3;
    label.position.set(0, yOffset, 0);
    group.add(label);
  }

  return group;
}

function scheduleFit() {
  clearTimeout(fitTimer);
  fitTimer = setTimeout(() => {
    try { graph.zoomToFit(600, 80); } catch (e) { console.warn('[graph] zoomToFit failed', e); }
  }, 600);
}

function allocBranch() {
  const letter = String.fromCharCode(nextBranchCharCode++);
  if (nextBranchCharCode > 90) nextBranchCharCode = 65;
  branchCounters[letter] = 0;
  return letter;
}

function nextCodeInBranch(branch) {
  branchCounters[branch] = (branchCounters[branch] || 0) + 1;
  return `${branch}${branchCounters[branch]}`;
}

function refreshNodeVisuals() {
  graph.nodeThreeObject(graph.nodeThreeObject());
}

function linkEndId(end) {
  return typeof end === 'object' && end !== null ? end.id : end;
}

function collectDescendants(rootId, links) {
  const out = new Set([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const l of links) {
      const s = linkEndId(l.source);
      const t = linkEndId(l.target);
      if (out.has(s) && !out.has(t)) {
        out.add(t);
        changed = true;
      }
    }
  }
  return out;
}

export function init(container, tip) {
  tipEl = tip;
  lastConceptId = null;
  branchCounters = {};
  nextBranchCharCode = 65;

  graph = ForceGraph3D({ controlType: 'orbit' })(container)
    .backgroundColor('#07090f')
    .nodeRelSize(6)
    .nodeThreeObjectExtend(false)
    .nodeThreeObject(buildNodeObject)
    .linkColor(() => 'rgba(180,200,255,0.55)')
    .linkWidth(1.2)
    .linkDirectionalParticles(2)
    .linkDirectionalParticleWidth(1.5)
    .onLinkHover(link => {
      if (link && link.reasoning) {
        tipEl.textContent = link.reasoning;
        tipEl.hidden = false;
        positionTip();
      } else {
        tipEl.hidden = true;
      }
    })
    .onNodeHover(node => {
      if (meHoverCb) {
        if (node && node.id === 'me') {
          const coords = graph.graph2ScreenCoords(node.x, node.y, node.z);
          meHoverCb({ x: coords.x, y: coords.y });
        } else {
          meHoverCb(null);
        }
      }
    });

  graph.d3Force('charge').strength(-220);
  graph.d3Force('link').distance(40);

  graph.graphData({
    nodes: [{ id: 'me', label: 'me', avatar: getAvatar() }],
    links: []
  });

  graph.cameraPosition({ x: 0, y: 0, z: 250 });

  fontReady.then(() => {
    graph.nodeThreeObject(graph.nodeThreeObject());
  });

  container.addEventListener('mousemove', e => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    if (!tipEl.hidden) positionTip();
  });

  const resize = () => {
    graph.width(container.clientWidth);
    graph.height(container.clientHeight);
  };
  window.addEventListener('resize', resize);
  resize();
}

function positionTip() {
  const pad = 14;
  tipEl.style.left = (mouse.x + pad) + 'px';
  tipEl.style.top = (mouse.y + pad) + 'px';
}

export function setAvatar(dataUrl) {
  cachedAvatarTexture = null;
  cachedAvatarUrl = null;
  const data = graph.graphData();
  const me = data.nodes.find(n => n.id === 'me');
  if (me) {
    me.avatar = dataUrl;
    graph.nodeThreeObject(graph.nodeThreeObject());
  }
}

export function getNodeLabels() {
  const data = graph.graphData();
  return data.nodes
    .filter(n => n.id !== 'me')
    .map(n => `${n.code}: ${n.label}`);
}

function findNode(ref, nodes) {
  if (!ref) return null;
  const lower = String(ref).toLowerCase();
  if (lower === 'me') return nodes.find(n => n.id === 'me') || null;
  return nodes.find(n =>
    String(n.code || '').toLowerCase() === lower ||
    String(n.label || '').toLowerCase() === lower ||
    String(n.id || '').toLowerCase() === lower
  ) || null;
}

export function addConcept({ id, label, reasoning, parentLabel }) {
  const data = graph.graphData();

  const existing = data.nodes.find(n =>
    n.id !== 'me' && String(n.label || '').toLowerCase() === String(label).toLowerCase()
  );
  if (existing) {
    lastConceptId = existing.id;
    return;
  }

  let parentNode = findNode(parentLabel, data.nodes);
  if (!parentNode && lastConceptId) parentNode = data.nodes.find(n => n.id === lastConceptId);
  if (!parentNode) parentNode = data.nodes.find(n => n.id === 'me');

  const branch = parentNode.id === 'me' ? allocBranch() : parentNode.branch;
  const code = nextCodeInBranch(branch);

  data.nodes.push({ id, label, branch, code });
  data.links.push({ source: parentNode.id, target: id, reasoning });
  graph.graphData(data);
  lastConceptId = id;
  scheduleFit();
  console.log(`[graph] + ${code}: ${label}  (parent: ${parentNode.code || parentNode.id})`);
}

export function removeNode(ref) {
  const data = graph.graphData();
  const node = findNode(ref, data.nodes);
  if (!node || node.id === 'me') {
    console.warn('[graph] removeNode: not found or root', ref);
    return false;
  }
  const doomed = collectDescendants(node.id, data.links);
  const nodes = data.nodes.filter(n => !doomed.has(n.id));
  const links = data.links.filter(l => !doomed.has(linkEndId(l.source)) && !doomed.has(linkEndId(l.target)));
  graph.graphData({ nodes, links });
  if (doomed.has(lastConceptId)) lastConceptId = null;
  scheduleFit();
  console.log(`[graph] - removed ${node.code} and ${doomed.size - 1} descendants`);
  return true;
}

export function onMeHover(cb) {
  meHoverCb = cb;
}

export function moveNode(ref, newParentRef) {
  const data = graph.graphData();
  const node = findNode(ref, data.nodes);
  const newParent = findNode(newParentRef, data.nodes);
  if (!node || node.id === 'me') {
    console.warn('[graph] moveNode: target not found', ref);
    return false;
  }
  if (!newParent) {
    console.warn('[graph] moveNode: new parent not found', newParentRef);
    return false;
  }
  const subtree = collectDescendants(node.id, data.links);
  if (subtree.has(newParent.id)) {
    console.warn('[graph] moveNode: cannot move into own subtree');
    return false;
  }

  const links = data.links.filter(l => !(linkEndId(l.target) === node.id));

  const newBranch = newParent.id === 'me' ? allocBranch() : newParent.branch;

  const order = [];
  const seen = new Set();
  const walk = id => {
    if (seen.has(id)) return;
    seen.add(id);
    order.push(id);
    for (const l of data.links) {
      if (linkEndId(l.source) === id && subtree.has(linkEndId(l.target))) {
        walk(linkEndId(l.target));
      }
    }
  };
  walk(node.id);

  for (const nid of order) {
    const n = data.nodes.find(x => x.id === nid);
    const oldCode = n.code;
    n.branch = newBranch;
    n.code = nextCodeInBranch(newBranch);
    console.log(`[graph] recode ${oldCode} → ${n.code}`);
  }

  links.push({ source: newParent.id, target: node.id, reasoning: `moved under ${newParent.code || 'me'}` });

  graph.graphData({ nodes: data.nodes, links });
  refreshNodeVisuals();
  scheduleFit();
  console.log(`[graph] moved ${ref} → ${newParent.code || 'me'}`);
  return true;
}
