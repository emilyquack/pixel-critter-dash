/* global createCanvas, resizeCanvas, windowWidth, windowHeight, pixelDensity, frameRate, noSmooth, background, width, height, fill, stroke, strokeWeight, noStroke, rect, ellipse, triangle, quad, text, textSize, textAlign, CENTER, LEFT, RIGHT, line, push, pop, translate, scale, image, createGraphics, color, lerpColor, map, constrain, floor, millis */

const ROOM_PARAM = new URLSearchParams(window.location.search).get('room') || '';
const SERVER_PARAM = new URLSearchParams(window.location.search).get('server') || '';
const MAX_REMOTE_AGE_MS = 1800;
const SEND_EVERY_MS = 80;
const LANE_COUNT = 3;
const PLAYER_Y_RATIO = 0.76;

const ANIMALS = {
  bunny: { label: 'Bunny', body: '#fff3f7', belly: '#ffd1df', ear: '#ff9fbd', accent: '#7ed7ff' },
  raccoon: { label: 'Raccoon', body: '#8a879a', belly: '#d8d5dc', ear: '#5b5868', accent: '#ffd36b' },
  cat: { label: 'Cat', body: '#ffd68c', belly: '#fff2c0', ear: '#ff9f8f', accent: '#9ee8b3' },
  fox: { label: 'Fox', body: '#ff9a4f', belly: '#ffe5bd', ear: '#d94f38', accent: '#88d8ff' },
  panda: { label: 'Panda', body: '#f7f5ea', belly: '#ffffff', ear: '#333047', accent: '#ff9cc7' },
  frog: { label: 'Frog', body: '#83d85a', belly: '#d8ff95', ear: '#58ae45', accent: '#ffd66e' }
};

const OBSTACLES = {
  picnic: { label: 'picnic basket', action: 'jump', color: '#d8895b' },
  boba: { label: 'rolling boba pearl', action: 'slide', color: '#5a3e54' },
  turtle: { label: 'sleepy turtle', action: 'jump', color: '#66ad64' },
  puddle: { label: 'sparkle puddle', action: 'jump', color: '#78c7ff' },
  crate: { label: 'fruit crate', action: 'avoid', color: '#c9824a' },
  mushroom: { label: 'bouncy mushroom', action: 'avoid', color: '#ff7e91' }
};

let ui = {};
let socket = null;
let connected = false;
let reconnectTimer = null;
let meId = null;
let hostId = null;
let roomCode = ROOM_PARAM.toUpperCase();
let roomSeed = 'SOLO-MANGO';
let roomState = 'menu';
let lobbyPlayers = new Map();
let lastSnapshotAt = 0;
let lastSendAt = 0;
let track = [];
let fruits = [];
let collectedFruit = new Set();
let hitCooldown = 0;
let inviteWasCopied = false;

let local = makeDefaultPlayer('local', 'Mango Pal', 'bunny');
let input = { left: false, right: false, up: false, down: false, leftTap: false, rightTap: false, jumpTap: false, slideTap: false };
let touchStart = null;
let bgLayer;

function makeDefaultPlayer(id, name, animal) {
  return {
    id,
    name: cleanName(name),
    animal: ANIMALS[animal] ? animal : 'bunny',
    lane: 1,
    targetLane: 1,
    distance: 0,
    score: 0,
    alive: true,
    finished: false,
    jumpTime: 0,
    slideTime: 0,
    laneCooldown: 0,
    wobble: 0,
    shield: 0,
    magnet: 0,
    lastSeen: Date.now()
  };
}

function setup() {
  createCanvas(windowWidth, windowHeight);
  pixelDensity(1);
  frameRate(60);
  noSmooth();
  bgLayer = createGraphics(width, height);
  buildBackground();
  bindUI();
  resetRace(roomSeed);
  connectToServer();
}

function draw() {
  const dt = Math.min(0.033, Math.max(0.001, (millis() - (draw._last || millis())) / 1000));
  draw._last = millis();

  updateGame(dt);
  renderGame();
  maybeSendState();
  clearTapInputs();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  bgLayer = createGraphics(width, height);
  buildBackground();
}

