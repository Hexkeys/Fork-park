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
      try { message = JSON.parse(raw.toString()); } catch { return; }
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

test('web service health, party flow, relayed positions, validation, and party capacity', async () => {
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
    let firstGuest;
    let firstGuestId;
    for (let i = 0; i < MAX_PARTY_SIZE - 1; i += 1) {
      const guest = await connect();
      guests.push(guest);
      const joined = await sendAndWait(
        guest,
        { type: 'join_party', code: created.code },
        (m) => m.type === 'party_joined'
      );
      assert.equal(joined.code, created.code);
      assert.equal(joined.players.length, i + 2);
      if (i === 0) { firstGuest = guest; firstGuestId = joined.playerId; }
    }

    const moveMessage = nextMessage(
      host,
      (m) => m.type === 'player_state' && m.player && m.player.id === firstGuestId && m.player.x === 123
    );
    firstGuest.send(JSON.stringify({ type: 'state', x: 123, y: 234 }));
    const relayed = await moveMessage;
    assert.equal(relayed.player.y, 234);
    assert.equal(relayed.player.id, firstGuestId);

    const overflow = await connect();
    guests.push(overflow);
    const full = await sendAndWait(
      overflow,
      { type: 'join_party', code: created.code },
      (m) => m.type === 'error'
    );
    assert.equal(full.code, 'PARTY_FULL');

    const invalid = await sendAndWait(
      overflow,
      { type: 'join_party', code: 'BAD' },
      (m) => m.type === 'error'
    );
    assert.equal(invalid.code, 'INVALID_CODE');

    const leaveNotice = nextMessage(host, (m) => m.type === 'player_left' && m.id === firstGuestId);
    firstGuest.close();
    const left = await leaveNotice;
    assert.equal(left.players.length, MAX_PARTY_SIZE - 1);
  } finally {
    for (const client of clients) {
      if (client.readyState !== WebSocket.CLOSED) client.terminate();
    }
    await new Promise((resolve) => app.server.close(resolve));
    app.wss.close();
  }
});
