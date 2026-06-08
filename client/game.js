/* global createCanvas, resizeCanvas, windowWidth, windowHeight, pixelDensity, frameRate, noSmooth, background, width, height, fill, stroke, strokeWeight, noStroke, rect, ellipse, triangle, quad, text, textSize, textAlign, CENTER, LEFT, RIGHT, line, push, pop, translate, scale, image, createGraphics, color, lerpColor, map, constrain, floor, millis */

const ROOM_PARAM = new URLSearchParams(window.location.search).get('room') || '';
const SERVER_PARAM = new URLSearchParams(window.location.search).get('server') || '';
const MAX_REMOTE_AGE_MS = 1800;
const SEND_EVERY_MS = 80;
const LANE_COUNT = 3;
const PLAYER_Y_RATIO = 0.76;
const WORLD_VIEW_DISTANCE = 1200;
const START_SPEED = 245;
const MAX_SPEED_BOOST = 260;
const SPEED_RAMP = 0.012;
const LOCAL_PLAYER_SCALE = 2.35;
const REMOTE_PLAYER_SCALE = 1.95;
const JUMP_DURATION = 1.24;
const SLIDE_DURATION = 1.24;
const JUMP_SAFE_REMAINING = 0.03;
const SLIDE_SAFE_REMAINING = 0.03;
const JUMP_OBSTACLE_FRONT_WINDOW = 28;
const JUMP_OBSTACLE_BACK_WINDOW = -36;
const SLIDE_OBSTACLE_FRONT_WINDOW = 40;
const SLIDE_OBSTACLE_BACK_WINDOW = -48;
const LANE_COLLISION_TOLERANCE = 0.24;
// Depth perception on the pseudo-3D road can be fuzzy, so timing actions are
// intentionally very cozy: a jump clears hazards that were ~2.1s away at
// starting speed instead of requiring last-second panic hops.
const JUMP_CLEAR_DISTANCE = 540;
// Same idea for sliding: ducking early should still count for nearby boba
// pearls when the road depth is hard to read.
const SLIDE_CLEAR_DISTANCE = 470;
const PINEAPPLE_DASH_DURATION = 3.2;
const PINEAPPLE_DASH_SPEED_BOOST = 120;
const BERRY_MAGNET_DURATION = 6;
const CUPCAKE_FLOAT_DURATION = 4.5;
const MANGO_COMBO_DURATION = 6;
const MANGO_COMBO_BONUS = 175;
const MANGO_COMBO_FRUIT_BONUS = 35;
const MELON_ROLL_EVENT_DISTANCE = 1180;
const MELON_ROLL_SPACING = 235;
const MELON_ROLL_WARNING_DISTANCE = 520;
const MELON_ROLL_BONUS = 250;

const FESTIVAL_FRENZIES = {
  melonRoll: { label: 'Melon Roll', emoji: '🍉', color: '#6ed46b' }
};

const PASS_THROUGH_STRUCTURES = {
  platform: { label: 'flower platform', color: '#ffcf7f' },
  ladder: { label: 'ribbon ladder', color: '#c68b55' },
  hill: { label: 'minty elevation', color: '#8de0a7' }
};

const POWER_UPS = {
  coconutShield: { label: 'Coconut Shield', emoji: '🥥', color: '#f5f1df' },
  pineappleDash: { label: 'Pineapple Dash', emoji: '🍍', color: '#ffd75f' },
  berryMagnet: { label: 'Berry Magnet', emoji: '🍓', color: '#ff7aa8' },
  cupcakeFloat: { label: 'Cupcake Float', emoji: '🧁', color: '#c7b6ff' }
};

const ANIMALS = {
  bunny: { label: 'Ribbon Bunny', body: '#fff3f7', belly: '#ffd1df', ear: '#ff9fbd', cheek: '#ff8fb4', accent: '#7ed7ff' },
  raccoon: { label: 'Bandit Raccoon', body: '#9b98aa', belly: '#ebe8ef', ear: '#625f72', cheek: '#ff9fc0', accent: '#ffd36b' },
  cat: { label: 'Cupcake Cat', body: '#ffd68c', belly: '#fff2c0', ear: '#ff9f8f', cheek: '#ff8fae', accent: '#9ee8b3' },
  fox: { label: 'Marshmallow Fox', body: '#ff9a4f', belly: '#ffe5bd', ear: '#d94f38', cheek: '#ffb0a2', accent: '#88d8ff' },
  panda: { label: 'Mochi Panda', body: '#f7f5ea', belly: '#ffffff', ear: '#333047', cheek: '#ff9cc7', accent: '#ff9cc7' },
  frog: { label: 'Sprout Frog', body: '#83d85a', belly: '#d8ff95', ear: '#58ae45', cheek: '#ffb0be', accent: '#ffd66e' }
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
let powerUps = [];
let passThroughStructures = [];
let festivalEvents = [];
let announcedFestivalEvents = new Set();
let clearedFestivalEvents = new Set();
let collectedFruit = new Set();
let collectedPowerUps = new Set();
let hitCooldown = 0;
let inviteWasCopied = false;

let local = makeDefaultPlayer('local', 'Mango Pal', 'bunny');
let input = { left: false, right: false, up: false, down: false, leftTap: false, rightTap: false, jumpTap: false, slideTap: false };
let touchStart = null;
let bgLayer;
let audio = {
  ctx: null,
  master: null,
  musicGain: null,
  sfxGain: null,
  musicOn: false,
  scheduler: null,
  nextNoteTime: 0,
  step: 0,
  lastBeatFlash: 0
};

function makeDefaultPlayer(id, name, animal) {
  return {
    id,
    name: cleanName(name),
    animal: ANIMALS[animal] ? animal : 'bunny',
    lane: 1,
    targetLane: 1,
    distance: 0,
    score: 0,
    bonusScore: 0,
    alive: true,
    finished: false,
    jumpTime: 0,
    jumpClearUntil: -Infinity,
    slideTime: 0,
    slideClearUntil: -Infinity,
    dashBoost: 0,
    floatGrace: 0,
    laneCooldown: 0,
    wobble: 0,
    shield: 0,
    magnet: 0,
    mangoCombo: 0,
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
  ui.musicToggle = document.getElementById('musicToggle');
  ui.raceOverPanel = document.getElementById('raceOverPanel');
  ui.raceOverTitle = document.getElementById('raceOverTitle');
  ui.raceOverSummary = document.getElementById('raceOverSummary');
  ui.afterRoundRestartBtn = document.getElementById('afterRoundRestartBtn');
  ui.raceOverHint = document.getElementById('raceOverHint');
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
    playSparkle([392.0, 523.25, 659.25], 0.055);
    toast('Solo practice started — dodge the fruit festival chaos!');
  });
  ui.startRaceBtn.addEventListener('click', () => send({ type: 'startRace' }));
  ui.restartRaceBtn.addEventListener('click', () => send({ type: 'restartRace' }));
  ui.afterRoundRestartBtn.addEventListener('click', restartAfterRound);
  ui.copyInviteBtn.addEventListener('click', copyInviteLink);
  ui.musicToggle.addEventListener('click', toggleMusic);
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
  updateRoundEndUI();
  updateMusicButton();
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
    playSparkle([523.25, 659.25, 783.99, 1046.5], 0.055);
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
  local.bonusScore = 0;
  local.alive = true;
  local.finished = false;
  local.lane = 1;
  local.targetLane = 1;
  local.jumpTime = 0;
  local.jumpClearUntil = -Infinity;
  local.slideTime = 0;
  local.slideClearUntil = -Infinity;
  local.dashBoost = 0;
  local.floatGrace = 0;
  local.laneCooldown = 0;
  local.shield = 0;
  local.magnet = 0;
  local.mangoCombo = 0;
  collectedFruit.clear();
  collectedPowerUps.clear();
  announcedFestivalEvents.clear();
  clearedFestivalEvents.clear();
  hitCooldown = 0;
  buildTrack(roomSeed);
  updateRoundEndUI();
}

