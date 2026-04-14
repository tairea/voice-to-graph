import ForceGraph3D from '3d-force-graph';
import * as THREE from 'three';
import { getAvatar } from './avatar.js';

let graph;
let tipEl;
let mouse = { x: 0, y: 0 };

let cachedAvatarSprite = null;
let cachedAvatarUrl = null;

function buildAvatarSprite(dataUrl) {
  const loader = new THREE.TextureLoader();
  const texture = loader.load(
    dataUrl,
    undefined,
    undefined,
    err => console.error('[graph] avatar texture load failed', err)
  );
  texture.colorSpace = THREE.SRGBColorSpace;
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

export function init(container, tip) {
  tipEl = tip;

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

export function addConcept({ id, label, reasoning }) {
  const data = graph.graphData();
  if (data.nodes.some(n => n.id === id)) return;
  data.nodes.push({ id, label });
  data.links.push({ source: 'me', target: id, reasoning });
  graph.graphData(data);
  console.log('[graph] added concept:', label, '—', reasoning);
}
