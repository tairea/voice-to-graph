import { toolSchema } from './tools.js';

const MODEL = 'gpt-realtime-mini';

let pc = null;
let dc = null;
let micStream = null;

const INSTRUCTIONS = `
You are a curious, warm conversational partner. Have a natural spoken
conversation with the user about whatever they bring up. Ask short follow-up
questions.

IMPORTANT: Whenever the user mentions a key concept, idea, person, place,
project, interest, fact, or feeling that is worth remembering, call the
add_concept function with a short label and a 1–2 sentence reasoning that
explains why it matters and how it relates to the user. Do not narrate the
function call out loud — just call it and keep the conversation flowing.
You may call add_concept multiple times in a single turn if multiple
distinct concepts emerged.
`.trim();

export async function start({ onToolCall, onStatus }) {
  onStatus?.('connecting');

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

  dc.addEventListener('open', () => {
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
    onStatus?.('live');
  });

  dc.addEventListener('message', async ev => {
    let event;
    try { event = JSON.parse(ev.data); }
    catch { return; }

    if (event.type) console.debug('[realtime]', event.type, event);

    if (event.type === 'response.function_call_arguments.done') {
      let args = {};
      try { args = JSON.parse(event.arguments || '{}'); } catch {}
      let result;
      try {
        result = await onToolCall(event.name, args);
      } catch (err) {
        result = { ok: false, error: String(err) };
      }
      dc.send(JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: event.call_id,
          output: JSON.stringify(result)
        }
      }));
      dc.send(JSON.stringify({ type: 'response.create' }));
    } else if (event.type === 'error') {
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
}