function restartAfterRound() {
  if (roomCode === 'SOLO' || !roomCode) {
    roomCode = 'SOLO';
    meId = meId || 'solo-' + Math.floor(Math.random() * 9999);
    local.id = meId;
    hostId = meId;
    roomState = 'racing';
    resetRace('SOLO-' + Date.now());
    updateLobbyUI();
    playSparkle([392.0, 523.25, 659.25], 0.055);
    toast('Fresh solo round! 🐾');
    return;
  }

  if (hostId === meId) {
    send({ type: 'startRace' });
    toast('Starting a fresh round for the room!');
  } else {
    toast('Only the host can restart the multiplayer round.');
  }
}

function updateRoundEndUI() {
  if (!ui.raceOverPanel) return;
  const shouldShow = roomState === 'racing' && local.alive === false;
  ui.raceOverPanel.classList.toggle('hidden', !shouldShow);
  if (!shouldShow) return;

  const isSolo = roomCode === 'SOLO' || !roomCode;
  const isHost = hostId === meId;
  ui.raceOverTitle.textContent = 'Critter bonk!';
  ui.raceOverSummary.textContent = `Score ${Math.floor(local.score || 0)} • Distance ${Math.floor(local.distance || 0)}m`;
  ui.afterRoundRestartBtn.disabled = !isSolo && !isHost;
  ui.afterRoundRestartBtn.textContent = isSolo ? 'Restart solo round' : isHost ? 'Restart room now' : 'Waiting for host';
  ui.raceOverHint.textContent = isSolo
    ? 'Tap restart to dash again right away.'
    : isHost
      ? 'You are host — restart sends everyone into a fresh round.'
      : 'Ask the host to restart when everyone is ready.';
}

function buildTrack(seed) {
  const rand = mulberry32(hashSeed(seed));
  const obstacleTypes = Object.keys(OBSTACLES);
  const structureTypes = Object.keys(PASS_THROUGH_STRUCTURES);
  const powerKinds = Object.keys(POWER_UPS);
  track = [];
  fruits = [];
  powerUps = [];
  passThroughStructures = [];
  festivalEvents = [];
  let d = 430;
  for (let i = 0; i < 240; i++) {
    const lane = Math.floor(rand() * LANE_COUNT);
    const type = obstacleTypes[Math.floor(rand() * obstacleTypes.length)];
    track.push({ id: 'o' + i, distance: d, lane, type });

    if (i % 3 === 0) {
      passThroughStructures.push({
        id: 's' + i,
        distance: d + 70 + rand() * 180,
        lane: Math.floor(rand() * LANE_COUNT),
        type: structureTypes[Math.floor(rand() * structureTypes.length)]
      });
    }

    if (i > 2 && i % 10 === 4) {
      powerUps.push({
        id: 'p' + i,
        distance: d + 95 + rand() * 90,
        lane: Math.floor(rand() * LANE_COUNT),
        kind: powerKinds[Math.floor(rand() * powerKinds.length)]
      });
    }

    const fruitLane = Math.floor(rand() * LANE_COUNT);
    fruits.push({ id: 'f' + i, distance: d + 150 + rand() * 110, lane: fruitLane, kind: rand() > 0.82 ? 'mango' : 'berry' });
    d += 300 + rand() * 220;
  }
  buildFestivalEvents(rand, d);
}

function buildFestivalEvents(rand, maxDistance) {
  let startDistance = 1850 + rand() * 420;
  let index = 0;
  while (startDistance < maxDistance - MELON_ROLL_EVENT_DISTANCE) {
    const firstLane = Math.floor(rand() * LANE_COUNT);
    const lanePattern = Array.from({ length: 7 }, (_, step) => {
      const sway = step % 3 === 0 ? 0 : step % 3 === 1 ? 1 : -1;
      return constrain(firstLane + sway, 0, LANE_COUNT - 1);
    });
    festivalEvents.push({
      id: 'festival-melon-' + index,
      kind: 'melonRoll',
      startDistance,
      endDistance: startDistance + MELON_ROLL_EVENT_DISTANCE,
      lanePattern
    });
    startDistance += 3300 + rand() * 1400;
    index++;
  }
}

