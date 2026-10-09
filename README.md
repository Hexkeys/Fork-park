# Fork Park: Quantum Chaos

A fork-themed cooperative platform game with original neon visuals, quantum pads, and a portal goal.

## Play locally
Open `index.html` in a modern browser. The game is a static site and needs no build step.

## Deploy to Render
This repo includes `render.yaml` for a Render static site.

1. Sign in to Render and choose **New → Blueprint**.
2. Connect the GitHub repository `Hexkeys/Fork-park`.
3. Select the Blueprint from the repository root (`render.yaml`) and deploy.
4. Render will publish `index.html` as a static website and provide the live URL.

You can also create a **New → Static Site** manually, select this repo and the `main` branch, use `echo "No build step needed"` as the build command, and `.` as the publish directory.

## Controls
- **Move left:** A or ←
- **Move right:** D or →
- **Jump:** W, ↑, or Space
- **Mobile:** left and right buttons on the left; jump on the right

## Party multiplayer
1. Open the deployed game in a browser.
2. Click **Create party** and share the six-character party code.
3. Friends open the same game, enter that code, and click **Join**.

Party connections use PeerJS signaling and WebRTC. Players need a compatible network and access to the PeerJS CDN/signaling services. Multiplayer state is relayed through the party host, so the host must keep the page open. This remains a prototype: it has no server-authoritative physics, accounts, chat, matchmaking, or guaranteed reconnection. Public PeerJS signaling/network policies may also affect availability.

## Current gameplay
- A sample platforming course with glowing quantum platforms
- Keyboard and touch controls
- Peer-to-peer party codes and player position sharing
- Portal completion and quick replay

## Theme
Exploding Fork + Quantum Fork.
