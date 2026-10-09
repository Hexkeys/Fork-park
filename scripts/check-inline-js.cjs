const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8');
const inlineScripts = [...html.matchAll(/<script\\b[^>]*>([\\s\\S]*?)<\\/script>/gi)]
  .map((match) => match[1].trim())
  .filter(Boolean);

if (inlineScripts.length === 0) {
  throw new Error('No inline browser JavaScript was found in index.html');
}
for (const [index, source] of inlineScripts.entries()) {
  new vm.Script(source, { filename: `index.html:inline-script-${index + 1}` });
}

const server = fs.readFileSync('server.js', 'utf8');
const render = fs.readFileSync('render.yaml', 'utf8');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

const checks = [
  ['canvas game', html.includes('<canvas id="game"')],
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
  ['Render Node web service', render.includes('runtime: node') && render.includes('type: web')],
  ['Render start and health configuration', render.includes('startCommand: npm start') && render.includes('healthCheckPath: /healthz')],
  ['package scripts', pkg.scripts.start === 'node server.js' && pkg.scripts.test === 'node --test' && pkg.scripts.check === 'node scripts/check-inline-js.cjs'],
  ['WebSocket dependency', Boolean(pkg.dependencies && pkg.dependencies.ws)],
];

const failures = checks.filter(([, passed]) => !passed).map(([name]) => name);
if (failures.length) {
  throw new Error('Smoke checks failed: ' + failures.join(', '));
}
console.log(`Passed ${checks.length} game/service/deployment smoke checks and parsed ${inlineScripts.length} inline script(s).`);