function updateGame(dt) {
  if (roomState !== 'racing') return;
  if (!local.alive) {
    local.wobble += dt * 5;
    return;
  }

  const speed = START_SPEED + Math.min(MAX_SPEED_BOOST, local.distance * SPEED_RAMP) + (local.dashBoost > 0 ? PINEAPPLE_DASH_SPEED_BOOST : 0);
  local.distance += speed * dt;
  local.score = Math.floor(local.distance / 6) + collectedFruit.size * 25 + collectedPowerUps.size * 45 + Math.floor(local.bonusScore || 0);
  local.laneCooldown = Math.max(0, local.laneCooldown - dt);
  local.jumpTime = Math.max(0, local.jumpTime - dt);
  local.slideTime = Math.max(0, local.slideTime - dt);
  local.dashBoost = Math.max(0, local.dashBoost - dt);
  local.floatGrace = Math.max(0, local.floatGrace - dt);
  local.shield = Math.max(0, local.shield - dt);
  local.magnet = Math.max(0, local.magnet - dt);
  local.mangoCombo = Math.max(0, local.mangoCombo - dt);
  hitCooldown = Math.max(0, hitCooldown - dt);

  if ((input.leftTap || input.left) && local.laneCooldown <= 0) moveLane(-1);
  if ((input.rightTap || input.right) && local.laneCooldown <= 0) moveLane(1);
  if ((input.jumpTap || input.up) && local.jumpTime <= 0.02 && local.slideTime <= 0) {
    startJump();
  }
  if ((input.slideTap || input.down) && local.jumpTime <= 0.02) {
    startSlide();
  }

  local.lane += (local.targetLane - local.lane) * Math.min(1, dt * 13);
  local.wobble += dt * (local.slideTime > 0 ? 18 : 10);

  checkPickups();
  checkPowerUps();
  checkFestivalEvents();
  checkFestivalCollisions();
  checkCollisions();
}

function moveLane(delta) {
  const oldLane = local.targetLane;
  local.targetLane = constrain(local.targetLane + delta, 0, LANE_COUNT - 1);
  local.laneCooldown = 0.13;
  if (oldLane !== local.targetLane && audio.ctx) playTone(delta < 0 ? 329.63 : 392.0, audio.ctx.currentTime, 0.055, 'square', 0.026, audio.sfxGain);
}

function startJump() {
  local.jumpTime = JUMP_DURATION;
  local.jumpClearUntil = Math.max(local.jumpClearUntil || -Infinity, local.distance + JUMP_CLEAR_DISTANCE);
  playSparkle([392.0, 523.25], 0.025);
}

function startSlide() {
  local.slideTime = SLIDE_DURATION;
  local.slideClearUntil = Math.max(local.slideClearUntil || -Infinity, local.distance + SLIDE_CLEAR_DISTANCE);
  playTone(196.0, audio.ctx?.currentTime || 0, 0.07, 'triangle', 0.035, audio.sfxGain);
}

function checkPickups() {
  for (const fruit of fruits) {
    if (collectedFruit.has(fruit.id)) continue;
    const z = fruit.distance - local.distance;
    const laneNear = Math.abs(fruit.lane - local.lane) < (local.magnet > 0 ? 1.45 : 0.36);
    if (z < 46 && z > -42 && laneNear) {
      collectedFruit.add(fruit.id);
      if (fruit.kind === 'mango') {
        applyMangoCombo();
      } else {
        if (local.mangoCombo > 0) {
          local.bonusScore = (local.bonusScore || 0) + MANGO_COMBO_FRUIT_BONUS;
          playSparkle([783.99, 987.77], 0.045);
        } else if (collectedFruit.size % 8 === 0) {
          local.magnet = 4;
          playSparkle([523.25, 659.25, 987.77], 0.06);
          toast('Fruit magnet! 🍓', 900);
        } else {
          playSparkle([783.99], 0.035);
        }
      }
    }
  }
}

function applyMangoCombo() {
  local.mangoCombo = Math.max(local.mangoCombo || 0, MANGO_COMBO_DURATION);
  local.bonusScore = (local.bonusScore || 0) + MANGO_COMBO_BONUS;
  playSparkle([659.25, 783.99, 1046.5, 1318.51], 0.075);
  toast('🥭 Mango Combo! Bonus points + juicy fruit streak.', 1400);
}

function checkPowerUps() {
  for (const power of powerUps) {
    if (collectedPowerUps.has(power.id)) continue;
    const z = power.distance - local.distance;
    const laneNear = Math.abs(power.lane - local.lane) < (local.magnet > 0 ? 1.25 : 0.42);
    if (z < 52 && z > -46 && laneNear) {
      collectedPowerUps.add(power.id);
      applyPowerUp(power.kind);
    }
  }
}

function activeFestivalEvent(event) {
  return local.distance >= event.startDistance && local.distance <= event.endDistance;
}

function checkFestivalEvents() {
  for (const event of festivalEvents) {
    if (!announcedFestivalEvents.has(event.id) && local.distance > event.startDistance - MELON_ROLL_WARNING_DISTANCE && local.distance < event.endDistance) {
      announcedFestivalEvents.add(event.id);
      toast(`🍉 Festival Frenzy: ${FESTIVAL_FRENZIES[event.kind]?.label || 'Melon Roll'}! Dodge the giant melon!`, 1800);
      playSparkle([196.0, 246.94, 392.0], 0.06);
    }
    if (!clearedFestivalEvents.has(event.id) && local.distance > event.endDistance) {
      clearedFestivalEvents.add(event.id);
      local.bonusScore = (local.bonusScore || 0) + MELON_ROLL_BONUS;
      toast(`🍉 Melon dodged! +${MELON_ROLL_BONUS}`, 1300);
      playSparkle([523.25, 659.25, 783.99, 1046.5], 0.07);
    }
  }
}

function checkFestivalCollisions() {
  if (hitCooldown > 0) return;
  for (const event of festivalEvents) {
    if (event.kind !== 'melonRoll' || !activeFestivalEvent(event)) continue;
    for (const roll of melonRollHazards(event)) {
      const z = roll.distance - local.distance;
      if (z < -54 || z > 42) continue;
      if (Math.abs(roll.lane - local.lane) > 0.34) continue;
      if (local.dashBoost > 0) return;
      if (local.shield > 0) {
        local.shield = 0;
        hitCooldown = 1.2;
        playSparkle([329.63, 493.88, 659.25], 0.065);
        toast('Coconut shield saved you from the melon! 🥥', 1100);
      } else {
        local.alive = false;
        playThump();
        toast('Bonked by the Giant Melon Roll! 🍉', 1600);
      }
      return;
    }
  }
}

