import * as graph from './graph.js';
import * as realtime from './realtime.js';
import { setAvatarFromFile } from './avatar.js';

const statusEl = document.getElementById('status');
const statusPill = document.getElementById('status-pill');
const micBtn = document.getElementById('mic-btn');
const avatarInput = document.getElementById('avatar-input');
const avatarEdit = document.getElementById('avatar-edit');
const graphEl = document.getElementById('graph');
const tipEl = document.getElementById('tip');
const infoBtn = document.getElementById('info-btn');
const infoPanel = document.getElementById('info-panel');

let live = false;

infoBtn.addEventListener('click', () => {
  const open = !infoPanel.hidden;
  infoPanel.hidden = open;
  infoBtn.setAttribute('aria-expanded', !open);
});

function setStatus(s) {
  statusEl.textContent = s;
  micBtn.dataset.state = s;
  const isLive = s === 'connected' || s === 'listening' || s === 'live';
  statusPill.dataset.live = isLive;
}

graph.init(graphEl, tipEl);

graph.onMeHover((screenPos) => {
  if (screenPos) {
    avatarEdit.hidden = false;
    avatarEdit.style.left = (screenPos.x + 14) + 'px';
    avatarEdit.style.top = (screenPos.y - 14) + 'px';
  } else {
    avatarEdit.hidden = true;
  }
});

avatarEdit.addEventListener('click', () => avatarInput.click());

window.addEventListener('avatar-changed', e => {
  graph.setAvatar(e.detail);
});

avatarInput.addEventListener('change', async () => {
  const file = avatarInput.files?.[0];
  if (!file) return;
  try {
    await setAvatarFromFile(file);
  } catch {
    setStatus('error');
  }
});

async function handleTranscript({ transcript, assistantPrior }) {
  try {
    const res = await fetch('ingest', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': getSessionId()
      },
      body: JSON.stringify({ transcript, assistantPrior })
    });

    if (!res.ok) {
      console.error('[ingest] failed', res.status, await res.text());
      return;
    }

    const { results, operations } = await res.json();

    // Apply operations first (move/remove)
    if (Array.isArray(operations)) {
      for (const op of operations) {
        if (op.type === 'remove') {
          graph.removeNode(op.target_id || op.target_code);
        } else if (op.type === 'move') {
          graph.moveNode(op.target_id || op.target_code, op.new_parent_id || op.new_parent_code || 'me');
        }
      }
    }

    // Apply identity resolution results
    if (Array.isArray(results)) {
      for (const r of results) {
        if (r.outcome === 'new' && r.node) {
          graph.addPharosNode({ node: r.node, parentId: r.parentId || r.node.parent_id || 'me' });
        } else if ((r.outcome === 'related' || r.outcome === 'conflicting') && r.claim) {
          graph.addPharosClaim(r.claim);
        } else if (r.outcome === 'same' && r.expression) {
          graph.incrementExpression(r.expression.source_node);
        }
      }
    }
  } catch (err) {
    console.error('[ingest] error', err);
  }
}

micBtn.addEventListener('click', async () => {
  if (live) {
    realtime.stop();
    live = false;
    micBtn.dataset.live = 'false';
    setStatus('ready');
    return;
  }

  micBtn.disabled = true;
  try {
    await realtime.start({ onTranscript: handleTranscript, onStatus: setStatus });
    live = true;
    micBtn.dataset.live = 'true';
  } catch (err) {
    console.error(err);
    setStatus('error');
    realtime.stop();
  } finally {
    micBtn.disabled = false;
  }
});

function getSessionId() {
  if (!sessionStorage.pharosSessionId) {
    sessionStorage.pharosSessionId = 'session-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  }
  return sessionStorage.pharosSessionId;
}
