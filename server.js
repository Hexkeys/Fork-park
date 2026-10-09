const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomInt, randomUUID } = require('node:crypto');
const { WebSocket, WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 10000;
const HOST = '0.0.0.0';
const MAX_PARTY_SIZE = 8;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const COLORS = ['#ff5ca8', '#5df4ff', '#c7ff65', '#b18cff', '#ffb45d'];

function publicPlayer(player) {
  return {
    id: player.id,
    name: player.name,
    color: player.color,
    x: player.x,
    y: player.y,
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

function createForkParkServer() {
  const rooms = new Map();
  const indexPath = path.join(__dirname, 'index.html');

  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url || '/', 'http://localhost');
    const pathname = requestUrl.pathname;

    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

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
        response.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache',
        });
        response.end(request.method === 'HEAD' ? undefined : content);
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
    const room = rooms.get(code);
    if (!room || !room.players.has(playerId)) return;

    room.players.delete(playerId);
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

  function addPlayer(socket, room) {
    const index = room.players.size;
    const player = {
      id: randomUUID(),
      name: playerName(index),
      color: COLORS[index % COLORS.length],
      x: Math.min(65 + index * 38, 900),
      y: 410,
      socket,
    };
    room.players.set(player.id, player);
    socket.roomCode = room.code;
    socket.playerId = player.id;
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
      const room = { code, ownerId: null, players: new Map() };
      rooms.set(code, room);
      const player = addPlayer(socket, room);
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

      if (socket.roomCode === code) {
        const room = rooms.get(code);
        if (room) {
          send(socket, {
            type: 'party_joined',
            code,
            playerId: socket.playerId,
            ownerId: room.ownerId,
            players: snapshot(room),
          });
          return;
        }
      }

      leaveParty(socket);
      const room = rooms.get(code);
      if (!room) {
        fail(socket, 'PARTY_NOT_FOUND', 'That party was not found. Check the code and try again.');
        return;
      }
      if (room.players.size >= MAX_PARTY_SIZE) {
        fail(socket, 'PARTY_FULL', 'That party is full. The limit is eight players.');
        return;
      }

      const player = addPlayer(socket, room);
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
      if (now - (socket.lastStateAt || 0) < 33) return;
      socket.lastStateAt = now;
      if (!Number.isFinite(message.x) || !Number.isFinite(message.y)) return;

      player.x = Math.round(Math.max(0, Math.min(930, message.x)));
      player.y = Math.round(Math.max(-100, Math.min(600, message.y)));
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
