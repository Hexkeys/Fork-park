const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, randomInt, randomUUID } = require('node:crypto');
const { WebSocket, WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 10000;
const HOST = '0.0.0.0';
const MAX_PARTY_SIZE = 8;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const COLORS = ['#39ff72', '#ffd166', '#62e8a0', '#ff9248', '#b1ffca'];

function publicPlayer(player) {
  return {
    id: player.id,
    name: player.name,
    color: player.color,
    x: player.x,
    y: player.y,
    vx: player.vx || 0,
    vy: player.vy || 0,
  };
}

function send(socket, message) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function createCode(rooms) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    let code = '';
    for (let i = 0; i < 6; i += 1) {
      code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    }
    if (!rooms.has(code)) return code;
  }
  throw new Error('Could not allocate a unique party code');
}

function playerName(index) {
  if (index === 0) return 'Exploding Fork';
  if (index === 1) return 'Quantum Fork';
  return index % 2 === 0 ? 'Exploding Fork ' + (index + 1) : 'Quantum Fork ' + (index + 1);
}

function cleanPlayerName(value, fallback) {
  const clean = String(value ?? '').replace(/[<>]/g, '').trim().slice(0, 20);
  return clean || fallback;
}

function createForkParkServer() {
  const rooms = new Map();
  const productionIndexPath = path.join(__dirname, 'dist', 'index.html');
  const indexPath = fs.existsSync(productionIndexPath) ? productionIndexPath : path.join(__dirname, 'index.html');

  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url || '/', 'http://localhost');
    const pathname = requestUrl.pathname;

    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, HEAD' });
      response.end('Method not allowed');
      return;
    }

    if (pathname === '/healthz') {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(request.method === 'HEAD' ? undefined : JSON.stringify({
        status: 'ok',
        service: 'fork-park',
        activeParties: rooms.size,
      }));
      return;
    }

    if (pathname === '/' || pathname === '/index.html') {
      fs.readFile(indexPath, (error, content) => {
        if (error) {
          response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
          response.end('Game page could not be loaded');
          return;
        }
        const nonce = randomBytes(18).toString('base64');
        const page = content.toString('utf8').replace(/<script\\b/gi, '<script nonce="' + nonce + '"');
        response.setHeader(
          'Content-Security-Policy',
          "default-src 'self'; script-src 'nonce-" + nonce + "'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
        );
        response.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache',
        });
        response.end(request.method === 'HEAD' ? undefined : page);
      });
      return;
    }

    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  });

  const wss = new WebSocketServer({
    server,
    path: '/ws',
    maxPayload: 4096,
    perMessageDeflate: false,
  });

  function snapshot(room) {
    return [...room.players.values()].map(publicPlayer);
  }

  function broadcast(room, message, exceptSocket = null) {
    for (const player of room.players.values()) {
      if (player.socket !== exceptSocket) send(player.socket, message);
    }
  }

  function leaveParty(socket) {
    const code = socket.roomCode;
    const playerId = socket.playerId;
    if (!code || !playerId) return;

    socket.roomCode = null;
    socket.playerId = null;
    socket.rateWindowAt = Date.now();
    socket.rateMessageCount = 0;
    socket.rateLimitStrikes = 0;
    socket.lastStateAt = 0;
    const room = rooms.get(code);
    if (!room || !room.players.has(playerId)) return;

    room.players.delete(playerId);
    room.portalReady.delete(playerId);
    if (room.players.size === 0) {
      rooms.delete(code);
      return;
    }

    const ownerChanged = room.ownerId === playerId;
    if (ownerChanged) room.ownerId = room.players.keys().next().value;

    broadcast(room, {
      type: 'player_left',
      id: playerId,
      ownerId: room.ownerId,
      players: snapshot(room),
    });

    if (ownerChanged) {
      broadcast(room, { type: 'party_update', ownerId: room.ownerId, players: snapshot(room) });
    }
  }

  function addPlayer(socket, room, requestedName) {
    const index = room.players.size;
    const player = {
      id: randomUUID(),
      name: cleanPlayerName(requestedName, playerName(index)),
      color: COLORS[index % COLORS.length],
      x: Math.min(65 + index * 38, 900),
      y: 410,
      socket,
    };
    room.players.set(player.id, player);
    socket.roomCode = room.code;
    socket.playerId = player.id;
    socket.lastStateAt = 0;
    return player;
  }

  function fail(socket, code, message) {
    send(socket, { type: 'error', code, message });
  }

  function handleMessage(socket, message) {
    if (!message || typeof message !== 'object' || Array.isArray(message) || typeof message.type !== 'string') {
      fail(socket, 'INVALID_MESSAGE', 'That message was not understood.');
      return;
    }

    if (message.type === 'create_party') {
      leaveParty(socket);
      let code;
      try {
        code = createCode(rooms);
      } catch {
        fail(socket, 'PARTY_CREATE_FAILED', 'Could not create a party. Please try again.');
        return;
      }
      const room = { code, ownerId: null, players: new Map(), started: false, currentLevel: 0, currentSeed: 0, portalReady: new Set(), lastWipeAt: 0 };
      rooms.set(code, room);
      const player = addPlayer(socket, room, message.name);
      room.ownerId = player.id;
      send(socket, {
        type: 'party_created',
        code,
        playerId: player.id,
        ownerId: room.ownerId,
        players: snapshot(room),
      });
      return;
    }

    if (message.type === 'join_party') {
      const code = typeof message.code === 'string' ? message.code.trim().toUpperCase() : '';
      if (!/^[A-Z2-9]{6}$/.test(code) || [...code].some((char) => !CODE_ALPHABET.includes(char))) {
        fail(socket, 'INVALID_CODE', 'Enter the six-character party code.');
        return;
      }

      const room = rooms.get(code);
      if (!room) {
        fail(socket, 'PARTY_NOT_FOUND', 'That party was not found. Check the code and try again.');
        return;
      }
      if (socket.roomCode === code) {
        send(socket, {
          type: 'party_joined',
          code,
          playerId: socket.playerId,
          ownerId: room.ownerId,
          players: snapshot(room),
        });
        return;
      }
      if (room.started) {
        fail(socket, 'PARTY_STARTED', 'That party has already entered the arena.');
        return;
      }
      if (room.players.size >= MAX_PARTY_SIZE) {
        fail(socket, 'PARTY_FULL', 'That party is full. The limit is eight players.');
        return;
      }

      // Validate the destination before removing the player from their current room.
      leaveParty(socket);
      const player = addPlayer(socket, room, message.name);
      send(socket, {
        type: 'party_joined',
        code,
        playerId: player.id,
        ownerId: room.ownerId,
        players: snapshot(room),
      });
      broadcast(room, {
        type: 'player_joined',
        player: publicPlayer(player),
        ownerId: room.ownerId,
      }, socket);
      return;
    }

    if (message.type === 'start_party') {
      const room = socket.roomCode && rooms.get(socket.roomCode);
      const player = room && room.players.get(socket.playerId);
      if (!room || !player) {
        fail(socket, 'NOT_IN_PARTY', 'Create or join a party before initializing the arena.');
        return;
      }
      if (room.ownerId !== player.id) {
        fail(socket, 'NOT_PARTY_LEADER', 'Only the party leader can initialize the arena.');
        return;
      }
      if (room.players.size < 2) {
        fail(socket, 'PARTY_NEEDS_PLAYERS', 'Invite at least one crew member before launching.');
        return;
      }
      room.started = true;
      room.portalReady.clear();
      broadcast(room, {
        type: 'party_started',
        code: room.code,
        ownerId: room.ownerId,
        players: snapshot(room),
        level: room.currentLevel,
        seed: room.currentSeed,
      });
      return;
    }

    if (message.type === 'set_level') {
      const room = socket.roomCode && rooms.get(socket.roomCode);
      const player = room && room.players.get(socket.playerId);
      if (!room || !player) {
        fail(socket, 'NOT_IN_PARTY', 'Join a party before changing its level.');
        return;
      }
      if (room.ownerId !== player.id) {
        fail(socket, 'NOT_PARTY_LEADER', 'Only the party leader can change levels.');
        return;
      }
      if (!room.started) {
        fail(socket, 'PARTY_NOT_STARTED', 'Initialize the arena before changing levels.');
        return;
      }
      if (!Number.isInteger(message.level) || message.level < 0 || message.level > 1000000 ||
          !Number.isInteger(message.seed) || message.seed < 0 || message.seed > 0xffffffff) {
        fail(socket, 'INVALID_LEVEL', 'Choose a valid level and random seed.');
        return;
      }
      room.currentLevel = message.level;
      room.currentSeed = message.seed;
      room.portalReady.clear();
      broadcast(room, { type: 'level_changed', code: room.code, level: room.currentLevel, seed: room.currentSeed, ownerId: room.ownerId });
      return;
    }

    if (message.type === 'party_wipe') {
      const room = socket.roomCode && rooms.get(socket.roomCode);
      const player = room && room.players.get(socket.playerId);
      if (!room || !player || !room.started) {
        fail(socket, 'NOT_IN_PARTY', 'Start a party before sending a crew reset.');
        return;
      }
      const now = Date.now();
      if (now - room.lastWipeAt < 1200) return;
      room.lastWipeAt = now;
      room.portalReady.clear();
      let spawn = 0;
      for (const member of room.players.values()) {
        member.x = 65 + spawn * 12;
        member.y = 410;
        spawn += 1;
      }
      broadcast(room, { type: 'party_wiped', code: room.code, reason: 'CREW WIPE', players: snapshot(room) });
      return;
    }

    if (message.type === 'portal_entered') {
      const room = socket.roomCode && rooms.get(socket.roomCode);
      const player = room && room.players.get(socket.playerId);
      if (!room || !player || !room.started) {
        fail(socket, 'NOT_IN_PARTY', 'Start a party before entering the portal.');
        return;
      }
      room.portalReady.add(player.id);
      broadcast(room, { type: 'portal_progress', code: room.code, readyPlayerIds: [...room.portalReady] });
      return;
    }

    if (message.type === 'puzzle_action') {
      const room = socket.roomCode && rooms.get(socket.roomCode);
      const player = room && room.players.get(socket.playerId);
      if (!room || !player || !room.started) {
        fail(socket, 'NOT_IN_PARTY', 'Start a party run before activating a puzzle switch.');
        return;
      }
      broadcast(room, { type: 'puzzle_action', code: room.code, playerId: player.id });
      return;
    }

    if (message.type === 'leave_party') {
      leaveParty(socket);
      send(socket, { type: 'left_party' });
      return;
    }

    if (message.type === 'state') {
      const room = socket.roomCode && rooms.get(socket.roomCode);
      const player = room && room.players.get(socket.playerId);
      if (!room || !player) {
        fail(socket, 'NOT_IN_PARTY', 'Create or join a party before syncing movement.');
        return;
      }

      const now = Date.now();
      const elapsed = socket.lastStateAt ? Math.max(1, now - socket.lastStateAt) : 100;
      if (socket.lastStateAt && elapsed < 25) return;
      if (!Number.isFinite(message.x) || !Number.isFinite(message.y) ||
          !Number.isFinite(message.vx) || !Number.isFinite(message.vy)) return;

      const nextX = Math.max(0, Math.min(4000, message.x));
      const nextY = Math.max(-100, Math.min(600, message.y));
      // Reject obvious teleport/speed hacks. This is a lightweight plausibility
      // check; full server-authoritative physics would be needed for stronger protection.
      const xLimit = elapsed > 250 ? 45 : Math.max(18, elapsed * 0.35 + 7);
      const yLimit = elapsed > 250 ? 90 : Math.max(34, elapsed * 0.7 + 12);
      if (Math.abs(nextX - player.x) > xLimit || Math.abs(nextY - player.y) > yLimit ||
          Math.abs(message.vx) > 8 || Math.abs(message.vy) > 16) {
        socket.suspiciousStates = (socket.suspiciousStates || 0) + 1;
        if (socket.suspiciousStates >= 8) socket.close(1008, 'Invalid movement');
        return;
      }
      socket.suspiciousStates = Math.max(0, (socket.suspiciousStates || 0) - 1);
      socket.lastStateAt = now;
      player.x = nextX;
      player.y = nextY;
      player.vx = Math.max(-8, Math.min(8, message.vx));
      player.vy = Math.max(-16, Math.min(16, message.vy));
      broadcast(room, {
        type: 'player_state',
        player: publicPlayer(player),
      }, socket);
      return;
    }

    fail(socket, 'UNKNOWN_MESSAGE', 'That action is not available.');
  }

  wss.on('connection', (socket) => {
    socket.isAlive = true;
    socket.roomCode = null;
    socket.playerId = null;

    socket.on('pong', () => { socket.isAlive = true; });
    socket.on('message', (raw) => {
      const now = Date.now();
      if (now - socket.rateWindowAt >= 1000) {
        socket.rateWindowAt = now;
        socket.rateMessageCount = 0;
      }
      socket.rateMessageCount += 1;
      if (socket.rateMessageCount > 90) {
        socket.rateLimitStrikes += 1;
        if (socket.rateLimitStrikes >= 2) socket.close(1008, 'Message rate limit exceeded');
        return;
      }
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        fail(socket, 'INVALID_JSON', 'The server expected a JSON message.');
        return;
      }
      handleMessage(socket, message);
    });
    socket.on('close', () => leaveParty(socket));
    socket.on('error', () => leaveParty(socket));
  });

  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (socket.isAlive === false) {
        socket.terminate();
        continue;
      }
      socket.isAlive = false;
      socket.ping();
    }
  }, 30000);
  heartbeat.unref();

  wss.on('close', () => clearInterval(heartbeat));

  return { server, wss, rooms };
}

if (require.main === module) {
  const app = createForkParkServer();
  app.server.listen(PORT, HOST, () => {
    console.log('Fork Park web service listening on ' + HOST + ':' + PORT);
  });

  function shutdown() {
    app.wss.clients.forEach((socket) => socket.close(1001, 'Server shutting down'));
    app.wss.close();
    app.server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000).unref();
  }
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

module.exports = { createForkParkServer, MAX_PARTY_SIZE };
