import { createServer as createHttpServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = normalize(join(__dirname, '..'));
const CLIENT_ROOT = join(ROOT, 'client');
const PORT = Number(process.env.PORT || 3000);
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS || 8);
const SNAPSHOT_MS = 50;
const ROOM_TTL_MS = 1000 * 60 * 60 * 3;

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.ico': 'image/x-icon'
};

const rooms = new Map();
const sockets = new Map();

export function buildServer() {
  const httpServer = createHttpServer(staticHandler);
  const wss = new WebSocketServer({ server: httpServer });

  wss.on('connection', (ws) => {
    const playerId = makeId('p');
    const meta = { id: playerId, roomCode: null, joinedAt: Date.now() };
    sockets.set(ws, meta);
    send(ws, { type: 'hello', playerId });

    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data); }
      catch { return send(ws, { type: 'error', message: 'Message was not valid JSON.' }); }
      handleClientMessage(ws, meta, msg);
    });

    ws.on('close', () => {
      leaveRoom(ws, meta);
      sockets.delete(ws);
    });
  });

  const snapshotTimer = setInterval(() => {
    for (const room of rooms.values()) {
      broadcast(room, { type: 'snapshot', room: serializeRoom(room) });
      if (room.players.size === 0 && Date.now() - room.updatedAt > ROOM_TTL_MS) rooms.delete(room.code);
    }
  }, SNAPSHOT_MS);
  snapshotTimer.unref?.();

  httpServer.on('close', () => clearInterval(snapshotTimer));
  return { httpServer, wss, rooms };
}

async function staticHandler(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ ok: true, service: 'pixel-critter-dash' }));
      return;
    }
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/') pathname = '/index.html';
    const normalized = normalize(pathname).replace(/^([/\\])+/, '');
    let filePath = join(CLIENT_ROOT, normalized);

    if (!filePath.startsWith(CLIENT_ROOT) || !existsSync(filePath)) {
      filePath = join(CLIENT_ROOT, 'index.html');
    }

    const body = await readFile(filePath);
    res.writeHead(200, {
      'content-type': CONTENT_TYPES[extname(filePath)] || 'application/octet-stream',
      'cache-control': process.env.NODE_ENV === 'production' ? 'public, max-age=120' : 'no-store'
    });
    res.end(body);
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Pixel Critter Dash server error: ' + err.message);
  }
}

function handleClientMessage(ws, meta, msg) {
  if (!msg || typeof msg.type !== 'string') return;

  if (msg.type === 'createRoom') {
    leaveRoom(ws, meta);
    const room = createRoom();
    const player = createPlayer(meta.id, msg.name, msg.animal, true);
    room.players.set(meta.id, player);
    room.hostId = meta.id;
    meta.roomCode = room.code;
    room.updatedAt = Date.now();
    send(ws, { type: 'roomCreated', playerId: meta.id, room: serializeRoom(room) });
    broadcast(room, { type: 'snapshot', room: serializeRoom(room) });
    return;
  }

  if (msg.type === 'joinRoom') {
    const code = cleanRoomCode(msg.roomCode);
    const room = rooms.get(code);
    if (!room) return send(ws, { type: 'error', message: `Room ${code || '(blank)'} was not found.` });
    if (room.players.size >= MAX_PLAYERS && !room.players.has(meta.id)) return send(ws, { type: 'error', message: `Room ${code} is full.` });
    leaveRoom(ws, meta);
    const player = createPlayer(meta.id, msg.name, msg.animal, room.players.size === 0);
    room.players.set(meta.id, player);
    if (!room.hostId) room.hostId = meta.id;
    meta.roomCode = code;
    room.updatedAt = Date.now();
    send(ws, { type: 'roomJoined', playerId: meta.id, room: serializeRoom(room) });
    broadcast(room, { type: 'snapshot', room: serializeRoom(room) });
    return;
  }

  const room = meta.roomCode ? rooms.get(meta.roomCode) : null;
  if (!room) return;

  if (msg.type === 'updatePlayer') {
    const player = room.players.get(meta.id);
    if (!player) return;
    player.name = cleanName(msg.name);
    player.animal = cleanAnimal(msg.animal);
    player.lastSeen = Date.now();
    room.updatedAt = Date.now();
    broadcast(room, { type: 'snapshot', room: serializeRoom(room) });
    return;
  }

  if (msg.type === 'startRace') {
    if (room.hostId !== meta.id) return send(ws, { type: 'error', message: 'Only the host can start the race.' });
    room.state = 'racing';
    room.seed = makeSeed(room.code);
    room.startedAt = Date.now();
    for (const player of room.players.values()) resetPlayerRaceState(player);
    room.updatedAt = Date.now();
    broadcast(room, { type: 'raceStarted', seed: room.seed });
    broadcast(room, { type: 'snapshot', room: serializeRoom(room) });
    return;
  }

  if (msg.type === 'restartRace') {
    if (room.hostId !== meta.id) return send(ws, { type: 'error', message: 'Only the host can restart the race.' });
    room.state = 'lobby';
    room.seed = makeSeed(room.code);
    for (const player of room.players.values()) resetPlayerRaceState(player);
    room.updatedAt = Date.now();
    broadcast(room, { type: 'raceRestarted', seed: room.seed });
    broadcast(room, { type: 'snapshot', room: serializeRoom(room) });
    return;
  }

  if (msg.type === 'playerState') {
    const player = room.players.get(meta.id);
    if (!player || !msg.state || typeof msg.state !== 'object') return;
    const state = msg.state;
    player.lane = clampNumber(state.lane, 0, 2, player.lane);
    player.targetLane = clampNumber(state.targetLane, 0, 2, player.targetLane);
    player.distance = clampNumber(state.distance, 0, 999999, player.distance);
    player.score = clampNumber(state.score, 0, 9999999, player.score);
    player.alive = Boolean(state.alive);
    player.jumpTime = clampNumber(state.jumpTime, 0, 2, 0);
    player.slideTime = clampNumber(state.slideTime, 0, 2, 0);
    player.shield = clampNumber(state.shield, 0, 20, 0);
    player.magnet = clampNumber(state.magnet, 0, 20, 0);
    player.lastSeen = Date.now();
    room.updatedAt = Date.now();
  }
}

