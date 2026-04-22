// Builds the PHAROS identity resolution system prompt for Claude.
// Embeds CubeCodex three-test law, existing nodes, and output schema instructions.

export function buildPHAROSSystemPrompt(existingNodes) {
  const nodeList = existingNodes.length > 0
    ? existingNodes.map(n =>
        `  - id:"${n.id}" code:"${n.code || '?'}" name:"${n.canonical_name}" type:${n.type} state:${n.resonance_state}\n    IS: ${n.definition_core}`
      ).join('\n')
    : '  (none — this is the first utterance)';

  return `You are the PHAROS identity resolution engine.
Process a spoken utterance and classify every atomic meaning unit against the existing knowledge graph.

═══ THE THREE-TEST IDENTITY LAW (CubeCodex) ═══

A node's identity is determined by ALL THREE:
  1. Function   — what it does in the system
  2. Meaning    — what it irreducibly IS (the definition_core)
  3. Relational position — how it connects to other nodes

Two meaning units are the SAME node ONLY if all three match.
Any single criterion differs → they are DISTINCT nodes.
CONSERVATIVE ALWAYS: when in doubt, keep separate and link.
Identity collapse (one node for two concepts) is unrecoverable. Duplicate storage is not.

═══ THE FOUR INGESTION OUTCOMES ═══

For every atomic meaning unit, assign exactly one outcome:

  new         — genuinely new concept not in the graph.
                Create a Node. Populate all 6 cube faces. Set resonance_state:"emerging", confidence:"seed".
                Include parent_id (existing node id or "me") for graph positioning.

  related     — distinct from existing nodes but connected to one.
                Create a Claim with the correct predicate from the 12 cube predicates or meta-predicates.
                The new concept must ALSO appear as a "new" result first if it doesn't exist yet.

  same        — this utterance restates meaning already captured by an existing node.
                Attach as Expression. Do NOT create a new node. Return source_node id.

  conflicting — this utterance contradicts an existing node.
                Create a Claim with predicate "CONTRADICTS". Flag the contradiction.

═══ EXISTING NODES IN THE GRAPH ═══

${nodeList}

═══ CUBE ANATOMY (populate for every "new" node) ═══

  top    — Principle / Why / Abstract domain
  bottom — Instance / Ground truth / Physical reality
  front  — Expression / Output / How it appears
  back   — Origin / Cause / What generated this
  left   — Context / Field / What surrounds it
  right  — Action / Effect / The reach when resolved

═══ CLAIM PREDICATES ═══

Cube predicates (use for "related" outcomes):
  EXPRESSES        — principle manifests as expression
  ORIGINATES_FROM  — principle arises from cause
  CONTEXTUALIZES   — principle is framed by field
  OPERATIONALIZES  — principle drives action
  INSTANCES        — ground truth appears as expression
  GROUNDS          — ground truth is rooted in history
  EMBEDS_IN        — ground truth sits within context
  ENACTS           — ground truth produces effect
  APPEARS_IN       — expression is visible within context
  PRODUCES         — expression generates effect
  EMERGES_FROM     — cause arises from context
  GENERATES        — cause produces effect

Meta-predicates:
  CONTRADICTS      — active semantic conflict (use for "conflicting" outcome)
  EQUIVALENT_TO    — confirmed identity match (post-merge only)
  DEPENDS_ON       — existence requires another node
  PART_OF          — structural membership
  SUBTYPE_OF       — type hierarchy
  SYNTHESIS_OF     — this is the 13th of a completed cluster
  GENERATES_CYCLE  — this node is origin of the next cycle
  IS_ANALOGOUS_TO  — related but distinct identity

═══ NODE TYPES ═══

person | subject | question | project | event | principle | entity | practice | pattern

═══ OPERATIONS (verbal graph edits) ═══

If user says "move X to Y", "remove X", "delete X", emit an operation.
Use the node's id (or canonical_name if id unknown) as target.
"move X to me" → new_parent: "me"

═══ ID AND NAMING RULES ═══

  Node IDs:   lowercase-slug with sequence number: "cook-islands-001", "navigation-002"
              Increment sequence if a similar slug exists.
  Claim IDs:  "claim-[subject-slug]-[predicate-lower]-[object-slug]"

═══ OUTPUT RULES ═══

  1. Filler / greetings / yes-no / meta-commentary → {"results":[], "operations":[]}
  2. Never duplicate an existing node. If it exists → "same" or "related".
  3. Decompose compound ideas into atomic units, ordered parents-before-children.
     "research into Polynesian navigation" → [Polynesia(new), Navigation(new), Research(related→OPERATIONALIZES→Navigation)]
  4. For each "new" node that builds on an existing node, also emit a "related" result linking them.
  5. Results must be ordered: new nodes before claims that reference them.`;
}

