const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8');
const scripts = [...html.matchAll(/<script\\b[^>]*>([\\s\\S]*?)<\\/script>/gi)]
  .map((match) => match[1].trim())
  .filter(Boolean);

if (scripts.length === 0) {
  throw new Error('No inline JavaScript was found in index.html');
}

for (const [index, source] of scripts.entries()) {
  new vm.Script(source, { filename: `index.html:inline-script-${index + 1}` });
}

const requiredFeatures = [
  ['canvas game', '<canvas id="game"'],
  ['three touch controls', 'id="leftBtn"', 'id="rightBtn"', 'id="jumpBtn"'],
  ['party create/join controls', 'id="hostBtn"', 'id="joinBtn"'],
  ['host state relay', "if(host)broadcast({type:'state',player:p})"],
  ['co-op portal check', 'const teamReady=[...players.values()].every(atPortal)'],
  ['keyboard blur reset', "window.addEventListener('blur'"],
];

for (const [label, ...needles] of requiredFeatures) {
  for (const needle of needles) {
    if (!html.includes(needle)) {
      throw new Error(`Missing required feature/check: ${label} (${needle})`);
    }
  }
}

const render = fs.readFileSync('render.yaml', 'utf8');
for (const needle of ['runtime: static', 'staticPublishPath: .', 'buildCommand:']) {
  if (!render.includes(needle)) {
    throw new Error(`Render config is missing: ${needle}`);
  }
}

console.log(`Validated ${scripts.length} inline script(s) and core game/deployment markers.`);
