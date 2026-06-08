import assert from 'node:assert/strict';
import { buildServer } from '../server/server.js';

class TestSocket {
  constructor(url) {
    this.queue = [];
    this.waiters = [];
    this.ws = new WebSocket(url);
    this.opened = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('WebSocket open timeout')), 1500);
      this.ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
    this.ws.addEventListener('message', (event) => {
      const msg = JSON.parse(String(event.data));
      const index = this.waiters.findIndex((w) => w.type === msg.type && w.predicate(msg));
      if (index >= 0) {
        const [waiter] = this.waiters.splice(index, 1);
        clearTimeout(waiter.timer);
        waiter.resolve(msg);
      } else {
        this.queue.push(msg);
      }
    });
  }

  async send(payload) {
    await this.opened;
    this.ws.send(JSON.stringify(payload));
  }

  waitFor(type, timeoutMs = 2000, predicate = () => true) {
    const queuedIndex = this.queue.findIndex((msg) => msg.type === type && predicate(msg));
    if (queuedIndex >= 0) {
      const [msg] = this.queue.splice(queuedIndex, 1);
      return Promise.resolve(msg);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.waiters.findIndex((w) => w.resolve === resolve);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new Error(`Timed out waiting for ${type}; queued=${this.queue.map((m) => m.type).join(',')}`));
      }, timeoutMs);
      this.waiters.push({ type, predicate, resolve, reject, timer });
    });
  }

  close() {
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) this.ws.close();
  }
}

const { httpServer, wss } = buildServer();
await new Promise((resolve) => httpServer.listen(0, resolve));
const { port } = httpServer.address();
const httpUrl = `http://127.0.0.1:${port}`;
const wsUrl = `ws://127.0.0.1:${port}`;
let a;
let b;