function bindUI() {
  ui.lobby = document.getElementById('lobby');
  ui.connectionLabel = document.getElementById('connectionLabel');
  ui.scoreboard = document.getElementById('scoreboard');
  ui.playerName = document.getElementById('playerName');
  ui.animalSelect = document.getElementById('animalSelect');
  ui.roomCode = document.getElementById('roomCode');
  ui.serverUrl = document.getElementById('serverUrl');
  ui.createRoomBtn = document.getElementById('createRoomBtn');
  ui.joinRoomBtn = document.getElementById('joinRoomBtn');
  ui.soloBtn = document.getElementById('soloBtn');
  ui.startRaceBtn = document.getElementById('startRaceBtn');
  ui.restartRaceBtn = document.getElementById('restartRaceBtn');
  ui.roomInfo = document.getElementById('roomInfo');
  ui.roomCodeLabel = document.getElementById('roomCodeLabel');
  ui.copyInviteBtn = document.getElementById('copyInviteBtn');
  ui.lobbyPlayers = document.getElementById('lobbyPlayers');
  ui.hostTools = document.getElementById('hostTools');

  ui.serverUrl.value = SERVER_PARAM || defaultServerUrl();
  ui.roomCode.value = roomCode;

  ui.createRoomBtn.addEventListener('click', () => {
    ensureConnection();
    local.name = cleanName(ui.playerName.value);
    local.animal = ui.animalSelect.value;
    send({ type: 'createRoom', name: local.name, animal: local.animal });
  });
  ui.joinRoomBtn.addEventListener('click', () => {
    ensureConnection();
    local.name = cleanName(ui.playerName.value);
    local.animal = ui.animalSelect.value;
    const code = cleanRoomCode(ui.roomCode.value || roomCode);
    if (!code) return toast('Type a room code first 🐾');
    send({ type: 'joinRoom', roomCode: code, name: local.name, animal: local.animal });
  });
  ui.soloBtn.addEventListener('click', () => {
    roomCode = 'SOLO';
    meId = meId || 'solo-' + Math.floor(Math.random() * 9999);
    local.id = meId;
    local.name = cleanName(ui.playerName.value);
    local.animal = ui.animalSelect.value;
    roomState = 'racing';
    hostId = meId;
    resetRace('SOLO-' + Date.now());
    updateLobbyUI();
    toast('Solo practice started — dodge the fruit festival chaos!');
  });
  ui.startRaceBtn.addEventListener('click', () => send({ type: 'startRace' }));
  ui.restartRaceBtn.addEventListener('click', () => send({ type: 'restartRace' }));
  ui.copyInviteBtn.addEventListener('click', copyInviteLink);
  ui.animalSelect.addEventListener('change', () => {
    local.animal = ui.animalSelect.value;
    send({ type: 'updatePlayer', name: cleanName(ui.playerName.value), animal: local.animal });
  });
  ui.playerName.addEventListener('change', () => {
    local.name = cleanName(ui.playerName.value);
    send({ type: 'updatePlayer', name: local.name, animal: local.animal });
  });
  ui.serverUrl.addEventListener('change', () => reconnectNow());

  if (roomCode) setTimeout(() => {
    if (roomCode && connected) ui.joinRoomBtn.click();
  }, 500);

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('touchstart', onTouchStart, { passive: true });
  window.addEventListener('touchend', onTouchEnd, { passive: true });
  updateLobbyUI();
}

function defaultServerUrl() {
  if (SERVER_PARAM) return SERVER_PARAM;
  if (location.protocol === 'http:' || location.protocol === 'https:') {
    const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${wsProtocol}//${location.host}`;
  }
  return 'ws://localhost:3000';
}

