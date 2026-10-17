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
    const created = await sendAndWait(host, { type: 'create_party', name: 'Captain Fork' }, (m) => m.type === 'party_created');
    assert.match(created.code, /^[A-Z2-9]{6}$/);
    assert.equal(created.players.length, 1);
    assert.equal(created.players[0].name, 'Captain Fork');
    assert.equal(created.ownerId, created.playerId);

    const guests = [];
    let firstGuest;
    let firstGuestId;
    for (let i = 0; i < MAX_PARTY_SIZE - 1; i += 1) {
      const guest = await connect();
      guests.push(guest);
      const joined = await sendAndWait(
        guest,
        { type: 'join_party', code: created.code, name: i === 0 ? 'Quantum Buddy' : 'Guest ' + i },
        (m) => m.type === 'party_joined'
      );
      assert.equal(joined.code, created.code);
      assert.equal(joined.players.length, i + 2);
      assert.equal(joined.players.find((p) => p.id === joined.playerId).name, i === 0 ? 'Quantum Buddy' : 'Guest ' + i);
      if (i === 0) { firstGuest = guest; firstGuestId = joined.playerId; }
    }

    const moveMessage = nextMessage(
      host,
      (m) => m.type === 'player_state' && m.player && m.player.id === firstGuestId && m.player.x === 1234.5
    );
    firstGuest.send(JSON.stringify({ type: 'state', x: 1234.5, y: 234.25, vx: 4.5, vy: -2.25 }));
    const relayed = await moveMessage;
    assert.equal(relayed.player.x, 1234.5);
    assert.equal(relayed.player.y, 234.25);
    assert.equal(relayed.player.vx, 4.5);
    assert.equal(relayed.player.vy, -2.25);
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

    const nonLeaderStart = await sendAndWait(
      firstGuest,
      { type: 'start_party' },
      (m) => m.type === 'error'
    );
    assert.equal(nonLeaderStart.code, 'NOT_PARTY_LEADER');

    const leaveNotice = nextMessage(host, (m) => m.type === 'player_left' && m.id === firstGuestId);
    firstGuest.close();
    const left = await leaveNotice;
    assert.equal(left.players.length, MAX_PARTY_SIZE - 1);

    const hostLaunch = nextMessage(host, (m) => m.type === 'party_started');
    const guestLaunch = nextMessage(guests[1], (m) => m.type === 'party_started');
    host.send(JSON.stringify({ type: 'start_party' }));
    const [hostStarted, guestStarted] = await Promise.all([hostLaunch, guestLaunch]);
    assert.equal(hostStarted.code, created.code);
    assert.equal(guestStarted.code, created.code);
    assert.equal(hostStarted.level, 0);
    assert.equal(hostStarted.seed, 0);

    const nonLeaderLevel = await sendAndWait(guests[1], { type: 'set_level', level: 6, seed: 123456 }, (m) => m.type === 'error');
    assert.equal(nonLeaderLevel.code, 'NOT_PARTY_LEADER');
    const hostLevelChange = nextMessage(host, (m) => m.type === 'level_changed');
    const guestLevelChange = nextMessage(guests[1], (m) => m.type === 'level_changed');
    host.send(JSON.stringify({ type: 'set_level', level: 6, seed: 123456 }));
    const [hostLevel, guestLevel] = await Promise.all([hostLevelChange, guestLevelChange]);
    assert.equal(hostLevel.level, 6);
    assert.equal(guestLevel.level, 6);
    assert.equal(hostLevel.seed, 123456);
    assert.equal(guestLevel.seed, 123456);

    const badLevel = await sendAndWait(host, { type: 'set_level', level: 99, seed: 1 }, (m) => m.type === 'error');
    assert.equal(badLevel.code, 'INVALID_LEVEL');

    const hostPuzzle = nextMessage(host, (m) => m.type === 'puzzle_action');
    const guestPuzzle = nextMessage(guests[1], (m) => m.type === 'puzzle_action');
    host.send(JSON.stringify({ type: 'puzzle_action' }));
    const [hostActivated, guestActivated] = await Promise.all([hostPuzzle, guestPuzzle]);
    assert.equal(hostActivated.code, created.code);
    assert.equal(guestActivated.playerId, created.players[0].id);

    const hostPortal = nextMessage(host, (m) => m.type === 'portal_progress');
    const guestPortal = nextMessage(guests[1], (m) => m.type === 'portal_progress');
    host.send(JSON.stringify({ type: 'portal_entered' }));
    const [hostProgress, guestProgress] = await Promise.all([hostPortal, guestPortal]);
    assert.ok(hostProgress.readyPlayerIds.includes(created.players[0].id));
    assert.deepEqual(hostProgress.readyPlayerIds, guestProgress.readyPlayerIds);

    const hostWipe = nextMessage(host, (m) => m.type === 'party_wiped');
    const guestWipe = nextMessage(guests[1], (m) => m.type === 'party_wiped');
    host.send(JSON.stringify({ type: 'party_wipe', reason: 'test reset' }));
    const [hostReset, guestReset] = await Promise.all([hostWipe, guestWipe]);
    assert.equal(hostReset.players.length, MAX_PARTY_SIZE - 1);
    assert.deepEqual(hostReset.players.map(p => p.x), [65,77,89,101,113,125,137]);
    assert.deepEqual(hostReset.players.map(p => p.x), guestReset.players.map(p => p.x));
  } finally {
    for (const client of clients) {
      if (client.readyState !== WebSocket.CLOSED) client.terminate();
    }
    await new Promise((resolve) => app.server.close(resolve));
    app.wss.close();
  }
});