function createRoom() {
  let code;
  do { code = makeRoomCode(); } while (rooms.has(code));
  const room = {
    code,
    seed: makeSeed(code),
    state: 'lobby',
    hostId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    startedAt: null,
    players: new Map()
  };
  rooms.set(code, room);
  return room;
}

function leaveRoom(ws, meta) {
  if (!meta.roomCode) return;
  const room = rooms.get(meta.roomCode);
  if (!room) { meta.roomCode = null; return; }
  room.players.delete(meta.id);
  if (room.hostId === meta.id) {
    const nextHost = room.players.keys().next().value;
    room.hostId = nextHost || null;
  }
  room.updatedAt = Date.now();
  if (room.players.size === 0) {
    setTimeout(() => {
      const stale = rooms.get(room.code);
      if (stale && stale.players.size === 0 && Date.now() - stale.updatedAt > 25_000) rooms.delete(room.code);
    }, 30_000).unref?.();
  } else {
    broadcast(room, { type: 'snapshot', room: serializeRoom(room) });
  }
  meta.roomCode = null;
}

function createPlayer(id, name, animal, host = false) {
  return {
    id,
    name: cleanName(name),
    animal: cleanAnimal(animal),
    host,
    lane: 1,
    targetLane: 1,
    distance: 0,
    score: 0,
    alive: true,
    jumpTime: 0,
    slideTime: 0,
    shield: 0,
    magnet: 0,
    joinedAt: Date.now(),
    lastSeen: Date.now()
  };
}

function resetPlayerRaceState(player) {
  player.lane = 1;
  player.targetLane = 1;
  player.distance = 0;
  player.score = 0;
  player.alive = true;
  player.jumpTime = 0;
  player.slideTime = 0;
  player.shield = 0;
  player.magnet = 0;
  player.lastSeen = Date.now();
}

function serializeRoom(room) {
  return {
    code: room.code,
    seed: room.seed,
    state: room.state,
    hostId: room.hostId,
    maxPlayers: MAX_PLAYERS,
    startedAt: room.startedAt,
    players: Array.from(room.players.values()).map((p) => ({
      id: p.id,
      name: p.name,
      animal: p.animal,
      host: p.id === room.hostId,
      lane: p.lane,
      targetLane: p.targetLane,
      distance: p.distance,
      score: p.score,
      alive: p.alive,
      jumpTime: p.jumpTime,
      slideTime: p.slideTime,
      shield: p.shield,
      magnet: p.magnet,
      lastSeen: p.lastSeen
    }))
  };
}

function broadcast(room, payload) {
  const text = JSON.stringify(payload);
  for (const [ws, meta] of sockets.entries()) {
    if (meta.roomCode === room.code && ws.readyState === WebSocket.OPEN) ws.send(text);
  }
}

function send(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

function makeRoomCode() {
  const words = ['PAW', 'MANGO', 'BUNNY', 'KIWI', 'FOX', 'BOBA', 'FROG', 'PANDA', 'COZY'];
  const word = words[Math.floor(Math.random() * words.length)];
  const num = Math.floor(100 + Math.random() * 900);
  return `${word}-${num}`;
}

function makeSeed(code) {
  return `${code}-${Date.now().toString(36)}-${Math.floor(Math.random() * 9999)}`;
}

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function cleanName(value) {
  return String(value || 'Mango Pal').replace(/[^a-zA-Z0-9 _-]/g, '').trim().slice(0, 16) || 'Mango Pal';
}

function cleanAnimal(value) {
  return ['bunny', 'raccoon', 'cat', 'fox', 'panda', 'frog'].includes(value) ? value : 'bunny';
}

function cleanRoomCode(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 12);
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { httpServer } = buildServer();
  httpServer.listen(PORT, () => {
    console.log(`Pixel Critter Dash party server running at http://localhost:${PORT}`);
  });
}
