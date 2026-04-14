import { toolSchema } from './tools.js';

const MODEL = 'gpt-realtime-mini';

let pc = null;
let dc = null;
let micStream = null;
let handledCallIds = new Set();

const INSTRUCTIONS = `
You are a curious, warm conversational partner. Have a natural spoken
conversation with the user about whatever they bring up. Ask short follow-up
questions and keep the energy going.

CRITICAL — GRAPH TOOL USAGE:
You have a function called add_concept. Call it AGGRESSIVELY and OFTEN.
Every time the user mentions a noteworthy concept, idea, person, place,
project, interest, hobby, fact, or feeling, call add_concept with:
  - label: a short 1–4 word name for the concept
  - reasoning: 1–2 sentences on why it matters and how it relates to the user

Examples of when to call add_concept:
  - User says "I love ramen" → call add_concept(label="Ramen", reasoning="...")
  - User says "I'm planning a trip to Kyoto" → call add_concept(label="Kyoto", reasoning="...")
  - User says "I work as a designer" → call add_concept(label="Design", reasoning="...")

Rules:
  - Call add_concept multiple times per turn if multiple concepts emerged.
  - Do NOT narrate the function call ("I'm adding that to the graph…"). Just
    call it silently and keep talking naturally.
  - Err on the side of MORE concept nodes, not fewer.
  - Start calling add_concept from the very first user message that mentions
    something noteworthy.

Begin by warmly greeting the user and asking what's on their mind today.
`.trim();

function sendSessionUpdate() {
  const update = {
    type: 'session.update',
    session: {
      type: 'realtime',
      instructions: INSTRUCTIONS,
      tools: [toolSchema],
      tool_choice: 'auto'
    }
  };
  dc.send(JSON.stringify(update));
  console.log('[realtime] sent session.update with tools:', [toolSchema.name]);
}

async function processFunctionCall({ call_id, name, args }, onToolCall) {
  if (handledCallIds.has(call_id)) return;
  handledCallIds.add(call_id);

  console.log('[realtime] function call:', name, args);

  let result;
  try {
    result = await onToolCall(name, args);
  } catch (err) {
    result = { ok: false, error: String(err) };
  }

  dc.send(JSON.stringify({
    type: 'conversation.item.create',
    item: {
      type: 'function_call_output',
      call_id,
      output: JSON.stringify(result)
    }
  }));
  dc.send(JSON.stringify({ type: 'response.create' }));
}

export async function start({ onToolCall, onStatus }) {
  onStatus?.('connecting');
  handledCallIds = new Set();

  const sessionRes = await fetch('/session', { method: 'POST' });
  if (!sessionRes.ok) {
    const text = await sessionRes.text();
    throw new Error(`/session failed: ${sessionRes.status} ${text}`);
  }
  const sessionJson = await sessionRes.json();
  const ephemeralKey = sessionJson.value || sessionJson.client_secret?.value;
  if (!ephemeralKey) {
    throw new Error('No ephemeral key in /session response: ' + JSON.stringify(sessionJson));
  }

  pc = new RTCPeerConnection();
  pc.ontrack = e => {
    const audio = document.getElementById('remote');
    audio.srcObject = e.streams[0];
  };

  micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  for (const track of micStream.getTracks()) pc.addTrack(track, micStream);

  dc = pc.createDataChannel('oai-events');

  dc.addEventListener('message', async ev => {
    let event;
    try { event = JSON.parse(ev.data); }
    catch { return; }

    if (event.type) console.debug('[realtime]', event.type);

    if (event.type === 'session.created') {
      sendSessionUpdate();
      onStatus?.('live');
      return;
    }

    if (event.type === 'session.updated') {
      console.log('[realtime] session.updated — tools registered');
      return;
    }

    if (event.type === 'response.done' && event.response?.output) {
      for (const item of event.response.output) {
        if (item.type === 'function_call') {
          let args = {};
          try { args = JSON.parse(item.arguments || '{}'); } catch {}
          await processFunctionCall(
            { call_id: item.call_id, name: item.name, args },
            onToolCall
          );
        }
      }
      return;
    }

    if (event.type === 'error') {
      console.error('[realtime] error event:', event.error);
      onStatus?.('error: ' + (event.error?.message || 'unknown'));
    }
  });

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  const sdpRes = await fetch(`https://api.openai.com/v1/realtime/calls?model=${encodeURIComponent(MODEL)}`, {
    method: 'POST',
    body: offer.sdp,
    headers: {
      Authorization: `Bearer ${ephemeralKey}`,
      'Content-Type': 'application/sdp'
    }
  });

  if (!sdpRes.ok) {
    const text = await sdpRes.text();
    throw new Error(`SDP exchange failed: ${sdpRes.status} ${text}`);
  }

  const answerSdp = await sdpRes.text();
  await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
}

export function stop() {
  try { dc?.close(); } catch {}
  try { pc?.close(); } catch {}
  if (micStream) {
    for (const t of micStream.getTracks()) t.stop();
  }
  dc = null;
  pc = null;
  micStream = null;
  handledCallIds = new Set();
}