function melonRollHazards(event) {
  const hazards = [];
  for (let distance = event.startDistance + 160, index = 0; distance < event.endDistance; distance += MELON_ROLL_SPACING, index++) {
    hazards.push({ distance, lane: event.lanePattern[index % event.lanePattern.length] });
  }
  return hazards;
}

function applyPowerUp(kind) {
  if (kind === 'coconutShield') {
    local.shield = Math.max(local.shield, 8);
    playSparkle([392.0, 523.25, 659.25], 0.07);
    toast('🥥 Coconut Shield! Your next bonk is blocked.', 1300);
    return;
  }
  if (kind === 'pineappleDash') {
    local.dashBoost = Math.max(local.dashBoost, PINEAPPLE_DASH_DURATION);
    hitCooldown = Math.max(hitCooldown, PINEAPPLE_DASH_DURATION);
    playSparkle([523.25, 659.25, 783.99, 1046.5], 0.075);
    toast('🍍 Pineapple Dash! Zoom through obstacles for a moment!', 1400);
    return;
  }
  if (kind === 'berryMagnet') {
    local.magnet = Math.max(local.magnet, BERRY_MAGNET_DURATION);
    playSparkle([783.99, 659.25, 523.25], 0.07);
    toast('🍓 Berry Magnet! Fruit and power-ups tug toward you.', 1400);
    return;
  }
  if (kind === 'cupcakeFloat') {
    local.floatGrace = Math.max(local.floatGrace, CUPCAKE_FLOAT_DURATION);
    local.jumpClearUntil = Math.max(local.jumpClearUntil || -Infinity, local.distance + JUMP_CLEAR_DISTANCE * 1.15);
    local.slideClearUntil = Math.max(local.slideClearUntil || -Infinity, local.distance + SLIDE_CLEAR_DISTANCE * 1.15);
    playSparkle([659.25, 880.0, 1046.5], 0.07);
    toast('🧁 Cupcake Float! Jump/slide hazards get extra squishy timing.', 1500);
  }
}

function checkCollisions() {
  if (hitCooldown > 0) return;
  for (const obs of track) {
    const z = obs.distance - local.distance;
    const action = OBSTACLES[obs.type].action;
    const frontWindow = action === 'jump' ? JUMP_OBSTACLE_FRONT_WINDOW : action === 'slide' ? SLIDE_OBSTACLE_FRONT_WINDOW : 42;
    const backWindow = action === 'jump' ? JUMP_OBSTACLE_BACK_WINDOW : action === 'slide' ? SLIDE_OBSTACLE_BACK_WINDOW : -40;
    if (z < backWindow) continue;
    if (z > frontWindow) break;
    if (Math.abs(obs.lane - local.lane) > LANE_COLLISION_TOLERANCE) continue;
    const timingAction = action === 'jump' || action === 'slide';
    const safe = local.dashBoost > 0 || (local.floatGrace > 0 && timingAction) || (action === 'jump' ? isJumpObstacleCleared(obs) : action === 'slide' ? isSlideObstacleCleared(obs) : false);
    if (!safe) {
      if (local.shield > 0) {
        local.shield = 0;
        hitCooldown = 1.2;
        playSparkle([329.63, 493.88, 659.25], 0.065);
        toast('Coconut shield saved you! 🥥', 1000);
      } else {
        local.alive = false;
        roomState = roomState === 'racing' ? 'racing' : roomState;
        playThump();
        toast(`Bonked by a ${OBSTACLES[obs.type].label}!`, 1600);
      }
      return;
    }
  }
}

function isJumpObstacleCleared(obs) {
  // Old behavior only counted the visible airtime, which made early jumps feel
  // like they "landed into" baskets/turtles/puddles. Keep the airtime check,
  // then add a distance-based clear zone from where the jump began.
  return local.jumpTime > JUMP_SAFE_REMAINING || obs.distance <= (local.jumpClearUntil || -Infinity);
}

function isSlideObstacleCleared(obs) {
  return local.slideTime > SLIDE_SAFE_REMAINING || obs.distance <= (local.slideClearUntil || -Infinity);
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
      dashBoost: Math.round(local.dashBoost * 10) / 10,
      floatGrace: Math.round(local.floatGrace * 10) / 10,
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
  drawFestivalEvents();
  drawPlayers();
  drawFestivalBanner();
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
  const stripeOffset = (local.distance * 0.34) % 80;
  for (let y = horizon + stripeOffset - 80; y < height; y += 80) {
    const t = constrain((y - horizon) / (height - horizon), 0, 1);
    const w = roadTopW + (roadBotW - roadTopW) * t;
    fill(255, 255, 255, 70);
    rect(cx - w * 0.04, y, w * 0.08, 18 + t * 24, 8);
  }
}

function worldPoint(distance, lane) {
  const z = distance - local.distance;
  const t = constrain(1 - z / WORLD_VIEW_DISTANCE, 0, 1);
  const eased = t * t * (3 - 2 * t);
  const y = height * 0.22 + eased * (height * 0.64);
  const laneSpacing = (74 + eased * Math.min(240, width * 0.26));
  const x = width / 2 + (lane - 1) * laneSpacing;
  const s = 0.22 + eased * 1.45;
  return { x, y, scale: s, z };
}

