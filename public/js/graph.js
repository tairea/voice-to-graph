import ForceGraph3D from '3d-force-graph';
import * as THREE from 'three';
import { getAvatar } from './avatar.js';

let graph;
let tipEl;
let mouse = { x: 0, y: 0 };

let cachedAvatarSprite = null;
let cachedAvatarUrl = null;
let lastConceptId = null;
let fitTimer = null;

const AVATAR_TEXTURE_SIZE = 256;

function drawCircleMask(ctx, size) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
}

function drawFallback(ctx, size) {
  ctx.save();
  const grad = ctx.createRadialGradient(size / 2, size * 0.4, size * 0.1, size / 2, size / 2, size / 2);
  grad.addColorStop(0, '#6f86ff');
  grad.addColorStop(1, '#1a2150');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function buildAvatarSprite(dataUrl) {
  const size = AVATAR_TEXTURE_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  drawFallback(ctx, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;

  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    ctx.clearRect(0, 0, size, size);
    drawCircleMask(ctx, size);
    // object-fit: cover — center-crop the largest square from the source image.
    const srcSize = Math.min(img.width, img.height);
    const sx = (img.width - srcSize) / 2;
    const sy = (img.height - srcSize) / 2;
    ctx.drawImage(img, sx, sy, srcSize, srcSize, 0, 0, size, size);
    ctx.restore();
    texture.needsUpdate = true;
  };
  img.onerror = err => console.error('[graph] avatar image load failed', err);
  img.src = dataUrl;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(28, 28, 1);
  return sprite;
}

function getAvatarSprite(dataUrl) {
  if (cachedAvatarSprite && cachedAvatarUrl === dataUrl) {
    return cachedAvatarSprite;
  }
  cachedAvatarUrl = dataUrl;
  cachedAvatarSprite = buildAvatarSprite(dataUrl);
  return cachedAvatarSprite;
}

function scheduleFit() {
  clearTimeout(fitTimer);
  fitTimer = setTimeout(() => {
    try { graph.zoomToFit(600, 80); } catch (e) { console.warn('[graph] zoomToFit failed', e); }
  }, 600);
}

export function init(container, tip) {
  tipEl = tip;
  lastConceptId = null;

  graph = ForceGraph3D({ controlType: 'orbit' })(container)
    .backgroundColor('#07090f')
    .nodeLabel(n => n.label || '')
    .nodeRelSize(6)
    .nodeThreeObjectExtend(node => node.id !== 'me')
    .nodeThreeObject(node => {
      if (node.id === 'me') return getAvatarSprite(node.avatar || getAvatar());
      return null;
    })
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
    });

  graph.graphData({
    nodes: [{ id: 'me', label: 'me', avatar: getAvatar(), fx: 0, fy: 0, fz: 0 }],
    links: []
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
  cachedAvatarSprite = null;
  cachedAvatarUrl = null;
  const data = graph.graphData();
  const me = data.nodes.find(n => n.id === 'me');
  if (me) {
    me.avatar = dataUrl;
    graph.nodeThreeObject(graph.nodeThreeObject());
  }
}

function resolveParentId(parentLabel, nodes) {
  if (!parentLabel) return null;
  const lower = parentLabel.toLowerCase();
  const match = nodes.find(n =>
    String(n.label || '').toLowerCase() === lower ||
    String(n.id || '').toLowerCase() === lower
  );
  return match ? match.id : null;
}

export function addConcept({ id, label, reasoning, parentLabel }) {
  const data = graph.graphData();
  if (data.nodes.some(n => n.id === id)) return;

  let parentId = resolveParentId(parentLabel, data.nodes);
  if (!parentId) parentId = lastConceptId || 'me';

  data.nodes.push({ id, label });
  data.links.push({ source: parentId, target: id, reasoning });
  graph.graphData(data);
  lastConceptId = id;
  scheduleFit();
  console.log(`[graph] + ${label}  (parent: ${parentId})`);
}
