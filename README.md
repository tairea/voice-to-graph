# PHAROS — voice-to-graph

Have a natural voice conversation, and watch your ideas resolve themselves
into a live 3D **knowledge graph** anchored to your avatar. Every concept
is reconciled against an identity-aware store (PHAROS) that decides whether
the utterance is a *new* idea, *related* to an existing one, the *same*
idea expressed differently, or in *conflict* with something already there.

Each graph can be selectively shared with another PHAROS instance —
publicly (visible to anyone running PHAROS), to a specific peer
(end-to-end encrypted), or to anyone who has exchanged DIDs with you.
Sharing rides a hosted **Gun.js** relay that every instance joins by
default — `npm start` is all you need.

---

## Architecture at a glance

```
        Browser (3D force graph + voice)
                     │
                     ▼
   ┌──────────────── server.js ────────────────┐
   │  /session         OpenAI Realtime ticket   │
   │  /ingest          PHAROS resolver          │
   │  /ingest/share    publish subtree          │
   │  /ingest/peers    peer CRUD                │
   │  /ingest/events   SSE for remote shares    │
   └────────┬──────────────────────┬────────────┘
            │                      │
            ▼                      ▼
     pharos-store.js          gun-store.js
   in-mem + JSON file       Gun graph + SEA DID
   (canonical state)        (network sync layer)
                                   │
                                   ▼
                        Gun relay (deploy/gun-relay)
                        WebSocket on :8765
                                   │
                                   ▼
                          other PHAROS instances
```

**Two layers of storage on purpose**: the in-memory + JSON file is the
canonical state — fast, synchronous, durable across restarts. Gun is the
network sync layer — every write mirrors into a Gun graph that another
peer (over a relay) can subscribe to.

---

## Project elements

### Backend

| File | Role |
|---|---|
| `server.js` | Express endpoints: `/session`, `/ingest`, `/ingest/state`, `/ingest/identity`, `/ingest/share`, `/ingest/peers`, `/ingest/events`, plus the legacy `/extract` shim. |
| `pharos-resolver.js` | Calls Anthropic (`claude-sonnet-4-6` by default) with the PHAROS prompt + `pharos_ingest` tool. Maps each `outcome` (`new` / `related` / `same` / `conflicting`) onto store mutations. |
| `pharos-prompt.js` | The CubeCodex system prompt — six cube faces, predicate selection rules, ingest tool schema. |
| `pharos-store.js` | In-memory Map+Array with synchronous JSON-file persistence (`pharos-data.json`). Houses nodes, claims, contexts, branch codes, public spaces, peers. Mirrors every write into Gun and exposes the sharing API (`makePublic`, `shareWithSpecific`, `linkToAvatar`, `subscribeToInbox`, etc.). |
| `gun-store.js` | Gun graph init, persistent SEA keypair (`data/identity.json`), path helpers, remote event emitter consumed by SSE. |

### Frontend (`public/`)

| File | Role |
|---|---|
| `index.html` | Mic button, drop zone, info / voice / peers panels, modal scaffolding. |
| `style.css` | Visual language: cobalt panels, gold for shared/synthesized, predicate-coloured edges. |
| `js/realtime.js` | WebRTC session with `gpt-realtime-mini`; surfaces user transcripts and assistant prior turns. |
| `js/graph.js` | 3D force graph; node/edge rendering by resonance + predicate; gold halo for shared subtrees; right-click hook. |
| `js/main.js` | Wires transcripts → `/ingest`; SSE subscription for remote shares; right-click context menu; share / peer-add modals; DID badge with click-to-copy. |
| `js/avatar.js` | Avatar upload + localStorage persistence; rendered as a circular sprite at the root `me` node. |

### Deploy (`deploy/`)

| File | Role |
|---|---|
| `Dockerfile.pharos` | Production image of the backend. |
| `gun-relay/Dockerfile` + `relay.js` | Tiny Gun WebSocket relay container, port 8765, persists via radisk. |
| `docker-compose.yml` | Local stack: `pharos` + `gun-relay` with shared volumes. |
| `README.md` | Local-stack and VPS instructions. |

### Runtime data (`data/`, gitignored)

| File | Role |
|---|---|
| `data/identity.json` | SEA keypair → stable `did:gun:<pub>` identity for this instance. |
| `data/gun/` | Gun radisk store (network sync state). |
| `pharos-data.json` | Canonical local store: nodes, claims, contexts, codeMap, peers, public spaces. |

---

## How a voice utterance becomes a node

1. `realtime.js` connects WebRTC to OpenAI Realtime, captures the
   user's transcript and the assistant's prior reply.
2. `main.js` POSTs to `/ingest` with `{ transcript, assistantPrior }`.
3. `server.js` creates a context, then calls `pharosResolve` (Anthropic
   with the `pharos_ingest` tool).
4. The resolver picks one of four outcomes per concept:
   - **new** → `addNode` + `assignCode` (allocates a branch letter and a
     new `A1`-style code)
   - **related** → `addClaim` with a typed predicate (`EXPRESSES`,
     `EMERGES_FROM`, `OPERATIONALIZES`, …) selected by **cube face**
   - **same** → `incrementExpression` on the existing node
   - **conflicting** → `addClaim` with `CONTRADICTS`; both endpoints get
     a red halo
