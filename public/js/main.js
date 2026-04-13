import * as graph from './graph.js';
import * as realtime from './realtime.js';
import { setAvatarFromFile } from './avatar.js';
import { handleToolCall } from './tools.js';

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
      onToolCall: (name, args) => handleToolCall(name, args, graph),
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