function connectToServer() {
  const url = ui.serverUrl?.value || defaultServerUrl();
  try {
    if (socket && socket.readyState <= 1) socket.close();
    socket = new WebSocket(url);
    ui.connectionLabel.textContent = 'Connecting to ' + url;
  } catch (err) {
    connected = false;
    ui.connectionLabel.textContent = 'Server URL needs a valid ws:// or wss:// address';
    return;
  }

  socket.addEventListener('open', () => {
    connected = true;
    ui.connectionLabel.textContent = 'Connected — ready for room codes';
    if (roomCode && roomCode !== 'SOLO') {
      send({ type: 'joinRoom', roomCode, name: cleanName(ui.playerName.value), animal: ui.animalSelect.value });
    }
  });
  socket.addEventListener('message', (event) => {
    try { handleMessage(JSON.parse(event.data)); }
    catch (err) { console.warn('Bad server message', err); }
  });
  socket.addEventListener('close', () => {
    connected = false;
    ui.connectionLabel.textContent = 'Disconnected — solo still works, room play needs server';
    scheduleReconnect();
  });
  socket.addEventListener('error', () => {
    connected = false;
    ui.connectionLabel.textContent = 'Could not reach party server';
  });
}

function reconnectNow() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  connectToServer();
}

function ensureConnection() {
  if (!socket || socket.readyState > 1) connectToServer();
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectToServer();
  }, 2500);
}

function send(payload) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(payload));
  return true;
}

function handleMessage(msg) {
  if (msg.type === 'hello') {
    meId = msg.playerId;
    local.id = meId;
  }
  if (msg.type === 'roomJoined' || msg.type === 'roomCreated') {
    meId = msg.playerId || meId;
    local.id = meId;
    roomCode = msg.room.code;
    roomSeed = msg.room.seed;
    roomState = msg.room.state;
    hostId = msg.room.hostId;
    syncPlayers(msg.room.players || []);
    resetRace(roomSeed);
    updateLobbyUI();
    toast(msg.type === 'roomCreated' ? `Room ${roomCode} created!` : `Joined room ${roomCode}!`);
  }
  if (msg.type === 'snapshot') {
    lastSnapshotAt = Date.now();
    roomCode = msg.room.code;
    roomSeed = msg.room.seed;
    roomState = msg.room.state;
    hostId = msg.room.hostId;
    syncPlayers(msg.room.players || []);
    updateLobbyUI();
  }
  if (msg.type === 'raceStarted') {
    roomSeed = msg.seed;
    roomState = 'racing';
    resetRace(roomSeed);
    updateLobbyUI();
    toast('Race started! 🌈');
  }
  if (msg.type === 'raceRestarted') {
    roomSeed = msg.seed;
    roomState = 'lobby';
    resetRace(roomSeed);
    updateLobbyUI();
    toast('Race reset — host can start again.');
  }
  if (msg.type === 'error') toast(msg.message || 'Something went wobbly.');
}

function syncPlayers(players) {
  const now = Date.now();
  const seen = new Set();
  for (const p of players) {
    seen.add(p.id);
    if (p.id === meId) {
      local.name = p.name || local.name;
      local.animal = p.animal || local.animal;
      if (roomState !== 'racing') {
        local.score = p.score || 0;
        local.distance = p.distance || 0;
      }
      continue;
    }
    const existing = lobbyPlayers.get(p.id) || makeDefaultPlayer(p.id, p.name, p.animal);
    Object.assign(existing, p, { lastSeen: now, targetLane: p.lane ?? existing.targetLane ?? 1 });
    lobbyPlayers.set(p.id, existing);
  }
  for (const id of Array.from(lobbyPlayers.keys())) {
    const p = lobbyPlayers.get(id);
    if (!seen.has(id) && now - p.lastSeen > MAX_REMOTE_AGE_MS) lobbyPlayers.delete(id);
  }
}

function resetRace(seed) {
  roomSeed = String(seed || 'MANGO-SEED');
  local.distance = 0;
  local.score = 0;
  local.alive = true;
  local.finished = false;
  local.lane = 1;
  local.targetLane = 1;
  local.jumpTime = 0;
  local.slideTime = 0;
  local.laneCooldown = 0;
  local.shield = 0;
  local.magnet = 0;
  collectedFruit.clear();
  hitCooldown = 0;
  buildTrack(roomSeed);
}

