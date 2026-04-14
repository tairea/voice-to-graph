import { getAvatar } from './avatar.js';

const THREE = window.THREE;
const ForceGraph3D = window.ForceGraph3D;

let graph;
let tipEl;
let containerEl;
let mouse = { x: 0, y: 0 };

function makeAvatarMesh(dataUrl) {
  const texture = new THREE.TextureLoader().load(dataUrl);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true });
  const geometry = new THREE.CircleGeometry(10, 48);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData.isAvatar = true;
  return mesh;
}

export function init(container, tip) {
  containerEl = container;
  tipEl = tip;

  graph = new ForceGraph3D(container, { controlType: 'orbit' })
    .backgroundColor('#07090f')
    .nodeLabel(n => n.label || '')
    .nodeRelSize(6)
    .nodeThreeObjectExtend(node => node.id !== 'me')
    .nodeThreeObject(node => {
      if (node.id === 'me') return makeAvatarMesh(node.avatar || getAvatar());
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

  window.addEventListener('resize', () => {
    graph.width(container.clientWidth);
    graph.height(container.clientHeight);
  });
  graph.width(container.clientWidth);
  graph.height(container.clientHeight);
}

function positionTip() {
  const pad = 14;
  tipEl.style.left = (mouse.x + pad) + 'px';
  tipEl.style.top = (mouse.y + pad) + 'px';
}

export function setAvatar(dataUrl) {
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
}