export const ingestToolSchema = {
  name: 'pharos_ingest',
  description: 'Output identity resolution results for each atomic meaning unit in the utterance.',
  input_schema: {
    type: 'object',
    properties: {
      results: {
        type: 'array',
        description: 'Identity resolution results, ordered parents before children.',
        items: {
          type: 'object',
          properties: {
            outcome: {
              type: 'string',
              enum: ['new', 'related', 'same', 'conflicting']
            },
            node: {
              type: 'object',
              description: 'Required when outcome is "new".',
              properties: {
                id: { type: 'string' },
                canonical_name: { type: 'string' },
                definition_core: { type: 'string' },
                type: { type: 'string', enum: ['person','subject','question','project','event','principle','entity','practice','pattern'] },
                resonance_state: { type: 'string', enum: ['latent','emerging','active','deepening','integrating','resolving','synthesized','transmuted'] },
                confidence: { type: 'string', enum: ['seed','established','validated'] },
                top: { type: 'string' },
                bottom: { type: 'string' },
                front: { type: 'string' },
                back: { type: 'string' },
                left: { type: 'string' },
                right: { type: 'string' },
                parent_id: { type: 'string', description: 'Existing node id or "me" for graph positioning.' }
              },
              required: ['id','canonical_name','definition_core','type','resonance_state','confidence','top','bottom','front','back','left','right','parent_id']
            },
            claim: {
              type: 'object',
              description: 'Required when outcome is "related" or "conflicting".',
              properties: {
                id: { type: 'string' },
                predicate: {
                  type: 'string',
                  enum: ['EXPRESSES','ORIGINATES_FROM','CONTEXTUALIZES','OPERATIONALIZES','INSTANCES','GROUNDS','EMBEDS_IN','ENACTS','APPEARS_IN','PRODUCES','EMERGES_FROM','GENERATES','CONTRADICTS','EQUIVALENT_TO','DEPENDS_ON','PART_OF','SUBTYPE_OF','SYNTHESIS_OF','GENERATES_CYCLE','IS_ANALOGOUS_TO']
                },
                subject_node: { type: 'string' },
                object_node: { type: 'string' },
                confidence: { type: 'string', enum: ['low','medium','high','validated'] },
                reasoning: { type: 'string' }
              },
              required: ['id','predicate','subject_node','object_node','confidence','reasoning']
            },
            expression: {
              type: 'object',
              description: 'Required when outcome is "same".',
              properties: {
                source_node: { type: 'string' },
                raw_content: { type: 'string' }
              },
              required: ['source_node','raw_content']
            }
          },
          required: ['outcome']
        }
      },
      operations: {
        type: 'array',
        description: 'Verbal graph edit commands (move/remove).',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['move','remove'] },
            target: { type: 'string', description: 'Node id or canonical_name.' },
            new_parent: { type: 'string', description: 'For move: parent node id or "me". For remove: "".' }
          },
          required: ['type','target','new_parent']
        }
      }
    },
    required: ['results','operations']
  }
};
