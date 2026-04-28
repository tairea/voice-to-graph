import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as store from './pharos-store.js';
import { resolve as pharosResolve } from './pharos-resolver.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const REALTIME_MODEL = 'gpt-realtime-mini';
const EXTRACT_MODEL = process.env.EXTRACT_MODEL || 'gpt-4.1-mini';

// ─── /session — OpenAI Realtime (unchanged) ──────────────────────────────────

app.post('/session', async (_req, res) => {
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OPENAI_API_KEY is not set on the server' });
  }
  try {
    const upstream = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ session: { type: 'realtime', model: REALTIME_MODEL } })
    });
    const text = await upstream.text();
    res.status(upstream.status).type(upstream.headers.get('content-type') || 'application/json').send(text);
  } catch (err) {
    res.status(502).json({ error: String(err) });
  }
});

// ─── /ingest — PHAROS CubeCodex identity resolution ──────────────────────────

app.post('/ingest', async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set on the server' });
  }

  const { transcript, assistantPrior } = req.body || {};
  if (!transcript || typeof transcript !== 'string') {
    return res.status(400).json({ error: 'transcript (string) required' });
  }

  try {
    // Create context object for this ingest call
    const contextId = `ctx-${new Date().toISOString().slice(0,10)}-${Date.now()}`;
    store.addContext({
      id: contextId,
      object_class: 'context',
      time: new Date().toISOString().slice(0,10),
      epistemic_mode: 'observation',
      session_id: req.headers['x-session-id'] || 'default',
      created: new Date().toISOString()
    });

    const result = await pharosResolve(transcript, assistantPrior || '', contextId);
    res.json({ context_id: contextId, ...result });
  } catch (err) {
    console.error('[ingest] error', err);
    res.status(502).json({ error: String(err) });
  }
});

// ─── /ingest/state — return current store state ───────────────────────────────

app.get('/ingest/state', (_req, res) => {
  res.json({
    nodes: store.getAllNodes(),
    claims: store.getAllClaims(),
    identity: store.getIdentity(),
    peers: store.getPeerList(),
    publicSpaces: store.getPublicSpaces(),
  });
});

// ─── /ingest/identity — return DID and profile only ──────────────────────────

app.get('/ingest/identity', (_req, res) => {
  res.json(store.getIdentity());
});

// ─── /ingest/share — make subtree public / share with peer / link to avatar ──

app.post('/ingest/share', async (req, res) => {
  const { nodeId, mode, recipientDID } = req.body || {};
  if (!nodeId) return res.status(400).json({ error: 'nodeId required' });
  try {
    let spaceId;
    if (mode === 'public') {
      spaceId = store.makePublic(nodeId);
    } else if (mode === 'specific') {
      if (!recipientDID) return res.status(400).json({ error: 'recipientDID required for specific mode' });
      spaceId = await store.shareWithSpecific(nodeId, recipientDID);
    } else if (mode === 'avatar') {
      spaceId = store.linkToAvatar(nodeId);
    } else {
      return res.status(400).json({ error: 'mode must be "public" | "specific" | "avatar"' });
    }
    res.json({ spaceId });
  } catch (err) {
    console.error('[share] error', err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.delete('/ingest/share/:spaceId', (req, res) => {
  try {
    store.stopPublic(req.params.spaceId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// ─── /ingest/peers — peer management ─────────────────────────────────────────

app.get('/ingest/peers', (_req, res) => {
  res.json(store.getPeerList());
});

app.post('/ingest/peers', (req, res) => {
  const { did: peerDID, name, relayAddress } = req.body || {};
  if (!peerDID) return res.status(400).json({ error: 'did required' });
  const entry = store.addPeer(peerDID, { name, relayAddress });
  res.json(entry);
});

app.delete('/ingest/peers/:did', (req, res) => {
  store.removePeer(req.params.did);
  res.json({ ok: true });
});

// ─── /ingest/events — SSE stream for live remote shared nodes/claims ─────────

app.get('/ingest/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  res.write(`: connected\n\n`);

  const nodeUnsub = store.onRemoteNode(({ node, spaceId }) => {
    res.write(`event: node\ndata: ${JSON.stringify({ node, spaceId })}\n\n`);
  });
  const claimUnsub = store.onRemoteClaim(({ claim, spaceId }) => {
    res.write(`event: claim\ndata: ${JSON.stringify({ claim, spaceId })}\n\n`);
  });

  const ping = setInterval(() => res.write(`: ping\n\n`), 25000);

  req.on('close', () => {
    clearInterval(ping);
    nodeUnsub();
    claimUnsub();
  });
});

// ─── /extract — legacy shim (OpenAI, original behaviour) ─────────────────────

const extractionSchema = {
  type: 'object',
  properties: {
    operations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['move', 'remove'] },
          target: { type: 'string' },
          new_parent: { type: 'string' }
        },
        required: ['type', 'target', 'new_parent'],
        additionalProperties: false
      }
    },
    concepts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          parent_label: { type: 'string' },
          reasoning: { type: 'string' }
        },
        required: ['label', 'parent_label', 'reasoning'],
        additionalProperties: false
      }
    }
  },
  required: ['operations', 'concepts'],
  additionalProperties: false
};

