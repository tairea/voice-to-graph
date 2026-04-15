import * as graph from './graph.js';
import * as realtime from './realtime.js';
import { setAvatarFromFile } from './avatar.js';

const statusEl = document.getElementById('status');
const toggleBtn = document.getElementById('toggle');
const avatarInput = document.getElementById('avatar-input');
const graphEl = document.getElementById('graph');
const tipEl = document.getElementById('tip');

let live = false;

function setStatus(s) {
  statusEl.textContent = s;
}

graph.init(graphEl, tipEl);

window.addEventListener('avatar-changed', e => {
  graph.setAvatar(e.detail);
});

avatarInput.addEventListener('change', async () => {
  const file = avatarInput.files?.[0];
  if (!file) return;
  try {
    await setAvatarFromFile(file);
  } catch (err) {
    setStatus('avatar error: ' + err.message);
  }
});

function uuid() {
  if (crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'c_' + Math.random().toString(36).slice(2, 10);
}

async function handleTranscript({ transcript, assistantPrior }) {
  try {
    const res = await fetch('/extract', {
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

toggleBtn.addEventListener('click', async () => {
  if (live) {
    realtime.stop();
    live = false;
    toggleBtn.textContent = 'Start';
    toggleBtn.dataset.live = 'false';
    setStatus('idle');
    return;
  }

  toggleBtn.disabled = true;
  try {
    await realtime.start({
      onTranscript: handleTranscript,
      onStatus: setStatus
    });
    live = true;
    toggleBtn.textContent = 'Stop';
    toggleBtn.dataset.live = 'true';
  } catch (err) {
    console.error(err);
    setStatus('error: ' + err.message);
    realtime.stop();
  } finally {
    toggleBtn.disabled = false;
  }
});