try {
  const page = await fetch(httpUrl + '/');
  assert.equal(page.status, 200, 'index.html should be served');
  const html = await page.text();
  assert.match(html, /Pixel Critter Dash/);
  assert.match(html, /Restart round/, 'after-round restart button should be served');
  assert.match(html, /Power-ups/, 'help card should explain the new power-ups');
  assert.match(html, /🍓 magnet, 🧁 float/, 'help card should list the added power-ups');
  assert.match(html, /Festival Frenzies/, 'help card should explain special festival events');
  assert.match(html, /Melon Roll/, 'help card should mention the giant melon event');

  const gameJs = await (await fetch(httpUrl + '/game.js')).text();
  assert.match(gameJs, /SLIDE_CLEAR_DISTANCE/, 'slide obstacles should include distance-based forgiveness');
  assert.match(gameJs, /function isSlideObstacleCleared/, 'slide obstacle safety should be centralized and testable');
  assert.match(gameJs, /const PASS_THROUGH_STRUCTURES/, 'dash-through platforms, ladders, and elevation should be generated');
  assert.match(gameJs, /const FESTIVAL_FRENZIES/, 'special festival events should be defined');
  assert.match(gameJs, /melonRoll/, 'Giant Melon Roll frenzy should exist');
  assert.match(gameJs, /function buildFestivalEvents/, 'festival events should be generated into the track');
  assert.match(gameJs, /function checkFestivalEvents/, 'festival event lifecycle should be updated during races');
  assert.match(gameJs, /function checkFestivalCollisions/, 'festival events should have their own collision checks');
  assert.match(gameJs, /function drawMelonRollFrenzy/, 'Giant Melon Roll should have a custom visual renderer');
  assert.match(gameJs, /Festival Frenzy/, 'festival events should announce themselves to the player');
  assert.match(gameJs, /Melon dodged/, 'surviving a festival event should award a bonus');
  assert.match(gameJs, /const POWER_UPS/, 'helpful collectible power-ups should be defined');
  assert.match(gameJs, /pineappleDash/, 'Pineapple Dash power-up should exist');
  assert.match(gameJs, /coconutShield/, 'Coconut Shield power-up should exist');
  assert.match(gameJs, /berryMagnet/, 'Berry Magnet power-up should exist');
  assert.match(gameJs, /cupcakeFloat/, 'Cupcake Float power-up should exist');
  assert.match(gameJs, /floatGrace/, 'Cupcake Float should have a timed obstacle-forgiveness state');
  assert.match(gameJs, /Mango Combo/, 'mango pickup should have a distinct score-combo identity');
  assert.match(gameJs, /function applyMangoCombo/, 'mango pickup should use a score-combo effect instead of defensive obstacle clearing');
  assert.match(gameJs, /bonusScore/, 'mango combo bonus should persist in the score formula');
  assert.doesNotMatch(gameJs, /Mango shield/i, 'mango pickup should not duplicate the Coconut Shield effect');
  assert.doesNotMatch(gameJs, /clearNearestLaneObstacle|MANGO_BLOOM|Cleared the/, 'mango pickup should not clear/block obstacles like a shield');
  const gameConst = (name) => Number(gameJs.match(new RegExp(`const ${name} = (-?\\d+(?:\\.\\d+)?)`))?.[1]);
  assert.ok(gameConst('JUMP_DURATION') >= 1.22, 'jump airtime should be forgiving for depth-perception ambiguity');
  assert.equal(gameConst('SLIDE_DURATION'), 1.24, 'slide duration should match the forgiving jump duration');
  assert.ok(gameConst('JUMP_CLEAR_DISTANCE') >= 520, 'early jump clear distance should be generous');
  assert.ok(gameConst('SLIDE_CLEAR_DISTANCE') >= 460, 'early slide clear distance should be generous');
  assert.ok(gameConst('LANE_COLLISION_TOLERANCE') <= 0.26, 'lane collision tolerance should be narrow while changing lanes');

  const health = await fetch(httpUrl + '/health');
  assert.equal(health.status, 200, 'health endpoint should respond');
  assert.deepEqual(await health.json(), { ok: true, service: 'pixel-critter-dash' });

  a = new TestSocket(wsUrl);
  b = new TestSocket(wsUrl);
  await Promise.all([a.opened, b.opened]);
  const helloA = await a.waitFor('hello');
  const helloB = await b.waitFor('hello');
  assert.notEqual(helloA.playerId, helloB.playerId);

  await a.send({ type: 'createRoom', name: 'Emily', animal: 'fox' });
  const created = await a.waitFor('roomCreated');
  assert.match(created.room.code, /^[A-Z]+-\d{3}$/);
  assert.equal(created.room.players.length, 1);
  assert.equal(created.room.players[0].name, 'Emily');

  await b.send({ type: 'joinRoom', roomCode: created.room.code, name: 'Mango', animal: 'bunny' });
  const joined = await b.waitFor('roomJoined');
  assert.equal(joined.room.code, created.room.code);
  assert.equal(joined.room.players.length, 2);

  await a.send({ type: 'startRace' });
  const started = await b.waitFor('raceStarted');
  assert.ok(started.seed.includes(created.room.code));

  await b.send({ type: 'playerState', state: { lane: 2, targetLane: 2, distance: 123, score: 99, alive: true } });
  const snapshot = await a.waitFor('snapshot', 2000, (msg) => {
    const mango = msg.room.players.find((p) => p.name === 'Mango');
    return mango && mango.score === 99;
  });
  const mango = snapshot.room.players.find((p) => p.name === 'Mango');
  assert.ok(mango, 'Mango player should appear in snapshot');
  assert.equal(mango.lane, 2);
  assert.equal(mango.score, 99);

  console.log('Smoke test passed: static client, room create/join, race start, and state sync all work.');
} finally {
  a?.close();
  b?.close();
  for (const client of wss.clients) client.terminate();
  await new Promise((resolve) => wss.close(resolve));
  await new Promise((resolve) => httpServer.close(resolve));
}
