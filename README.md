# ai-to-graph

Have a natural voice conversation with OpenAI's Realtime voice model and watch your ideas draw themselves into a live 3D knowledge graph, branch by branch.

## What it does

- **Voice chat** with `gpt-realtime-mini` over WebRTC — just click Start and talk.
- Every user utterance is transcribed and sent to a second model (`gpt-4.1-mini`) that **decomposes it into a hierarchical concept tree** rooted at you (the "me" avatar node).
- Concepts render as a **live 3D force graph** via [3d-force-graph](https://github.com/vasturiano/3d-force-graph). Hover an edge to see the reasoning that linked the two concepts.
- **Branch codes**: each top-level topic starts a new branch (A, B, C…). Nodes are labeled `A1`, `A2`, `B1`… so you can reference them out loud.
- **Voice editing commands**: say things like *"move B4 to A2"*, *"remove C3"*, *"delete A1"* — the graph re-parents or prunes subtrees on the fly.
- **Custom avatar**: upload any image; it's rendered as a circular sprite at the root and persisted in localStorage.

## Requirements

- Node 18+ (uses built-in `fetch`)
- An **OpenAI API key with access to the Realtime API** (`gpt-realtime-mini`)

## Setup

```bash
git clone https://github.com/tairea/ai-to-graph.git
cd ai-to-graph
npm install
```

Create a `.env` file in the project root with your OpenAI API key:

```
OPENAI_API_KEY=sk-...
```

> ⚠️ **The OpenAI API key is required.** The server uses it to mint ephemeral realtime client secrets (`/v1/realtime/client_secrets`) for the voice connection and to call Chat Completions for concept extraction. Without it the `/session` and `/extract` endpoints will return 500.

Optional overrides:

```
EXTRACT_MODEL=gpt-4.1-mini   # model used for concept extraction
PORT=3000
```

## Run

```bash
npm start
```

Open http://localhost:3000, upload an avatar, click **Start**, and start talking.

## How it works

- `server.js` — Express backend with two endpoints:
  - `POST /session` — exchanges your API key for an ephemeral realtime client secret.
  - `POST /extract` — takes the user transcript + the assistant's prior turn + the current graph node list, and returns structured `{operations, concepts}` via a strict JSON schema.
- `public/js/realtime.js` — WebRTC session with the realtime model. Captures user transcripts (`conversation.item.input_audio_transcription.completed`) and the assistant's spoken turn (`response.audio_transcript.done`) to give the extractor context.
- `public/js/graph.js` — 3d-force-graph scene, branch/code allocation, `addConcept` / `removeNode` / `moveNode`, always-visible label sprites.
- `public/js/main.js` — wires transcripts → `/extract` → graph mutations.

## Voice command examples

- *"I want to research legends from the Cook Islands"* → adds `A1: Research → A2: Cook Islands → A3: Legends`
- *"I also play guitar"* → starts a new branch `B1: Guitar`
- *"Move B1 to A2"* → re-parents the Guitar subtree under Cook Islands and recodes it
- *"Delete A3"* → removes the Legends subtree