function drawTrackObjects() {
  const visibleObstacles = track.filter(o => o.distance - local.distance > -80 && o.distance - local.distance < WORLD_VIEW_DISTANCE);
  const visibleFruits = fruits.filter(f => !collectedFruit.has(f.id) && f.distance - local.distance > -60 && f.distance - local.distance < WORLD_VIEW_DISTANCE);
  const visiblePowerUps = powerUps.filter(p => !collectedPowerUps.has(p.id) && p.distance - local.distance > -60 && p.distance - local.distance < WORLD_VIEW_DISTANCE);
  const visibleStructures = passThroughStructures.filter(s => s.distance - local.distance > -120 && s.distance - local.distance < WORLD_VIEW_DISTANCE);
  const objects = visibleStructures.map(s => ({ ...s, objectType: 'structure' }))
    .concat(visibleObstacles.map(o => ({ ...o, objectType: 'obstacle' })))
    .concat(visibleFruits.map(f => ({ ...f, objectType: 'fruit' })))
    .concat(visiblePowerUps.map(p => ({ ...p, objectType: 'power' })));
  objects.sort((a, b) => b.distance - a.distance);
  for (const obj of objects) {
    const pt = worldPoint(obj.distance, obj.lane);
    if (obj.objectType === 'fruit') drawFruit(pt.x, pt.y, pt.scale, obj.kind);
    else if (obj.objectType === 'power') drawPowerUp(pt.x, pt.y, pt.scale, obj.kind);
    else if (obj.objectType === 'structure') drawPassThroughStructure(pt.x, pt.y, pt.scale, obj.type);
    else drawObstacle(pt.x, pt.y, pt.scale, obj.type);
  }
}

function drawFestivalEvents() {
  for (const event of festivalEvents) {
    if (event.kind !== 'melonRoll') continue;
    const nearEnough = local.distance > event.startDistance - MELON_ROLL_WARNING_DISTANCE && local.distance < event.endDistance + 140;
    if (nearEnough) drawMelonRollFrenzy(event);
  }
}

function drawMelonRollFrenzy(event) {
  const warningActive = local.distance < event.startDistance;
  const hazards = melonRollHazards(event)
    .filter(roll => roll.distance - local.distance > -120 && roll.distance - local.distance < WORLD_VIEW_DISTANCE)
    .sort((a, b) => b.distance - a.distance);

  for (const roll of hazards) {
    const pt = worldPoint(roll.distance, roll.lane);
    drawMelonWarning(pt.x, pt.y, pt.scale, warningActive);
    drawGiantMelon(pt.x, pt.y, pt.scale, roll.distance);
  }
}

function drawMelonWarning(x, y, s, warningActive) {
  if (s < 0.38) return;
  push(); translate(x, y + 18 * s); scale(s); noStroke();
  fill(warningActive ? '#ff6f8fb0' : '#2f2a4544');
  ellipse(0, 0, 72, 20);
  fill('#fff7d8cc'); rect(-34, -9, 68, 8, 4);
  pop();
}

function drawGiantMelon(x, y, s, distance) {
  const spin = ((distance - local.distance) / 36) % Math.PI;
  push(); translate(x, y - 20 * s); scale(s * 1.35); rotate(spin); noStroke();
  fill('#3d8f4f'); ellipse(0, 0, 52, 52);
  fill('#6ed46b'); ellipse(0, 0, 43, 43);
  stroke('#2f7b49'); strokeWeight(3);
  line(-16, -20, -8, 20); line(0, -23, 0, 23); line(16, -20, 8, 20);
  noStroke(); fill('#fff7d8aa'); ellipse(-11, -13, 12, 7);
  pop();
  if (s > 0.55) drawPowerCue(x, y + 4 * s, s, 'MELON ROLL');
}

function drawFestivalBanner() {
  const active = festivalEvents.find(event => local.distance > event.startDistance - MELON_ROLL_WARNING_DISTANCE && local.distance < event.endDistance && event.kind === 'melonRoll');
  if (!active || local.alive === false) return;
  const untilStart = Math.max(0, active.startDistance - local.distance);
  const label = untilStart > 0 ? `Festival Frenzy in ${Math.ceil(untilStart / 120)}!` : 'Festival Frenzy: Melon Roll!';
  push(); noStroke(); textAlign(CENTER); textSize(16);
  fill('#2f2a45cc'); rect(width / 2 - 150, height * 0.16 - 22, 300, 34, 17);
  fill('#fff7d8'); text(`🍉 ${label}`, width / 2, height * 0.16);
  pop();
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
  drawObstacleCue(x, y, s, def.action);
}