function buildTrack(seed) {
  const rand = mulberry32(hashSeed(seed));
  const obstacleTypes = Object.keys(OBSTACLES);
  track = [];
  fruits = [];
  let d = 320;
  for (let i = 0; i < 260; i++) {
    const lane = Math.floor(rand() * LANE_COUNT);
    const type = obstacleTypes[Math.floor(rand() * obstacleTypes.length)];
    track.push({ id: 'o' + i, distance: d, lane, type });
    const fruitLane = Math.floor(rand() * LANE_COUNT);
    fruits.push({ id: 'f' + i, distance: d + 120 + rand() * 90, lane: fruitLane, kind: rand() > 0.82 ? 'mango' : 'berry' });
    d += 245 + rand() * 175;
  }
}

function updateGame(dt) {
  if (roomState !== 'racing') return;
  if (!local.alive) {
    local.wobble += dt * 5;
    return;
  }

  const speed = 310 + Math.min(360, local.distance * 0.018);
  local.distance += speed * dt;
  local.score = Math.floor(local.distance / 6) + collectedFruit.size * 25;
  local.laneCooldown = Math.max(0, local.laneCooldown - dt);
  local.jumpTime = Math.max(0, local.jumpTime - dt);
  local.slideTime = Math.max(0, local.slideTime - dt);
  local.shield = Math.max(0, local.shield - dt);
  local.magnet = Math.max(0, local.magnet - dt);
  hitCooldown = Math.max(0, hitCooldown - dt);

  if ((input.leftTap || input.left) && local.laneCooldown <= 0) moveLane(-1);
  if ((input.rightTap || input.right) && local.laneCooldown <= 0) moveLane(1);
  if ((input.jumpTap || input.up) && local.jumpTime <= 0.02 && local.slideTime <= 0) local.jumpTime = 0.62;
  if ((input.slideTap || input.down) && local.jumpTime <= 0.02) local.slideTime = 0.46;

  local.lane += (local.targetLane - local.lane) * Math.min(1, dt * 13);
  local.wobble += dt * (local.slideTime > 0 ? 18 : 10);

  checkPickups();
  checkCollisions();
}

function moveLane(delta) {
  local.targetLane = constrain(local.targetLane + delta, 0, LANE_COUNT - 1);
  local.laneCooldown = 0.13;
}

function checkPickups() {
  for (const fruit of fruits) {
    if (collectedFruit.has(fruit.id)) continue;
    const z = fruit.distance - local.distance;
    const laneNear = Math.abs(fruit.lane - local.lane) < (local.magnet > 0 ? 1.45 : 0.36);
    if (z < 46 && z > -42 && laneNear) {
      collectedFruit.add(fruit.id);
      local.score += fruit.kind === 'mango' ? 80 : 25;
      if (fruit.kind === 'mango') {
        local.shield = Math.max(local.shield, 5);
        toast('Mango shield! One bonk is safe ✨', 1200);
      } else if (collectedFruit.size % 8 === 0) {
        local.magnet = 4;
        toast('Fruit magnet! 🍓', 900);
      }
    }
  }
}

function checkCollisions() {
  if (hitCooldown > 0) return;
  for (const obs of track) {
    const z = obs.distance - local.distance;
    if (z < -48) continue;
    if (z > 50) break;
    if (Math.abs(obs.lane - local.lane) > 0.36) continue;
    const action = OBSTACLES[obs.type].action;
    const safe = action === 'jump' ? local.jumpTime > 0.16 : action === 'slide' ? local.slideTime > 0.08 : false;
    if (!safe) {
      if (local.shield > 0) {
        local.shield = 0;
        hitCooldown = 1.2;
        toast('Coconut shield saved you! 🥥', 1000);
      } else {
        local.alive = false;
        roomState = roomState === 'racing' ? 'racing' : roomState;
        toast(`Bonked by a ${OBSTACLES[obs.type].label}!`, 1600);
      }
      return;
    }
  }
}