function buildExtractionSystemPrompt(existingLabels) {
  const existing = existingLabels.length > 0 ? existingLabels.join('\n  ') : '(none yet)';
  return `You process a user's spoken utterance and output TWO things:
1. "operations" — graph edit commands (move/remove) the user issued verbally.
2. "concepts" — new concepts to add to a hierarchical knowledge graph rooted at the user ("me").

Every existing node has a short code like "A1", "B3". Codes:
  ${existing}

=== OPERATIONS ===
If the user says "move B4 to A2", "remove C3", "delete that", emit an operation.
  - {"type":"move","target":"B4","new_parent":"A2"}
  - {"type":"remove","target":"C3","new_parent":""}
  - "move X to me" → new_parent:"me"

=== CONCEPTS ===
Decompose utterance into EVERY noteworthy concept. Err on the side of MORE concepts.
- parent_label: "me" for fresh top-level topics; existing CODE to extend; label of another concept in this response when nested.
- Order parents before children.
- NEVER duplicate an existing concept — reference its code as parent_label instead.
- Labels: 1–4 words, Title Case, no articles.
- Filler/greetings/yes-no → {"operations":[],"concepts":[]}.`;
}

app.post('/extract', async (req, res) => {
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OPENAI_API_KEY is not set on the server' });
  }

  const { transcript, assistantPrior, nodes } = req.body || {};
  if (!transcript || typeof transcript !== 'string') {
    return res.status(400).json({ error: 'transcript (string) required' });
  }

  const existingLabels = Array.isArray(nodes)
    ? nodes.filter(n => typeof n === 'string' && n.trim()).slice(0, 200)
    : [];

  try {
    const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: EXTRACT_MODEL,
        messages: [
          { role: 'system', content: buildExtractionSystemPrompt(existingLabels) },
          {
            role: 'user',
            content: assistantPrior
              ? `Assistant just said: "${assistantPrior}"\n\nUser replied: "${transcript}"\n\nExtract concepts from the user's reply.`
              : `User said: "${transcript}"\n\nExtract concepts.`
          }
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'concepts_extraction', schema: extractionSchema, strict: true }
        }
      })
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      return res.status(upstream.status).send(text);
    }

    const data = await upstream.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return res.status(500).json({ error: 'no content in extract response', raw: data });

    let parsed;
    try { parsed = JSON.parse(content); }
    catch { return res.status(500).json({ error: 'failed to parse extract JSON', raw: content }); }

    res.json(parsed);
  } catch (err) {
    console.error('[extract] fetch failed', err);
    res.status(502).json({ error: String(err) });
  }
});

const port = process.env.PORT || 3000;

// Wait for GUN to bootstrap from persisted data before accepting requests
store.awaitBootstrap().then(() => {
  app.listen(port, () => {
    console.log(`PHAROS voice-to-graph listening on http://localhost:${port}`);
  });
});