function drawObstacleCue(x, y, s, action) {
  if (s < 0.44) return;
  const cue = action === 'jump' ? '↑ JUMP' : action === 'slide' ? '↓ SLIDE' : '↔ MOVE';
  const bg = action === 'jump' ? '#7ed7ff' : action === 'slide' ? '#ffd36b' : '#ff9fbd';
  push(); translate(x, y - 54 * s); noStroke(); textAlign(CENTER); textSize(Math.max(10, 10 * s));
  fill('#fff7d8dd'); rect(-30 * s, -17 * s, 60 * s, 19 * s, 9 * s);
  fill(bg); rect(-27 * s, -14 * s, 54 * s, 13 * s, 7 * s);
  fill('#2f2a45'); text(cue, 0, -4 * s);
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

function drawPowerUp(x, y, s, kind) {
  const def = POWER_UPS[kind] || POWER_UPS.coconutShield;
  push(); translate(x, y - 20 * s); scale(s); noStroke(); textAlign(CENTER); textSize(19);
  fill('#fff7d8dd'); ellipse(0, 0, 42, 42);
  fill(def.color); ellipse(0, 0, 31, 31);
  fill('#2f2a45'); text(def.emoji, 0, 7);
  fill('#ffffffaa'); rect(-13, -17, 12, 4, 2);
  pop();
  if (s > 0.6) drawPowerCue(x, y, s, def.label);
}

function drawPowerCue(x, y, s, label) {
  push(); translate(x, y - 74 * s); noStroke(); textAlign(CENTER); textSize(Math.max(9, 9 * s));
  fill('#2f2a45cc'); rect(-46 * s, -15 * s, 92 * s, 18 * s, 9 * s);
  fill('#fff7d8'); text(label, 0, -3 * s);
  pop();
}

function drawPassThroughStructure(x, y, s, type) {
  const def = PASS_THROUGH_STRUCTURES[type] || PASS_THROUGH_STRUCTURES.platform;
  push(); translate(x, y + 8 * s); scale(s); noStroke();
  if (type === 'platform') {
    fill('#ffffff80'); ellipse(0, 8, 80, 16);
    fill(def.color); rect(-44, -5, 88, 12, 6);
    fill('#ff9fbd'); rect(-34, -15, 10, 10, 4); fill('#fff2a8'); rect(-8, -18, 11, 11, 4); fill('#9ee8b3'); rect(22, -14, 10, 10, 4);
  } else if (type === 'ladder') {
    fill('#ffffff66'); rect(-20, -36, 40, 70, 10);
    stroke(def.color); strokeWeight(5); line(-15, -34, -15, 34); line(15, -34, 15, 34);
    stroke('#ffe3ad'); strokeWeight(4); for (let yy = -25; yy <= 25; yy += 13) line(-15, yy, 15, yy);
    noStroke(); fill('#ff9fbd'); rect(-23, -39, 46, 8, 4);
  } else {
    fill('#ffffff66'); ellipse(0, 18, 90, 18);
    fill(def.color); ellipse(0, 4, 86, 38);
    fill('#b9f3d2'); ellipse(-18, -8, 34, 22); fill('#e4ff9f'); ellipse(18, -9, 34, 21);
    fill('#fff7d8aa'); rect(-28, -3, 56, 6, 3);
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
    drawAnimal(x, y, REMOTE_PLAYER_SCALE, p, false);
  }
  const jumpLift = local.jumpTime > 0 ? Math.sin((local.jumpTime / JUMP_DURATION) * Math.PI) * 76 : 0;
  drawAnimal(laneX(local.lane, height * PLAYER_Y_RATIO), height * PLAYER_Y_RATIO - jumpLift, LOCAL_PLAYER_SCALE, local, true);
}

function laneX(lane, y) {
  const t = constrain((y - height * 0.22) / (height * 0.64), 0, 1);
  const laneSpacing = 74 + t * Math.min(240, width * 0.26);
  return width / 2 + (lane - 1) * laneSpacing;
}

function drawAnimal(x, y, s, p, isMe) {
  const animalKey = ANIMALS[p.animal] ? p.animal : 'bunny';
  const animal = ANIMALS[animalKey];
  const t = millis() / 1000;
  const bob = p.alive === false ? 0 : Math.sin(t * 12 + (p.id || '').length) * 3;
  const wiggle = p.alive === false ? 0 : Math.sin(t * 9 + (p.id || '').length) * 1.4;
  const sliding = p.slideTime > 0;
  const blink = p.alive !== false && Math.sin(t * 3.1 + (p.id || '').length) > 0.92;

  push(); translate(x, y + bob); scale(s); noStroke();
  if (!isMe) { fill(255, 255, 255, 90); ellipse(0, 13, 41, 10); }
  else { fill('#ffffffb8'); ellipse(0, 15, 52, 13); }
  if (p.alive === false) rotate(Math.sin(p.wobble || local.wobble) * 0.25);
  if (sliding) scale(1.18, 0.72);

  drawCritterTail(animalKey, animal, wiggle);
  drawCritterEars(animalKey, animal, wiggle);
  drawCritterBody(animalKey, animal, wiggle);
  drawCritterFace(animalKey, animal, blink);
  drawCritterAccessory(animalKey, animal, isMe, wiggle);

  if (p.shield > 0) {
    noFill(); stroke('#ffdf74'); strokeWeight(2); ellipse(0, -8, 50, 58); noStroke();
    fill('#fff2a8'); rect(-2, -39, 4, 4, 1); rect(21, -9, 4, 4, 1); rect(-24, -8, 4, 4, 1);
  }
  if (p.dashBoost > 0) {
    noFill(); stroke('#ffd75f'); strokeWeight(2); ellipse(0, -7, 62, 42); noStroke();
    fill('#ff9fbd'); rect(-35, -11, 10, 3, 1); fill('#7ed7ff'); rect(26, -20, 12, 3, 1); fill('#fff2a8'); rect(-31, 8, 13, 3, 1);
  }
  if (p.floatGrace > 0) {
    noFill(); stroke('#c7b6ff'); strokeWeight(2); ellipse(0, -11, 58, 66); noStroke();
    fill('#fff7d8'); rect(-18, -43, 5, 5, 2); rect(15, -40, 5, 5, 2); rect(24, -2, 4, 4, 2);
  }
  if (isMe) drawTinyCrown();
  pop();

  const nameY = y - (s * 47 + 24);
  push(); textAlign(CENTER); textSize(isMe ? 14 : 12); fill('#2f2a45'); stroke('#fff7d8'); strokeWeight(4); text(p.name || 'pal', x, nameY); pop();
}

function drawCritterTail(kind, animal, wiggle) {
  push(); translate(wiggle * 0.45, 0); noStroke();
  if (kind === 'fox') {
    fill(animal.body); triangle(13, -2, 35, -9, 22, 15); rect(18, -8, 13, 18, 6);
    fill('#fff4dc'); rect(27, -8, 8, 10, 4);
  } else if (kind === 'raccoon') {
    fill(animal.ear); rect(13, -1, 24, 11, 6);
    fill('#ebe8ef'); rect(19, 0, 5, 9, 2); rect(29, 0, 5, 8, 2);
  } else if (kind === 'cat') {
    fill(animal.body); rect(14, 2, 20, 7, 4); ellipse(33, 0, 9, 11);
    fill(animal.accent); rect(31, -2, 5, 4, 2);
  } else if (kind === 'bunny') {
    fill('#fffaff'); ellipse(19, 5, 12, 12); fill('#ffdbe8'); ellipse(20, 4, 6, 6);
  } else if (kind === 'panda') {
    fill(animal.ear); ellipse(17, 7, 8, 8);
  } else if (kind === 'frog') {
    fill('#6cc84f'); rect(14, 4, 10, 6, 3);
    fill('#f5ff9c'); rect(20, 2, 4, 3, 1);
  }
  pop();
}

function drawCritterEars(kind, animal, wiggle) {
  push(); noStroke();
  if (kind === 'bunny') {
    fill(animal.body); rect(-14 + wiggle * 0.15, -50, 9, 28, 5); rect(6 - wiggle * 0.15, -50, 9, 28, 5);
    fill(animal.ear); rect(-11 + wiggle * 0.15, -45, 4, 17, 3); rect(9 - wiggle * 0.15, -45, 4, 17, 3);
  } else if (kind === 'cat' || kind === 'fox') {
    fill(kind === 'fox' ? animal.ear : animal.body);
    triangle(-18, -25, -10, -42 - wiggle, -2, -25);
    triangle(18, -25, 10, -42 + wiggle, 2, -25);
    fill(kind === 'fox' ? '#ffcfba' : animal.ear);
    triangle(-14, -26, -10, -35, -5, -26);
    triangle(14, -26, 10, -35, 5, -26);
  } else if (kind === 'frog') {
    fill(animal.body); ellipse(-11, -31, 13, 13); ellipse(11, -31, 13, 13);
  } else {
    fill(animal.ear); ellipse(-16, -25, 15, 15); ellipse(16, -25, 15, 15);
    fill(kind === 'panda' ? '#f7f5ea' : animal.belly); ellipse(-16, -24, 7, 7); ellipse(16, -24, 7, 7);
  }
  pop();
}

function drawCritterBody(kind, animal, wiggle) {
  fill('#2f2a4520'); rect(-18, -27, 36, 42, 11);
  fill(animal.body); rect(-15, -7, 30, 28, 9);
  fill(animal.belly); rect(-9, 1, 18, 17, 7);

  fill(animal.body); rect(-22, -3 + wiggle * 0.15, 9, 14, 4); rect(13, -3 - wiggle * 0.15, 9, 14, 4);
  fill(animal.belly); rect(-20, 7, 6, 4, 2); rect(14, 7, 6, 4, 2);

  fill(animal.body); rect(-12, 14, 9, 11, 4); rect(3, 14, 9, 11, 4);
  fill(animal.belly); rect(-11, 21, 8, 4, 2); rect(3, 21, 8, 4, 2);

  fill(animal.body); rect(-19, -31, 38, 29, 10);
  fill('#ffffff42'); rect(-12, -28, 9, 4, 2);

  if (kind === 'frog') {
    fill('#5fba47'); rect(-18, -19, 7, 4, 2); rect(11, -19, 7, 4, 2);
  }
}

function drawCritterFace(kind, animal, blink) {
  if (kind === 'raccoon') {
    fill('#4c4959'); rect(-15, -23, 30, 11, 5);
    fill(animal.belly); rect(-4, -19, 8, 7, 3);
  } else if (kind === 'panda') {
    fill(animal.ear); ellipse(-8, -18, 10, 12); ellipse(8, -18, 10, 12);
  } else if (kind === 'fox') {
    fill('#fff1d7'); rect(-10, -17, 20, 11, 5);
  } else if (kind === 'frog') {
    fill('#f3ffd5'); ellipse(-11, -31, 8, 8); ellipse(11, -31, 8, 8);
  }

  fill('#2f2a45');
  if (blink) {
    rect(-10, -18, 7, 2, 1); rect(4, -18, 7, 2, 1);
  } else if (kind === 'frog') {
    rect(-12, -32, 3, 4, 1); rect(10, -32, 3, 4, 1);
    fill('#ffffff'); rect(-11, -31, 1, 1, 0); rect(11, -31, 1, 1, 0);
  } else {
    rect(-10, -20, 6, 6, 2); rect(4, -20, 6, 6, 2);
    fill('#ffffff'); rect(-8, -19, 2, 2, 1); rect(6, -19, 2, 2, 1);
  }

  fill(animal.cheek || '#ff9fc0'); rect(-15, -12, 6, 4, 2); rect(9, -12, 6, 4, 2);
  fill(kind === 'frog' ? '#4c8f3c' : '#2f2a45');
  rect(-2, -13, 4, 3, 1);
  // Happy pixel smile instead of a neutral ._. mouth.
  rect(-5, -9, 2, 2, 1); rect(-3, -7, 2, 2, 1); rect(-1, -6, 2, 2, 1);
  rect(1, -7, 2, 2, 1); rect(3, -9, 2, 2, 1);

  if (kind === 'cat' || kind === 'fox') {
    stroke('#7a5a58'); strokeWeight(1); line(-13, -12, -20, -14); line(-13, -10, -21, -9); line(13, -12, 20, -14); line(13, -10, 21, -9); noStroke();
  }
}

function drawCritterAccessory(kind, animal, isMe, wiggle) {
  if (kind === 'bunny' || kind === 'panda') {
    fill(animal.accent); rect(10, -36 + wiggle * 0.1, 7, 7, 2); triangle(10, -32, 4, -37, 10, -39); triangle(17, -32, 23, -37, 17, -39);
  } else if (kind === 'cat') {
    fill(animal.accent); rect(-6, -35, 12, 4, 2); rect(-2, -39, 4, 6, 2);
  } else if (kind === 'fox') {
    fill(animal.accent); rect(9, -31, 11, 5, 2); fill('#fff8cf'); rect(17, -33, 3, 3, 1);
  } else if (kind === 'raccoon') {
    fill(animal.accent); rect(-4, -34, 8, 6, 2); rect(-2, -38, 4, 4, 1);
  } else if (kind === 'frog') {
    fill(animal.accent); rect(-2, -41, 4, 9, 2); fill('#ff9fc0'); ellipse(-6, -41, 7, 6); ellipse(6, -41, 7, 6); ellipse(0, -45, 7, 6);
  }

  if (!isMe) return;
  fill('#fff7d8'); rect(-23, -35, 5, 5, 1); rect(20, -32, 4, 4, 1);
}

function drawTinyCrown() {
  fill('#ffdf74'); triangle(-7, -44, -2, -54, 2, -44); triangle(-2, -44, 5, -56, 8, -44); rect(-8, -45, 17, 5, 2);
  fill('#fff2a8'); rect(-1, -50, 3, 3, 1);
}

function drawRaceOver() {
  if (roomState !== 'racing' || local.alive) return;
  const hint = roomCode === 'SOLO' || hostId === meId ? 'Use the restart button to dash again' : 'Waiting for host to restart';
  push(); noStroke(); fill(47, 42, 69, 150); rect(width / 2 - 180, height / 2 - 70, 360, 140, 24); fill('#fff7d8'); textAlign(CENTER); textSize(28); text('Critter bonk!', width / 2, height / 2 - 24); textSize(15); text(`Score ${local.score} • Distance ${Math.floor(local.distance)}`, width / 2, height / 2 + 8); text(hint, width / 2, height / 2 + 34); pop();
}

function updateLobbyUI() {
  if (!ui.lobby) return;
  updateRoundEndUI();
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

function initAudio() {
  if (audio.ctx) return audio.ctx;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) {
    toast('This browser does not support Web Audio.');
    return null;
  }
  const ctx = new AudioCtx();
  audio.ctx = ctx;
  audio.master = ctx.createGain();
  audio.musicGain = ctx.createGain();
  audio.sfxGain = ctx.createGain();
  audio.master.gain.value = 0.55;
  audio.musicGain.gain.value = 0.14;
  audio.sfxGain.gain.value = 0.28;
  audio.musicGain.connect(audio.master);
  audio.sfxGain.connect(audio.master);
  audio.master.connect(ctx.destination);
  return ctx;
}

async function toggleMusic() {
  const ctx = initAudio();
  if (!ctx) return;
  if (ctx.state === 'suspended') await ctx.resume();
  audio.musicOn = !audio.musicOn;
  if (audio.musicOn) {
    startMusicLoop();
    playSparkle([523.25, 659.25, 783.99], 0.04);
    toast('Fruit festival chiptune on! ♪', 1100);
  } else {
    stopMusicLoop();
    toast('Music off', 900);
  }
  updateMusicButton();
}

function updateMusicButton() {
  if (!ui.musicToggle) return;
  ui.musicToggle.classList.toggle('on', audio.musicOn);
  ui.musicToggle.setAttribute('aria-pressed', String(audio.musicOn));
  ui.musicToggle.textContent = audio.musicOn ? '♫ Music on' : '♪ Music';
}

function startMusicLoop() {
  if (audio.scheduler) return;
  const ctx = initAudio();
  if (!ctx) return;
  audio.nextNoteTime = ctx.currentTime + 0.05;
  audio.step = 0;
  audio.scheduler = setInterval(scheduleMusic, 25);
}

function stopMusicLoop() {
  if (audio.scheduler) clearInterval(audio.scheduler);
  audio.scheduler = null;
}

function scheduleMusic() {
  const ctx = audio.ctx;
  if (!ctx || !audio.musicOn) return;
  const tempo = roomState === 'racing' && local.alive ? 156 : 118;
  const stepDur = 60 / tempo / 2;
  while (audio.nextNoteTime < ctx.currentTime + 0.12) {
    const step = audio.step % 32;
    const chordRoot = [261.63, 349.23, 392.0, 329.63][Math.floor(step / 8) % 4];
    const melody = [0, 4, 7, 12, 7, 4, 9, 7, 0, 4, 7, 14, 12, 9, 7, 4, 2, 5, 9, 14, 12, 9, 5, 2, 4, 7, 11, 16, 14, 11, 7, 4];
    const bass = step % 8 === 0 ? chordRoot / 2 : step % 8 === 4 ? chordRoot * 0.75 : null;
    const leadFreq = chordRoot * Math.pow(2, melody[step] / 12);

    if (step % 2 === 0) playTone(leadFreq, audio.nextNoteTime, 0.075, 'square', 0.055, audio.musicGain);
    if (step % 4 === 2) playTone(leadFreq * 1.5, audio.nextNoteTime, 0.045, 'triangle', 0.035, audio.musicGain);
    if (bass) playTone(bass, audio.nextNoteTime, 0.16, 'sawtooth', 0.038, audio.musicGain);
    if (step % 4 === 0) playNoise(audio.nextNoteTime, 0.04, 0.032, 'kick');
    if (step % 8 === 4) playNoise(audio.nextNoteTime, 0.05, 0.026, 'hat');

    flashMusicBeat(step);
    audio.nextNoteTime += stepDur;
    audio.step += 1;
  }
}

function flashMusicBeat(step) {
  if (!ui.musicToggle || step % 4 !== 0) return;
  ui.musicToggle.classList.add('beat');
  clearTimeout(audio.lastBeatFlash);
  audio.lastBeatFlash = setTimeout(() => ui.musicToggle?.classList.remove('beat'), 90);
}

function playTone(freq, when, dur, wave = 'square', volume = 0.05, destination = audio.sfxGain) {
  const ctx = audio.ctx;
  if (!ctx || !destination) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = wave;
  osc.frequency.setValueAtTime(freq, when);
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), when + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  osc.connect(gain);
  gain.connect(destination);
  osc.start(when);
  osc.stop(when + dur + 0.025);
}