function maybeSendState() {
  if (roomCode === 'SOLO' || roomState === 'menu') return;
  const now = Date.now();
  if (now - lastSendAt < SEND_EVERY_MS) return;
  lastSendAt = now;
  send({
    type: 'playerState',
    state: {
      lane: Math.round(local.lane * 100) / 100,
      targetLane: local.targetLane,
      distance: Math.round(local.distance),
      score: local.score,
      alive: local.alive,
      jumpTime: Math.round(local.jumpTime * 100) / 100,
      slideTime: Math.round(local.slideTime * 100) / 100,
      shield: Math.round(local.shield * 10) / 10,
      magnet: Math.round(local.magnet * 10) / 10
    }
  });
}

function renderGame() {
  image(bgLayer, 0, 0);
  drawParallax();
  drawRoad();
  drawTrackObjects();
  drawPlayers();
  drawRaceOver();
}

function buildBackground() {
  bgLayer.noStroke();
  for (let y = 0; y < height; y += 4) {
    const t = y / Math.max(1, height);
    const c1 = bgLayer.color('#bdf7ff');
    const c2 = bgLayer.color('#f9ffd7');
    const c3 = bgLayer.color('#b9f3d2');
    bgLayer.fill(t < 0.55 ? bgLayer.lerpColor(c1, c2, t / 0.55) : bgLayer.lerpColor(c2, c3, (t - 0.55) / 0.45));
    bgLayer.rect(0, y, width, 4);
  }
  for (let i = 0; i < 80; i++) {
    const x = (i * 137) % width;
    const y = 35 + ((i * 71) % Math.max(70, height * 0.42));
    bgLayer.fill(255, 255, 255, 74);
    bgLayer.ellipse(x, y, 40 + (i % 4) * 14, 18 + (i % 3) * 10);
  }
}

function drawParallax() {
  const offset = (local.distance * 0.12) % 180;
  noStroke();
  for (let i = -1; i < width / 180 + 2; i++) {
    const x = i * 180 - offset;
    fill('#8de0a7'); rect(x, height * 0.46, 95, 20, 12);
    fill('#fff1a8'); ellipse(x + 24, height * 0.45, 20, 20);
    fill('#ff9bb8'); ellipse(x + 58, height * 0.445, 16, 16);
    fill('#81d771'); ellipse(x + 84, height * 0.45, 22, 22);
  }
}

function drawRoad() {
  const horizon = height * 0.23;
  const bottom = height + 80;
  const roadTopW = Math.min(width * 0.24, 260);
  const roadBotW = Math.min(width * 0.92, 900);
  const cx = width / 2;
  noStroke();
  fill('#95df94');
  quad(cx - roadTopW * 0.72, horizon, cx + roadTopW * 0.72, horizon, cx + roadBotW * 0.72, bottom, cx - roadBotW * 0.72, bottom);
  fill('#ffe9a8');
  quad(cx - roadTopW * 0.58, horizon, cx + roadTopW * 0.58, horizon, cx + roadBotW * 0.58, bottom, cx - roadBotW * 0.58, bottom);
  stroke('#fff7d8'); strokeWeight(4);
  for (let lane = 1; lane < LANE_COUNT; lane++) {
    const laneT = lane / LANE_COUNT;
    const xTop = cx - roadTopW * 0.58 + roadTopW * 1.16 * laneT;
    const xBot = cx - roadBotW * 0.58 + roadBotW * 1.16 * laneT;
    line(xTop, horizon, xBot, bottom);
  }
  noStroke();
  const stripeOffset = (local.distance * 0.55) % 80;
  for (let y = horizon + stripeOffset - 80; y < height; y += 80) {
    const t = constrain((y - horizon) / (height - horizon), 0, 1);
    const w = roadTopW + (roadBotW - roadTopW) * t;
    fill(255, 255, 255, 70);
    rect(cx - w * 0.04, y, w * 0.08, 18 + t * 24, 8);
  }
}

