# Fork Park: Quantum Chaos

A fork-themed cooperative platform game featuring neon levels, quantum pads, and an in-game party system powered by a Node.js WebSocket service.

## Run locally

Requires Node.js 20 or newer.

```sh
npm install
npm start
```

Then open http://localhost:10000. Do not open `index.html` directly from the filesystem: multiplayer connects to the same-origin `/ws` WebSocket endpoint served by `server.js`.

## Deploy on Render

The root `render.yaml` defines a **Node web service**, not a static site. It installs the `ws` dependency, runs `npm start`, and uses `/healthz` as the service health check.

1. Sign in to Render and select **New → Blueprint**.
2. Connect `Hexkeys/Fork-park`.
3. Review the service in `render.yaml` and deploy it.
4. Open the `onrender.com` URL Render gives the service. The game and party WebSocket use that same URL.

Render web services support inbound WebSocket connections. The browser automatically uses `wss://` on HTTPS deployments.

## Controls

- **Move left:** A or ←
- **Move right:** D or →
- **Jump:** W, ↑, or Space
- **Mobile:** left/right buttons on the left; jump on the right

## Party system

1. Click **Create party**.
2. Share the six-character room code.
3. Friends open the same website, enter the code, and click **Join**.

The server manages party rooms and supports up to eight players per party. It relays player positions, informs the party when members join or leave, validates codes and movement values, and transfers party-host status when the owner disconnects. WebSocket connections have a ping/pong heartbeat.

## Testing and debugging

```sh
npm run check
npm test
```

- `npm run check` checks the inline browser JavaScript and required service/deployment features.
- `npm test` starts a temporary local server and checks HTTP health, room creation/joining, movement relays, code validation, party capacity, and disconnect handling.

GitHub Actions runs the checks on pushes to `main` and pull requests.

## Limits to know

Party rooms are held in server memory, so they disappear when the service restarts. This prototype is intended to run as one service instance; multiple independent instances would not share room state without a shared store. Player positions are validated and relayed by the server, but physics are still simulated on each browser, so this is not a fully authoritative anti-cheat game server. There are no accounts, chat, or saved progress yet.

## Theme

Exploding Fork + Quantum Fork.
