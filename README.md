# Fork Park: Quantum Chaos

An Exploding Fork-inspired cooperative platform game featuring a terminal-green lobby, six hand-designed platform levels, seeded random level generation, shard-and-switch puzzles, always-visible touch controls, and a real-time party system powered by a Node.js WebSocket web service.

## Deploy directly as a Render Web Service

**Create a Web Service, not a Blueprint.** There is no `render.yaml` needed for this setup.

1. Open the [Render dashboard](https://dashboard.render.com/).
2. Click **New → Web Service**.
3. Connect your GitHub account if needed, then select `Hexkeys/Fork-park`.
4. Configure the service with these exact settings:

   | Setting | Value |
   | --- | --- |
   | Name | `fork-park` |
   | Branch | `main` |
   | Runtime / Language | `Node` |
   | Build Command | `npm install` |
   | Start Command | `npm start` |
   | Health Check Path (Advanced) | `/healthz` |

5. Select a plan and click **Create Web Service**.
6. When the deployment finishes, open the `onrender.com` URL shown on the service page. The site and party WebSocket use the same URL.

Render provides a public URL and supports WebSocket connections for Web Services. The server binds to `0.0.0.0` and uses Render's `PORT` environment variable.

## Run locally

Requires Node.js 20 or newer.

```sh
npm install
npm start
```

Open http://localhost:10000. Do not open `index.html` directly from the filesystem: multiplayer connects to the same-origin `/ws` WebSocket endpoint served by `server.js`.

## Lobby and controls

The landing page follows the Exploding-fork repo's dark terminal-green style, with a sticky network header, a game-description/rules panel, separate **Create Party** and **Join Party** forms, and a waiting lobby showing the six-character room code and crew roster. The party leader can initialize the arena once at least two players have joined.

- **Move left:** A or ←
- **Move right:** D or →
- **Jump:** W, ↑, or Space
- **On every device:** left and right arrow buttons stay visible below the game, on the left; the jump button stays on the right. Keyboard controls also work on desktop.
- **Level selection:** six designed levels — The Split, Neon Steps, Switchback, Crate Lab, Orbital Fork, and Final Protocol — plus **RANDOM** for repeatable, seed-based layouts.
- **Puzzle goal:** collect three glowing shards, activate circuit switches to open gate platforms, and get your whole crew into the portal. **HINT** gives the next objective.
- **Extra buttons:** PREV, NEXT, RESTART, RANDOM, HINT, and PULSE / E. The PULSE button activates a nearby switch or gives a short boost.
- **Party sync:** the leader controls level changes and random seeds; level changes and switch activations are broadcast to the crew.
- **Arena navigation:** use **← LOBBY** to return to your waiting room or home screen.

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

- `npm run check` parses the browser JavaScript and checks key client, server, and deployment settings.
- `npm test` starts a temporary local server and checks HTTP health, room creation/joining, movement relays, code validation, party capacity, and disconnect handling.

GitHub Actions runs these checks on pushes to `main` and pull requests.

## Limits to know

Party rooms are held in server memory, so they disappear when the service restarts. Run one service instance unless you add a shared data store; multiple independent instances won't share party state. Player positions are validated and relayed by the server, but physics are still simulated on each browser, so this isn't a fully authoritative game server. There are no accounts, chat, or saved progress yet.

## Theme

Exploding Fork + Quantum Fork.
