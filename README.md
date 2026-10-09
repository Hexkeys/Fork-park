# Fork Park: Quantum Chaos

A fork-themed co-op platform game prototype inspired by the cooperative puzzle-platform genre, with original visuals and levels.

## Play
Open `index.html` in a modern browser, or enable GitHub Pages for this repository (Settings → Pages → Deploy from a branch → `main` / `/ (root)`).

## Controls
- **Move left:** A or ←
- **Move right:** D or →
- **Jump:** W, ↑, or Space
- **Mobile:** left/right buttons on the left side; jump button on the right

## Party multiplayer
1. Open the game in a browser.
2. Click **Create party** and share the displayed party code.
3. Friends open the same game and enter the code, then click **Join**.

Party connectivity uses PeerJS's public signaling service and WebRTC. Both players need a compatible network and access to the PeerJS CDN/signaling service. This is an early prototype: movement synchronization is peer-to-peer, and it does not yet include authoritative server validation, persistent accounts, chat, matchmaking, or a robust reconnect flow.

## Theme
Exploding Fork + Quantum Fork, neon platforms, quantum pads, and a portal goal.
