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

let live = false;

function setStatus(s) {
  statusEl.textContent = s;
  micBtn.dataset.state = s;

  const isLive = s === 'connected' || s === 'listening';
  statusPill.dataset.live = isLive;
}

graph.init(graphEl, tipEl);

// avatar edit: show pencil on "me" hover, click to open file picker
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
  } catch (err) {
    setStatus('error');
  }
});

function uuid() {
  if (crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'c_' + Math.random().toString(36).slice(2, 10);
}

async function handleTranscript({ transcript, assistantPrior }) {
  try {
    const res = await fetch('extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript, assistantPrior, nodes: graph.getNodeLabels() })
    });
    if (!res.ok) {
      console.error('[extract] failed', res.status, await res.text());
      return;
    }
    const { operations, concepts } = await res.json();
    if (Array.isArray(operations)) {
      for (const op of operations) {
        if (op.type === 'remove') graph.removeNode(op.target);
        else if (op.type === 'move') graph.moveNode(op.target, op.new_parent || 'me');
      }
    }
    if (Array.isArray(concepts)) {
      for (const c of concepts) {
        graph.addConcept({
          id: uuid(),
          label: c.label,
          reasoning: c.reasoning,
          parentLabel: c.parent_label
        });
      }
    }
  } catch (err) {
    console.error('[extract] error', err);
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
    await realtime.start({
      onTranscript: handleTranscript,
      onStatus: setStatus
    });
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