5. The store persists to JSON, mirrors to Gun, and replies to the
   browser, which adds the node/edge to the 3D graph.

Voice editing commands (`"move B4 to A2"`, `"remove C3"`) flow through the
same path and emerge as `operations` that the frontend applies via
`graph.moveNode` / `graph.removeNode`.

---

## P2P subtree sharing

Right-click any node in the graph to choose:

| Mode | Where it goes | Who sees it |
|---|---|---|
| 🌐 **Make public** | `pharos>public>{spaceId}>graph` | anyone subscribed to the public index |
| 🔐 **Share with…** | `pharos>inbox>{recipientDID}>{spaceId}>graph` (encrypted with `SEA.secret(senderDID, recipientDID)`) | the named recipient only |
| 🔗 **Link to my avatar** | `pharos>users>{yourDID}>shared` | every peer who has added your DID |

A **DID** is generated from a SEA keypair on first run and cached in
`data/identity.json`. The peers panel shows your DID for click-to-copy
exchange. After you and Sam paste each other's DIDs, both instances
auto-subscribe to each other's avatar-shared subtree.

Remote nodes/edges arrive over the Gun graph, fan out through the
backend `EventEmitter`, ride the **`/ingest/events` SSE** stream to every
connected browser, and render in **gold** with a "shared from <DID>"
tooltip badge.

---

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/session` | OpenAI Realtime ephemeral client secret |
| `POST` | `/ingest` | Resolve transcript via PHAROS, returns `{ results, operations }` |
| `GET` | `/ingest/state` | Current store: nodes, claims, identity, peers, publicSpaces |
| `GET` | `/ingest/identity` | This instance's DID + name |
| `POST` | `/ingest/share` | `{ nodeId, mode: 'public' \| 'specific' \| 'avatar', recipientDID? }` |
| `DELETE` | `/ingest/share/:spaceId` | Tombstone a public share |
| `GET` | `/ingest/peers` | List known peers |
| `POST` | `/ingest/peers` | Add a peer `{ did, name?, relayAddress? }` |
| `DELETE` | `/ingest/peers/:did` | Remove a peer |
| `GET` | `/ingest/events` | SSE stream of remote shared nodes/claims |

---

## Environment

```
OPENAI_API_KEY=sk-...                # required (Realtime + extract shim)
ANTHROPIC_API_KEY=sk-ant-...         # required (PHAROS resolver)
PORT=3002                            # default port
GUN_RELAY_URL=https://experiments.sunriselabs.io/gun  # shared relay (default); set to your own for self-hosting
PHAROS_NAME=Ian                      # optional friendly name in the profile
RESOLVE_MODEL=claude-sonnet-4-6      # optional override
EXTRACT_MODEL=gpt-4.1-mini           # optional override
```

---

## Quick start (local)

Requires Node ≥18.

```bash
git clone https://github.com/tairea/voice-to-graph.git
cd voice-to-graph
npm install

echo OPENAI_API_KEY=sk-...    >  .env
echo ANTHROPIC_API_KEY=sk-... >> .env
npm start
```

Open http://localhost:3002, upload an avatar, click the mic, and start
talking. Drop a `.md` file on the bottom-left target to ingest a
document instead.

By default your instance joins the shared Gun relay at
`https://experiments.sunriselabs.io/gun`, so subtree shares converge
with anyone else running the app. To run **fully offline** (no P2P
sharing) set `GUN_RELAY_URL=` (empty) in `.env`. To **self-host the
relay** instead, run `cd deploy/gun-relay && npm install && node relay.js`
in another terminal and set `GUN_RELAY_URL=http://localhost:8765/gun`.

## Live deployment on this host

The live instance runs under PM2:

```bash
pm2 list
# voice-to-graph   ← node server.js              (port 3002)
# gun-relay        ← deploy/gun-relay/relay.js   (port 8765)
```

Front-ended by nginx at https://experiments.sunriselabs.io/voice-to-graph/
with `proxy_buffering off` for the SSE stream. Restart with
`pm2 restart voice-to-graph --update-env` after changing `.env`.

---

## Voice command examples

- *"I want to research legends from the Cook Islands"* → `A1: Cook Islands → A2: Legends`
- *"I also play guitar"* → starts a new branch `B1: Guitar`
- *"Move B1 to A1"* → re-parents the Guitar subtree under Cook Islands and recodes it
- *"Delete A2"* → removes the Legends subtree
- Right-click `A1` → *"Make public"* → Cook Islands subtree turns gold and is now visible to any peer subscribed to the public index

---

## Sharing protocol details (for the curious)

- DIDs are derived from a SEA keypair: `did:gun:<pub>`. The keypair lives
  in `data/identity.json` (gitignored).
- Specific-recipient encryption uses `SEA.secret(otherDID, ourPair)` to
  derive a symmetric key — both peers compute the same key without ever
  exchanging it.
- Public-space metadata (`pharos>publicSpaces>{spaceId}`) lets any
  subscribed peer discover and watch new spaces.
- The relay does **no auth** — it's a dumb message-pass over WebSocket.
  All confidentiality lives in SEA encryption for inbox shares;
  public/avatar modes are intentionally open.
- Because Gun is offline-first, both peers can mutate while disconnected
  and converge when the relay is reachable again.