function worldPoint(distance, lane) {
  const z = distance - local.distance;
  const t = constrain(1 - z / 980, 0, 1);
  const eased = t * t * (3 - 2 * t);
  const y = height * 0.22 + eased * (height * 0.64);
  const laneSpacing = (74 + eased * Math.min(240, width * 0.26));
  const x = width / 2 + (lane - 1) * laneSpacing;
  const s = 0.28 + eased * 1.6;
  return { x, y, scale: s, z };
}

function drawTrackObjects() {
  const visibleObstacles = track.filter(o => o.distance - local.distance > -80 && o.distance - local.distance < 980);
  const visibleFruits = fruits.filter(f => !collectedFruit.has(f.id) && f.distance - local.distance > -60 && f.distance - local.distance < 980);
  const objects = visibleObstacles.map(o => ({ ...o, objectType: 'obstacle' })).concat(visibleFruits.map(f => ({ ...f, objectType: 'fruit' })));
  objects.sort((a, b) => b.distance - a.distance);
  for (const obj of objects) {
    const pt = worldPoint(obj.distance, obj.lane);
    if (obj.objectType === 'fruit') drawFruit(pt.x, pt.y, pt.scale, obj.kind);
    else drawObstacle(pt.x, pt.y, pt.scale, obj.type);
  }
}

function drawObstacle(x, y, s, type) {
  push(); translate(x, y); scale(s); noStroke();
  const def = OBSTACLES[type];
  if (type === 'picnic') {
    fill('#8f5538'); rect(-18, -18, 36, 30, 4); fill(def.color); rect(-22, -12, 44, 28, 5); fill('#fff2be'); rect(-18, -6, 36, 5); rect(-4, -16, 8, 32);
  } else if (type === 'boba') {
    fill('#3a2636'); ellipse(0, 0, 34, 34); fill('#fff4'); ellipse(-7, -8, 8, 8); fill('#5c3f52'); ellipse(6, 7, 12, 9);
  } else if (type === 'turtle') {
    fill('#558f52'); ellipse(0, -3, 42, 26); fill('#7ed36e'); ellipse(20, -4, 15, 13); fill('#2f2a45'); ellipse(24, -7, 3, 3); fill('#7b5a43'); rect(-14, 7, 8, 8, 2); rect(8, 7, 8, 8, 2);
  } else if (type === 'puddle') {
    fill('#79ccff99'); ellipse(0, 4, 54, 18); fill('#ffffffaa'); ellipse(-9, 0, 14, 4); ellipse(13, 5, 17, 4);
  } else if (type === 'crate') {
    fill('#a7663b'); rect(-22, -22, 44, 44, 4); fill('#d99a5d'); rect(-17, -17, 34, 34, 3); stroke('#7d4c31'); strokeWeight(3); line(-17, -17, 17, 17); line(17, -17, -17, 17);
  } else {
    fill('#fff2d4'); rect(-9, -8, 18, 24, 5); fill('#ff7e91'); ellipse(0, -17, 45, 25); fill('#fff7d8'); ellipse(-10, -20, 7, 5); ellipse(8, -13, 9, 6);
  }
  pop();
}

function drawFruit(x, y, s, kind) {
  push(); translate(x, y - 12 * s); scale(s); noStroke();
  if (kind === 'mango') {
    fill('#ffb33f'); ellipse(0, 0, 24, 30); fill('#ffdc58'); ellipse(-4, -4, 14, 19); fill('#68bd55'); ellipse(9, -16, 12, 6);
  } else {
    fill('#ff6fa8'); ellipse(0, 0, 18, 18); fill('#fff7'); ellipse(-4, -5, 5, 5); fill('#68bd55'); rect(-2, -15, 4, 9, 2);
  }
  pop();
}

