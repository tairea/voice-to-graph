export const toolSchema = {
  type: 'function',
  name: 'add_concept',
  description:
    'Record a key concept, idea, person, place, or fact that the user just brought up. ' +
    'Call this whenever something noteworthy emerges in the conversation. ' +
    'Keep labels short (1–4 words). Do not narrate that you are calling the function.',
  parameters: {
    type: 'object',
    properties: {
      label: {
        type: 'string',
        description: 'Short concept label (1–4 words).'
      },
      reasoning: {
        type: 'string',
        description: 'Why this is a key concept and how it relates to the user (1–2 sentences).'
      },
      parent_label: {
        type: 'string',
        description:
          'Optional. The label of an existing concept that this new concept logically extends. ' +
          'Omit to chain onto the most recently mentioned concept (the usual case). ' +
          'Pass "me" to start a fresh branch directly from the user when they pivot to an ' +
          'unrelated topic. Pass an earlier concept\'s exact label when the user returns to it.'
      }
    },
    required: ['label', 'reasoning']
  }
};

function uuid() {
  if (crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'c_' + Math.random().toString(36).slice(2, 10);
}

export async function handleToolCall(name, args, graph) {
  if (name === 'add_concept') {
    const id = uuid();
    const label = String(args.label || '').trim() || 'concept';
    const reasoning = String(args.reasoning || '').trim();
    const parentLabel = args.parent_label ? String(args.parent_label).trim() : null;
    graph.addConcept({ id, label, reasoning, parentLabel });
    return { ok: true, id };
  }
  return { ok: false, error: `unknown tool: ${name}` };
}
