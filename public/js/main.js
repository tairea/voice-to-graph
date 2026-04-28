import * as graph from './graph.js';
import * as realtime from './realtime.js';
import { setAvatarFromFile } from './avatar.js';

const VOICES = [
  'alloy', 'ash', 'ballad', 'coral', 'echo',
  'marin', 'sage', 'shimmer', 'verse', 'cedar'
];

const statusEl = document.getElementById('status');
const statusPill = document.getElementById('status-pill');
const micBtn = document.getElementById('mic-btn');
const avatarInput = document.getElementById('avatar-input');
const avatarEdit = document.getElementById('avatar-edit');
const graphEl = document.getElementById('graph');
const tipEl = document.getElementById('tip');
const infoBtn = document.getElementById('info-btn');
const infoPanel = document.getElementById('info-panel');
const voiceBtn = document.getElementById('voice-btn');
const voiceModal = document.getElementById('voice-modal');
const voiceGrid = document.getElementById('voice-grid');
const voiceModalClose = document.getElementById('voice-modal-close');
const dropZone = document.getElementById('drop-zone');
const mdInput = document.getElementById('md-input');
const toast = document.getElementById('toast');

let live = false;

function getSelectedVoice() {
  return localStorage.getItem('pharos-voice') || 'alloy';
}

function buildVoiceGrid() {
  voiceGrid.innerHTML = '';
  const selected = getSelectedVoice();
  for (const voice of VOICES) {
    const btn = document.createElement('button');
    btn.className = 'voice-option' + (voice === selected ? ' selected' : '');
    btn.textContent = voice;
    btn.dataset.voice = voice;
    btn.addEventListener('click', () => {
      localStorage.setItem('pharos-voice', voice);
      document.querySelectorAll('.voice-option').forEach(el => el.classList.remove('selected'));
      btn.classList.add('selected');
      voiceModal.hidden = true;
    });
    voiceGrid.appendChild(btn);
  }
}

function openVoiceModal() {
  buildVoiceGrid();
  voiceModal.hidden = false;
  voiceBtn.setAttribute('aria-expanded', 'true');
}

function closeVoiceModal() {
  voiceModal.hidden = true;
  voiceBtn.setAttribute('aria-expanded', 'false');
}

infoBtn.addEventListener('click', () => {
  const open = !infoPanel.hidden;
  infoPanel.hidden = open;
  infoBtn.setAttribute('aria-expanded', !open);
});

voiceBtn.addEventListener('click', () => {
  if (voiceModal.hidden) {
    openVoiceModal();
  } else {
    closeVoiceModal();
  }
});

voiceModalClose.addEventListener('click', closeVoiceModal);
voiceModal.addEventListener('click', (e) => {
  if (e.target === voiceModal) closeVoiceModal();
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
    const voice = getSelectedVoice();
    await realtime.start({ onTranscript: handleTranscript, onStatus: setStatus }, voice);
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

// ─── Drop Zone ───────────────────────────────────────────────────────────────

let toastTimer = null;
function showToast(msg, type = '') {
  toast.textContent = msg;
  toast.className = type || '';
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 3000);
}

async function ingestMdFile(text, filename) {
  try {
    const res = await fetch('ingest', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': getSessionId()
      },
      body: JSON.stringify({ transcript: text, assistantPrior: `[file: ${filename}]` })
    });

    if (!res.ok) {
      throw new Error(await res.text());
    }

    const { results, operations } = await res.json();

    const newNodes = [];
    if (Array.isArray(operations)) {
      for (const op of operations) {
        if (op.type === 'remove') {
          graph.removeNode(op.target_id || op.target_code);
        } else if (op.type === 'move') {
          graph.moveNode(op.target_id || op.target_code, op.new_parent_id || op.new_parent_code || 'me');
        }
      }
    }

    if (Array.isArray(results)) {
      for (const r of results) {
        if (r.outcome === 'new' && r.node) {
          graph.addPharosNode({ node: r.node, parentId: r.parentId || r.node.parent_id || 'me' });
          newNodes.push(r.node);
        } else if ((r.outcome === 'related' || r.outcome === 'conflicting') && r.claim) {
          graph.addPharosClaim(r.claim);
        } else if (r.outcome === 'same' && r.expression) {
          graph.incrementExpression(r.expression.source_node);
        }
      }
    }

    const count = newNodes.length;
    showToast(count > 0 ? `+${count} node${count !== 1 ? 's' : ''} from ${filename}` : `Parsed ${filename}`, 'success');
  } catch (err) {
    console.error('[md-ingest] error', err);
    showToast('Failed to parse ' + filename, 'error');
  }
}

function handleMdFile(file) {
  if (!file) return;
  if (!file.name.endsWith('.md') && file.type !== 'text/markdown') {
    showToast('.md files only', 'error');
    return;
  }
  dropZone.classList.add('processing');
  const reader = new FileReader();
  reader.onload = async e => {
    dropZone.classList.remove('processing');
    await ingestMdFile(e.target.result, file.name);
  };
  reader.onerror = () => {
    dropZone.classList.remove('processing');
    showToast('Failed to read file', 'error');
  };
  reader.readAsText(file);
}

function handleMdFiles(files) {
  if (!files || files.length === 0) return;
  const mdFiles = Array.from(files).filter(f =>
    f.name.endsWith('.md') || f.type === 'text/markdown'
  );
  if (mdFiles.length === 0) {
    showToast('No .md files found', 'error');
    return;
  }
  if (mdFiles.length < files.length) {
    showToast('Some files skipped (not .md)', 'error');
  }
  if (mdFiles.length === 1) {
    handleMdFile(mdFiles[0]);
    return;
  }
  dropZone.classList.add('processing');
  let processed = 0, failed = 0;
  for (const file of mdFiles) {
    const reader = new FileReader();
    reader.onload = e => {
      ingestMdFile(e.target.result, file.name).then(() => {
        processed++;
        checkDone();
      }).catch(() => {
        failed++;
        checkDone();
      });
    };
    reader.onerror = () => {
      failed++;
      checkDone();
    };
    reader.readAsText(file);
  }
  function checkDone() {
    if (processed + failed === mdFiles.length) {
      dropZone.classList.remove('processing');
      if (failed === 0) {
        showToast(`+${processed} files ingested`, 'success');
      } else {
        showToast(`${processed} ok, ${failed} failed`, 'error');
      }
    }
  }
}

// Click to open file picker
dropZone.addEventListener('click', () => mdInput.click());
mdInput.addEventListener('change', () => {
  handleMdFiles(mdInput.files);
  mdInput.value = '';
});

// Keyboard accessibility
dropZone.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    mdInput.click();
  }
});

// Drag and drop
dropZone.addEventListener('dragover', e => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});
dropZone.addEventListener('dragleave', e => {
  if (!dropZone.contains(e.relatedTarget)) {
    dropZone.classList.remove('drag-over');
  }
});
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  handleMdFiles(e.dataTransfer?.files);
});