function drawPlayers() {
  const remotes = Array.from(lobbyPlayers.values()).filter(p => Date.now() - p.lastSeen < MAX_REMOTE_AGE_MS || roomState !== 'racing');
  remotes.sort((a, b) => (a.distance || 0) - (b.distance || 0));
  for (const p of remotes) {
    const lead = (p.distance || 0) - local.distance;
    const y = height * PLAYER_Y_RATIO - constrain(lead * 0.14, -130, 190);
    const x = laneX(p.lane ?? p.targetLane ?? 1, y);
    drawAnimal(x, y, 2.35, p, false);
  }
  const jumpLift = local.jumpTime > 0 ? Math.sin((local.jumpTime / 0.62) * Math.PI) * 88 : 0;
  drawAnimal(laneX(local.lane, height * PLAYER_Y_RATIO), height * PLAYER_Y_RATIO - jumpLift, 2.85, local, true);
}

function laneX(lane, y) {
  const t = constrain((y - height * 0.22) / (height * 0.64), 0, 1);
  const laneSpacing = 74 + t * Math.min(240, width * 0.26);
  return width / 2 + (lane - 1) * laneSpacing;
}

function drawAnimal(x, y, s, p, isMe) {
  const animal = ANIMALS[p.animal] || ANIMALS.bunny;
  const bob = p.alive === false ? 0 : Math.sin((millis() / 1000) * 12 + (p.id || '').length) * 3;
  const sliding = p.slideTime > 0;
  push(); translate(x, y + bob); scale(s); noStroke();
  if (!isMe) { fill(255, 255, 255, 90); ellipse(0, 11, 38, 10); }
  else { fill('#ffffffaa'); ellipse(0, 14, 48, 12); }
  if (p.alive === false) rotate(Math.sin(local.wobble) * 0.25);
  if (sliding) scale(1.18, 0.72);

  fill(animal.ear);
  if (p.animal === 'bunny') { rect(-12, -34, 7, 19, 4); rect(6, -34, 7, 19, 4); }
  else if (p.animal === 'cat' || p.animal === 'fox') { triangle(-17, -17, -9, -32, -3, -17); triangle(17, -17, 9, -32, 3, -17); }
  else { ellipse(-14, -18, 12, 13); ellipse(14, -18, 12, 13); }

  fill(animal.body); rect(-17, -20, 34, 32, 8);
  fill(animal.belly); rect(-9, -7, 18, 17, 6);
  fill(animal.body); rect(-22, -3, 8, 15, 3); rect(14, -3, 8, 15, 3);
  fill('#2f2a45'); rect(-8, -10, 4, 4, 1); rect(5, -10, 4, 4, 1);
  fill('#ff7aa8'); rect(-2, -4, 4, 3, 1);
  fill('#2f2a45'); rect(-5, 1, 10, 2, 1);
  fill(animal.accent); rect(11, -22, 10, 8, 2);

  fill(animal.body); rect(-13, 10, 9, 12, 3); rect(4, 10, 9, 12, 3);
  if (p.shield > 0) { noFill(); stroke('#ffdf74'); strokeWeight(2); ellipse(0, -3, 46, 54); noStroke(); }
  if (isMe) { fill('#ffdf74'); triangle(-5, -45, 5, -45, 0, -54); }
  pop();

  push(); textAlign(CENTER); textSize(isMe ? 14 : 12); fill('#2f2a45'); stroke('#fff7d8'); strokeWeight(4); text(p.name || 'pal', x, y - 82 * (s / 2.85)); pop();
}

function drawRaceOver() {
  if (roomState !== 'racing' || local.alive) return;
  push(); noStroke(); fill(47, 42, 69, 170); rect(width / 2 - 180, height / 2 - 70, 360, 140, 24); fill('#fff7d8'); textAlign(CENTER); textSize(28); text('Critter bonk!', width / 2, height / 2 - 24); textSize(15); text(`Score ${local.score} • Distance ${Math.floor(local.distance)}`, width / 2, height / 2 + 8); text('Host can restart from the lobby controls', width / 2, height / 2 + 34); pop();
}

