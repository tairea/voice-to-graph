import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const REALTIME_MODEL = 'gpt-realtime-mini';
const EXTRACT_MODEL = process.env.EXTRACT_MODEL || 'gpt-4.1-mini';

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
      body: JSON.stringify({
        session: {
          type: 'realtime',
          model: REALTIME_MODEL
        }
      })
    });

    const text = await upstream.text();
    res.status(upstream.status).type(upstream.headers.get('content-type') || 'application/json').send(text);
  } catch (err) {
    res.status(502).json({ error: String(err) });
  }
});

const extractionSchema = {
  type: 'object',
  properties: {
    operations: {
      type: 'array',
      description: 'Graph edit commands the user issued (move/remove/delete). Processed before concepts.',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['move', 'remove'] },
          target: { type: 'string', description: 'Code of the node to operate on, e.g. "B4".' },
          new_parent: { type: 'string', description: 'For move: the new parent code or "me". For remove: empty string "".' }
        },
        required: ['type', 'target', 'new_parent'],
        additionalProperties: false
      }
    },
    concepts: {
      type: 'array',
      description: 'Concepts extracted from the utterance, ordered parents before children.',
      items: {
        type: 'object',
        properties: {
          label: {
            type: 'string',
            description: 'Short 1–4 word concept label in Title Case.'
          },
          parent_label: {
            type: 'string',
            description:
              'Parent in the graph. Use "me" for a top-level topic. ' +
              'Use an existing node CODE (e.g. "A2") when this extends an existing node. ' +
              'Use the label of another concept extracted earlier in this same response when they nest.'
          },
          reasoning: {
            type: 'string',
            description: '1–2 sentences explaining why this concept matters and how it relates to the user.'
          }
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
  return `You process a user's spoken utterance in an ongoing voice conversation and output TWO things:
1. "operations" — graph edit commands (move/remove) the user issued verbally.
2. "concepts" — new concepts to add to a hierarchical knowledge graph rooted at the user ("me").

Every existing node has a short code like "A1", "B3". The graph is organized into branches (A, B, C...) — one branch per top-level topic off "me". Codes look like:
  ${existing}

=== OPERATIONS ===
If the user says things like "move B4 to A2", "remove C3", "delete that", "get rid of A1", emit an operation:
  - {"type": "move", "target": "B4", "new_parent": "A2"} — re-parents B4 and its descendants under A2.
  - {"type": "remove", "target": "C3", "new_parent": ""} — deletes C3 and all its descendants.
  - For "delete" / "remove", always set new_parent to "".
  - If the user says "move X to me" or "make X a new branch", use new_parent: "me".
  - Match targets to the closest existing CODE. If ambiguous, skip the operation.
When the utterance is a pure command, return empty "concepts" and only operations.

=== CONCEPTS ===
Otherwise, decompose the utterance into EVERY noteworthy concept — entities, places, activities, topics, interests, feelings, goals. Err on the side of MORE concepts.
- parent_label rules:
  - "me" if it is a fresh top-level topic.
  - An EXISTING node CODE (e.g. "A2") when it extends something already in the graph.
  - The label of ANOTHER concept extracted earlier in this same response when they nest. Order parents-before-children.
- Decompose compound ideas into a chain:
  - "legends from the Cook Islands" → [{label:"Cook Islands", parent_label:"me"}, {label:"Legends", parent_label:"Cook Islands"}]
  - "I want to research Polynesian navigation" → [{label:"Polynesia", parent_label:"me"}, {label:"Navigation", parent_label:"Polynesia"}, {label:"Research", parent_label:"Navigation"}]
- NEVER duplicate an existing concept — reference its code as parent_label instead.
- Labels are 1–4 words, Title Case, no articles.
- Filler / greetings / yes-no → return {"operations": [], "concepts": []}.`;
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
              ? `Assistant just said: "${assistantPrior}"\n\nUser replied: "${transcript}"\n\nExtract concepts from the user's reply, using the assistant's prior turn only as context for resolving references (pronouns, "yes", "that one", etc.).`
              : `User said: "${transcript}"\n\nExtract concepts from the user's utterance.`
          }
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'concepts_extraction',
            schema: extractionSchema,
            strict: true
          }
        }
      })
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      console.error('[extract] upstream error', upstream.status, text);
      return res.status(upstream.status).send(text);
    }

    const data = await upstream.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      return res.status(500).json({ error: 'no content in extract response', raw: data });
    }

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      return res.status(500).json({ error: 'failed to parse extract JSON', raw: content });
    }

    res.json(parsed);
  } catch (err) {
    console.error('[extract] fetch failed', err);
    res.status(502).json({ error: String(err) });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`ai-to-graph listening on http://localhost:${port}`);
});
