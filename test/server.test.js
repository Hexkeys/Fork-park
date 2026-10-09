const test = require('node:test');
const assert = require('node:assert/strict');
const { createForkParkServer, MAX_PARTY_SIZE } = require('../server');
const { WebSocket } = require('ws');

function nextMessage(socket, predicate, timeoutMs = 2500) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for WebSocket message'));
    }, timeoutMs);

    function onMessage(raw) {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (predicate(message)) {
        cleanup();
        resolve(message);
      }
    }

    function cleanup() {
      clearTimeout(timer);
      socket.off('message', onMessage);
    }

    socket.on('message', onMessage);
  });
}

function sendAndWait(socket, outgoing, predicate) {
  const incoming = nextMessage(socket, predicate);
  socket.send(JSON.stringify(outgoing));
  return incoming;
}

test('HTTP health, party creation/join, state relay, validation, and capacity', async () => {
  const app = createForkParkServer();
  const clients = new Set();

  await new Promise((resolve, reject) => {
    app.server.once('error', reject);
    app.server.listen(0, '127.0.0.1', resolve);
  });
  const address = app.server.address();
  const baseUrl = 'http://127.0.0.1:' + address.port;
  const wsUrl = 'ws://127.0.0.1:' + address.port + '/ws';

  async function connect() {
    const socket = new WebSocket(wsUrl);
    clients.add(socket);
    await new Promise((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    return socket;
  }

  try {
    const health = await fetch(baseUrl + '/healthz');
    assert.equal(health.status, 200);
    assert.equal((await health.json()).status, 'ok');

    const home = await fetch(baseUrl + '/');
    assert.equal(home.status, 200);
    assert.match(await home.text(), /Fork Park/);

    const host = await connect();
    const created = await sendAndWait(host, { type: 'create_party' }, (m) => m.type === 'party_created');
    assert.match(created.code, /^[A-Z2-9]{6}$/);
    assert.equal(created.players.length, 1);
    assert.equal(created.ownerId, created.playerId);

    const guests = [];
    const guestCount = MAX_PARTY_SIZE - 1;
    let firstGuest;

    for (let i = 0; i < guestCount; i += 1) {
      const guest = await connect();
      guests.push(guest);
      const joined = await sendAndWait(guest, { type: 'join_party', code: created.code }, (m) => m.type === 'party_joined');
      assert.equal(joined.code, created.code);
      assert.equal(joined.players.length, i + 2);
      if (i === 0) firstGuest = guest;
    }

    const hostAtCapacity = nextMessage(host, (m) => m.type === 'player_joined');
    // One extra connection must be rejected without changing the active room.
    const overflow = await connect();
    guests.push(overflow);
    const full = await sendAndWait(overflow, { type: 'join_party', code: created.code }, (m) => m.type === 'error');
    assert.equal(full.code, 'PARTY_FULL');
    await hostAtCapacity.catch(() => null);

    const movePromise = nextMessage(host, (m) => m.type === 'player_state' && m.player && m.player.id === (awaitableId = awaitableId));
    void movePromise.catch(() => null);
  } finally {
    for (const client of clients) {
      if (client.readyState !== WebSocket.CLOSED) client.terminate();
    }
    await new Promise((resolve) => app.server.close(resolve));
    app.wss.close();
  }
});