function updateLobbyUI() {
  if (!ui.lobby) return;
  const inLobby = roomState !== 'racing';
  ui.lobby.classList.toggle('hidden', !inLobby);
  ui.roomInfo.classList.toggle('hidden', !roomCode || roomCode === 'SOLO');
  ui.roomCodeLabel.textContent = roomCode;
  ui.hostTools.classList.toggle('hidden', !(roomCode && meId && hostId === meId));
  ui.roomCode.value = roomCode && roomCode !== 'SOLO' ? roomCode : ui.roomCode.value;

  const players = [local].concat(Array.from(lobbyPlayers.values()));
  ui.lobbyPlayers.innerHTML = players.map(p => `<div class="player-chip">${escapeHtml(p.name || 'pal')} ${p.id === hostId ? '👑' : ''}<small>${escapeHtml(ANIMALS[p.animal]?.label || 'Critter')} • ${p.alive === false ? 'bonked' : 'ready'}</small></div>`).join('');
  ui.scoreboard.innerHTML = players
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 8)
    .map(p => `<div class="score-pill ${p.id === meId || p.id === 'local' ? 'me' : ''} ${p.alive === false ? 'crashed' : ''}"><b>${escapeHtml(p.name || 'pal')}</b><span>${Math.floor(p.score || 0)} pts • ${Math.floor(p.distance || 0)}m</span></div>`)
    .join('');
}

setInterval(updateLobbyUI, 250);

function copyInviteLink() {
  const server = encodeURIComponent(ui.serverUrl.value || defaultServerUrl());
  const url = `${location.origin}${location.pathname}?room=${encodeURIComponent(roomCode)}&server=${server}`;
  navigator.clipboard?.writeText(url).then(() => {
    inviteWasCopied = true;
    toast('Invite link copied!');
  }).catch(() => toast(url, 3000));
}

function toast(message, ms = 1800) {
  const div = document.createElement('div');
  div.className = 'toast';
  div.textContent = message;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), ms);
}

function onKeyDown(event) {
  if (event.target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName)) return;
  if (['ArrowLeft', 'a', 'A'].includes(event.key)) { input.left = true; input.leftTap = true; event.preventDefault(); }
  if (['ArrowRight', 'd', 'D'].includes(event.key)) { input.right = true; input.rightTap = true; event.preventDefault(); }
  if (['ArrowUp', 'w', 'W', ' '].includes(event.key)) { input.up = true; input.jumpTap = true; event.preventDefault(); }
  if (['ArrowDown', 's', 'S'].includes(event.key)) { input.down = true; input.slideTap = true; event.preventDefault(); }
}
function onKeyUp(event) {
  if (['ArrowLeft', 'a', 'A'].includes(event.key)) input.left = false;
  if (['ArrowRight', 'd', 'D'].includes(event.key)) input.right = false;
  if (['ArrowUp', 'w', 'W', ' '].includes(event.key)) input.up = false;
  if (['ArrowDown', 's', 'S'].includes(event.key)) input.down = false;
}
function onTouchStart(event) {
  const t = event.changedTouches[0];
  touchStart = { x: t.clientX, y: t.clientY, time: Date.now() };
}
function onTouchEnd(event) {
  if (!touchStart) return;
  const t = event.changedTouches[0];
  const dx = t.clientX - touchStart.x;
  const dy = t.clientY - touchStart.y;
  if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 28) {
    if (dx < 0) input.leftTap = true; else input.rightTap = true;
  } else if (Math.abs(dy) > 28) {
    if (dy < 0) input.jumpTap = true; else input.slideTap = true;
  }
  touchStart = null;
}
function clearTapInputs() { input.leftTap = input.rightTap = input.jumpTap = input.slideTap = false; }

function cleanName(value) { return String(value || 'Mango Pal').replace(/[^a-zA-Z0-9 _-]/g, '').trim().slice(0, 16) || 'Mango Pal'; }
function cleanRoomCode(value) { return String(value || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 12); }
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch])); }
function hashSeed(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function mulberry32(seed) { return function rand() { let t = seed += 0x6D2B79F5; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
