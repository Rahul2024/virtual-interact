# Virtual Interact

An open-source 3D social city that runs in the browser. Walk around a hub, see
other people's avatars move in real time, talk to them. Districts, events and
games plug in without touching the core.

**Status: milestone 1 — walk, see each other, talk, and the Idea Wall.** Two
browser tabs on the same server see each other move, chat, and hear each other
by proximity. By the plaza there is an Idea Wall: anyone can post what they
want this place to have, vote, and say "I'll build this". Districts and the
plug-in SDK come next; the plan is in the design doc, and the process is in
[CONTRIBUTING.md](CONTRIBUTING.md).

## Run it

You need [Node.js 22+](https://nodejs.org/). Then:

```bash
npm install
npm run dev
```

That starts the world server on `ws://localhost:2567` and the client on
`http://localhost:5173`. Open the client in two tabs (or two browsers), pick a
name and colour in each, and walk towards yourself.

| Key | Action |
| --- | --- |
| `W A S D` / arrows | walk |
| `Shift` | run |
| drag with the mouse | look around |
| scroll | zoom |
| `Enter` | chat, `Esc` to leave the chat box |
| `M` | turn your mic on; then mute / unmute (or the mic button, top right) |
| `E` near the Idea Wall | post, vote, claim ideas (or the "Idea Wall" button, top right) |

### Voice

Turn your mic on and you hear whoever is near you: full volume within 8 m,
fading to silence at 20 m, panned to the side they're standing on. A green dot
on a nameplate means that person's mic is on; it glows while they talk.

Voice is peer-to-peer for now: audio goes straight between browsers, and the
world server only passes the WebRTC handshake. That is right for a handful of
people in one spot; for a full plaza we switch to a LiveKit SFU behind the
same `Voice` class (see the design doc).

Things to know:

- Browsers only allow the microphone on `http://localhost` or `https://`.
  Over a plain `http://192.168…` address the button will say "Voice
  unavailable": put the client behind HTTPS (Cloudflare Pages does this for
  free) or use an `https` dev tunnel.
- Two tabs on one machine both share the same mic; mute one or you'll hear
  yourself.
- Across the internet, some home routers need a TURN server to connect two
  browsers directly. Not configured yet; LiveKit removes the problem.

To let someone on your network join, run the client with `--host` and point it
at your machine's address:

```bash
VITE_SERVER_URL=ws://192.168.1.20:2567 npm run dev -w packages/client -- --host
```

## Layout

```
packages/
  shared/        constants and message contracts used by both sides
  world-server/  Colyseus 0.18 server: the hub room, movement validation, chat
  client/        Vite + Three.js: the 3D hub, avatars, controls, HUD
```

- The **server owns the truth**: clients send where they are, the server checks
  it is physically plausible (speed, bounds) and broadcasts the result at 20 Hz.
- The **client predicts**: your own avatar moves instantly; others are
  interpolated from the last server patch.
- **Avatars** are procedural low-poly figures built from primitives, so there
  are no assets to load. The modular wardrobe replaces them later.
- **Ideas** live on the server in `packages/world-server/data/ideas.json`
  (set `IDEAS_FILE` to move it). Votes and claims are tied to a random id the
  browser keeps, until accounts exist.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | server + client with hot reload |
| `npm run typecheck` | strict TypeScript across all packages |
| `npm run build` | production client bundle in `packages/client/dist` |
| `npm test` | boots a server and joins two SDK clients to check movement, clamping and chat |
| `npm start` | world server only (what you'd run on a box) |

## Going live for free

[docs/DEPLOY.md](docs/DEPLOY.md) walks through it click by click: the code on
GitHub, both services on Render from the `render.yaml` blueprint, and a free
Upstash Redis so the Idea Wall survives restarts. The client is plain static
files, so any static host works; the server is one Node process (`npm start`)
that reads `PORT`, and `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`
or `IDEAS_FILE` for where to keep ideas.

## Roadmap (short version)

1. **Foundations** — this repo, CI, one-command dev loop. ✅
2. **Walk and talk** — proximity voice ✅ (peer-to-peer; LiveKit for crowds), wardrobe, SDK v0.1.
3. **First activities** — stage with synced video, cinema seat pairs, trivia,
   whiteboard, user-created events, moderation tools.
4. **Private launch** — 200 invited people, nightly events.

## License

[AGPL-3.0-or-later](LICENSE). Use it, change it, share it; if you run a
modified copy as a public service, publish your changes. Community plug-ins
will live under MIT once the `plugins/` folder exists, so builders keep their
work permissive.