function playNoise(when, dur = 0.06, volume = 0.05, flavor = 'hat') {
  const ctx = audio.ctx;
  if (!ctx || !audio.sfxGain) return;
  const bufferSize = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    const decay = 1 - i / bufferSize;
    data[i] = (Math.random() * 2 - 1) * decay * (flavor === 'kick' ? 0.65 : 1);
  }
  const source = ctx.createBufferSource();
  const gain = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  filter.type = flavor === 'kick' ? 'lowpass' : 'highpass';
  filter.frequency.value = flavor === 'kick' ? 180 : 3500;
  gain.gain.setValueAtTime(volume, when);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  source.buffer = buffer;
  source.connect(filter);
  filter.connect(gain);
  gain.connect(flavor === 'kick' ? audio.musicGain : audio.sfxGain);
  source.start(when);
  source.stop(when + dur);
}

function playSparkle(notes = [659.25, 783.99, 987.77], volume = 0.08) {
  const ctx = audio.ctx;
  if (!ctx || ctx.state === 'suspended') return;
  notes.forEach((freq, i) => playTone(freq, ctx.currentTime + i * 0.055, 0.11, 'triangle', volume * (1 - i * 0.14), audio.sfxGain));
}

function playThump() {
  const ctx = audio.ctx;
  if (!ctx || ctx.state === 'suspended') return;
  playTone(110, ctx.currentTime, 0.12, 'sawtooth', 0.08, audio.sfxGain);
  playTone(73.42, ctx.currentTime + 0.05, 0.18, 'triangle', 0.06, audio.sfxGain);
}

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
  if (['m', 'M'].includes(event.key)) { toggleMusic(); event.preventDefault(); }
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
