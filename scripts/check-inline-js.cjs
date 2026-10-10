const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8');
const startTag = '<script>';
const start = html.indexOf(startTag);
const end = start < 0 ? -1 : html.indexOf('</script>', start + startTag.length);
if (start < 0 || end < 0) {
  throw new Error('Could not find the inline browser script in index.html');
}
const inlineScript = html.slice(start + startTag.length, end).trim();
if (!inlineScript) throw new Error('The inline browser script is empty');
new vm.Script(inlineScript, { filename: 'index.html:inline-script' });

const server = fs.readFileSync('server.js', 'utf8');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

const checks = [
  ['canvas game', html.includes('<canvas id="game"')],
  ['six designed levels and level controls', html.includes('FINAL PROTOCOL') && ['prevLevelBtn', 'nextLevelBtn', 'restartLevelBtn', 'randomLevelBtn'].every((id) => html.includes('id="' + id + '"'))],
  ['seeded random level generation', html.includes('function randomLevelData(seed)') && html.includes('RANDOM PROTOCOL')],
  ['shard and switch puzzles', html.includes('world.shards.every') && html.includes('function activateSwitch()') && html.includes('FIND SWITCH')],
  ['party puzzle-action receiver', html.includes('function applyPuzzleAction()') && html.includes("m.type==='puzzle_action'") && server.includes("message.type === 'puzzle_action'")],
  ['keyboard and mobile puzzle action control', html.includes("e.key.toLowerCase()==='e'") && html.includes('id="actionBtn"')],
  ['leader-controlled synchronized level changes', html.includes("type:'set_level'") && html.includes("m.type==='level_changed'") && server.includes("message.type === 'set_level'") && server.includes("message.type === 'puzzle_action'")],
  ['Exploding Fork terminal home screen', html.includes('id="lobbyHome"') && html.includes('EXPLODING') && html.includes('[ EXPLODING // FORK ]')],
  ['Separate create, join, and waiting-lobby screens', ['createScreen', 'joinScreen', 'partyLobby'].every((id) => html.includes('id="' + id + '"'))],
  ['Leader-controlled lobby launch', html.includes("type:'start_party'") && html.includes("m.type==='party_started'")],
  ['arena enter/back navigation', html.includes('id="enterArenaBtn"') && html.includes('id="returnLobbyBtn"')],
  ['arrows and jump remain visible on desktop and mobile', html.includes('.touch{display:flex;justify-content:space-between') && ['leftBtn', 'rightBtn', 'jumpBtn'].every((id) => html.includes('id="' + id + '"'))],
  ['mobile left/right/jump controls', ['leftBtn', 'rightBtn', 'jumpBtn'].every((id) => html.includes(`id="${id}"`))],
  ['browser WebSocket client', html.includes("new WebSocket(protocol+'//'+window.location.host+'/ws')")],
  ['party create and join messages', html.includes("type:'create_party'") && html.includes("type:'join_party',code")],
  ['legacy PeerJS removed', !html.toLowerCase().includes('peerjs')],
  ['HTTP health endpoint', server.includes("pathname === '/healthz'")],
  ['WebSocket server path', server.includes("path: '/ws'")],
  ['server-side party create and join', server.includes("message.type === 'create_party'") && server.includes("message.type === 'join_party'")],
  ['eight-player capacity limit', server.includes('const MAX_PARTY_SIZE = 8')],
  ['state validation and relay', server.includes('Number.isFinite(message.x)') && server.includes("type: 'player_state'")],
  ['leave handling and owner transfer', server.includes('function leaveParty(socket)') && server.includes('room.ownerId = room.players.keys().next().value')],
  ['server checks leader and minimum crew before starting', server.includes("'NOT_PARTY_LEADER'") && server.includes("'PARTY_NEEDS_PLAYERS'")],
  ['server honors player display names', server.includes('cleanPlayerName(requestedName') && server.includes('addPlayer(socket, room, message.name)')],
  ['Render-compatible host binding', server.includes("const HOST = '0.0.0.0'")],
  ['Render-compatible port', server.includes('process.env.PORT')],
  ['Node web-service start script', pkg.scripts.start === 'node server.js'],
  ['package scripts', pkg.scripts.start === 'node server.js' && pkg.scripts.test === 'node --test' && pkg.scripts.check === 'node scripts/check-inline-js.cjs'],
  ['WebSocket dependency', Boolean(pkg.dependencies && pkg.dependencies.ws)],
];

const failures = checks.filter(([, passed]) => !passed).map(([name]) => name);
if (failures.length) {
  throw new Error('Smoke checks failed: ' + failures.join(', '));
}
console.log(`Passed ${checks.length} game/web-service smoke checks and parsed the inline browser script.`);
