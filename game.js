// Pixel Quest Camping Day — main loop and state machine.
import { W, H, loadAssets, ZONE_RECIPES } from './assets.js';
import { input, initInput, getMove, takeTap, clearFrameFlags, drawJoystick } from './input.js';
import { initItems, enterZone, updateEntities, drawEntities } from './entities.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const HERO_HEIGHT = 84;       // on-screen hero height in world px
const PLAYER_SPEED = 220;     // world px / s
const PLAYER_RADIUS = 24;     // collision radius

const view = { scale: 1, ox: 0, oy: 0, dpr: 1 };

function resize() {
  view.dpr = Math.min(devicePixelRatio || 1, 3);
  canvas.width = Math.round(innerWidth * view.dpr);
  canvas.height = Math.round(innerHeight * view.dpr);
  view.scale = Math.min(innerWidth / W, innerHeight / H);
  view.ox = (innerWidth - W * view.scale) / 2;
  view.oy = (innerHeight - H * view.scale) / 2;
}
addEventListener('resize', resize);
resize();

// screen (CSS px) -> world coords
function toWorld(sx, sy) {
  return { x: (sx - view.ox) / view.scale, y: (sy - view.oy) / view.scale };
}

let assets = null;
let state = 'LOADING';
let stateTime = 0;

const game = {
  hero: 'pixely',
  score: 0,
  hearts: 6,              // half-heart units; 6 = three full hearts
  zone: { x: 1, y: 1 },
  player: { x: W / 2, y: H / 2 + 60, dir: 'down', moving: false, hurtT: 0 },
  best: Number(localStorage.getItem('pq-best') || 0),
  banner: { text: '', t: 0 },
  transition: null,       // { dx, dy, t } while sliding between zones
  visited: new Set(['1,1']),
};

window.pq = game; // debug/testing handle
window.pqStart = h => startGame(h);
window.pqState = () => state;
window.pqDebug = () => ({ state, view: { ...view }, joy: { ...input.joy }, taps: input.taps.length });

const TRANSITION_TIME = 0.45;
const EDGE = 8;           // how close to the edge triggers a zone change

function zoneKey() { return game.zone.x + ',' + game.zone.y; }

function showBanner(text) {
  game.banner.text = text;
  game.banner.t = 2.2;
}

function startTransition(dx, dy) {
  game.transition = { dx, dy, t: 0 };
}

function setState(s) {
  state = s;
  stateTime = 0;
}

function startGame(hero) {
  game.hero = hero;
  game.score = 0;
  game.hearts = 6;
  game.zone = { x: 1, y: 1 };
  game.player.x = W / 2;
  game.player.y = H / 2 + 60;
  game.player.dir = 'down';
  game.player.hurtT = 0;
  game.transition = null;
  game.visited = new Set(['1,1']);
  game.shake = 0;
  game.flash = 0;
  initItems(game);
  enterZone(game);
  showBanner(ZONE_RECIPES['1,1'].name);
  setState('PLAY');
}

function endGame(won) {
  game.best = Math.max(game.best, game.score);
  localStorage.setItem('pq-best', String(game.best));
  setState(won ? 'WIN' : 'DIED');
}

// ---------- update ----------

function update(dt) {
  stateTime += dt;
  const tap = takeTap();

  if (state === 'TITLE') {
    if (tap) setState('SELECT');
  } else if (state === 'SELECT') {
    if (tap) {
      const w = toWorld(tap.x, tap.y);
      startGame(w.x < W / 2 ? 'pixely' : 'emily');
    }
  } else if (state === 'PLAY') {
    updatePlay(dt);
  } else if (state === 'WIN' || state === 'DIED') {
    if (tap && stateTime > 0.8) setState('TITLE');
  }
  clearFrameFlags();
}

function updatePlay(dt) {
  const p = game.player;
  if (game.banner.t > 0) game.banner.t -= dt;

  if (game.transition) {
    const tr = game.transition;
    tr.t += dt;
    if (tr.t >= TRANSITION_TIME) {
      game.zone.x += tr.dx;
      game.zone.y += tr.dy;
      game.transition = null;
      // enter from the opposite edge
      if (tr.dx === 1) p.x = PLAYER_RADIUS + EDGE;
      if (tr.dx === -1) p.x = W - PLAYER_RADIUS - EDGE;
      if (tr.dy === 1) p.y = PLAYER_RADIUS + EDGE;
      if (tr.dy === -1) p.y = H - PLAYER_RADIUS - EDGE;
      onZoneEnter();
    }
    return; // world frozen while sliding
  }

  const mv = getMove();
  p.moving = !!(mv.dx || mv.dy);
  if (p.moving) {
    p.x += mv.dx * PLAYER_SPEED * dt;
    p.y += mv.dy * PLAYER_SPEED * dt;
    // facing follows the dominant axis
    p.dir = Math.abs(mv.dx) > Math.abs(mv.dy) ? (mv.dx > 0 ? 'right' : 'left') : (mv.dy > 0 ? 'down' : 'up');
  }
  if (p.hurtT > 0) p.hurtT -= dt;
  if (game.shake > 0) game.shake -= dt;
  if (game.flash > 0) game.flash -= dt;

  updateEntities(game, dt, {
    onPickup: () => {
      if (game.score >= 15) endGame(true);
    },
    onHurt: () => {
      game.shake = 0.3;
      game.flash = 0.25;
      if (game.hearts <= 0) endGame(false);
    },
  });
  if (state !== 'PLAY') return;

  // walk off an edge -> slide to the neighboring zone (if there is one)
  if (p.x < PLAYER_RADIUS && game.zone.x > 0) return startTransition(-1, 0);
  if (p.x > W - PLAYER_RADIUS && game.zone.x < 2) return startTransition(1, 0);
  if (p.y < PLAYER_RADIUS && game.zone.y > 0) return startTransition(0, -1);
  if (p.y > H - PLAYER_RADIUS && game.zone.y < 2) return startTransition(0, 1);
  p.x = Math.max(PLAYER_RADIUS, Math.min(W - PLAYER_RADIUS, p.x));
  p.y = Math.max(PLAYER_RADIUS, Math.min(H - PLAYER_RADIUS, p.y));
}

function onZoneEnter() {
  game.visited.add(zoneKey());
  showBanner(ZONE_RECIPES[zoneKey()].name);
  enterZone(game);
}

// ---------- draw ----------

function draw(t) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#12300a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(view.scale * view.dpr, 0, 0, view.scale * view.dpr, view.ox * view.dpr, view.oy * view.dpr);
  ctx.imageSmoothingEnabled = false;

  if (state === 'LOADING') {
    drawCenterText('Loading…', W / 2, H / 2, 36, '#cfe8b0');
  } else if (state === 'TITLE') {
    ctx.drawImage(assets.imgs['screen-title'], 0, 0, W, H);
    pulseText('TAP TO START', W / 2, H * 0.72, 40, t);
    drawCenterText('A game by the Pixel Quest kids', W / 2, H - 30, 20, 'rgba(255,255,255,0.75)');
  } else if (state === 'SELECT') {
    ctx.drawImage(assets.imgs['hero-select'], 0, 0, W, H);
    drawHeroCard('pixely', W * 0.25, t);
    drawHeroCard('emily', W * 0.75, t);
  } else if (state === 'PLAY') {
    drawPlay(t);
  } else if (state === 'WIN') {
    ctx.drawImage(assets.imgs['screen-win'], 0, 0, W, H);
    drawCenterText('Best: ' + game.best + ' treasures', W / 2, H * 0.72, 28, '#053305');
    pulseText('TAP TO PLAY AGAIN', W / 2, H * 0.85, 32, t, '#053305');
  } else if (state === 'DIED') {
    ctx.drawImage(assets.imgs['screen-died'], 0, 0, W, H);
    drawCenterText('Treasures found: ' + game.score, W / 2, H * 0.72, 28, '#3a0000');
    pulseText('TAP TO TRY AGAIN', W / 2, H * 0.85, 32, t, '#3a0000');
  }

  drawJoystick(ctx, view.dpr);
}

function drawPlay(t) {
  if (game.transition) {
    // slide the old zone out and the new one in
    const tr = game.transition;
    const k = Math.min(1, tr.t / TRANSITION_TIME);
    const e = k * k * (3 - 2 * k); // smoothstep
    const nx = game.zone.x + tr.dx, ny = game.zone.y + tr.dy;
    ctx.drawImage(assets.zones[zoneKey()], -tr.dx * e * W, -tr.dy * e * H);
    ctx.drawImage(assets.zones[nx + ',' + ny], tr.dx * W - tr.dx * e * W, tr.dy * H - tr.dy * e * H);
  } else {
    if (game.shake > 0) {
      ctx.translate((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14);
    }
    ctx.drawImage(assets.zones[zoneKey()], 0, 0);
    drawEntities(ctx, assets, game, t);
    drawPlayer(t);
    if (game.flash > 0) {
      ctx.fillStyle = 'rgba(232,48,42,' + (game.flash * 1.2) + ')';
      ctx.fillRect(-20, -20, W + 40, H + 40);
    }
  }
  drawHud();
  drawBanner();
}

function drawBanner() {
  if (game.banner.t <= 0) return;
  const a = Math.min(1, game.banner.t / 0.5); // fade out over the last half second
  ctx.save();
  ctx.globalAlpha = a;
  drawCenterText(game.banner.text, W / 2, 100, 40, '#ffe9a8');
  ctx.restore();
}

function drawMinimap() {
  const cell = 16, gap = 3, pad = 6;
  const mw = 3 * cell + 2 * gap + pad * 2;
  const x0 = W / 2 - mw / 2, y0 = 12;
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillRect(x0, y0, mw, mw);
  for (let zy = 0; zy < 3; zy++) {
    for (let zx = 0; zx < 3; zx++) {
      const key = zx + ',' + zy;
      const cur = zx === game.zone.x && zy === game.zone.y;
      ctx.fillStyle = cur ? '#ffe14d' : game.visited.has(key) ? 'rgba(180,230,140,0.9)' : 'rgba(255,255,255,0.25)';
      ctx.fillRect(x0 + pad + zx * (cell + gap), y0 + pad + zy * (cell + gap), cell, cell);
    }
  }
}

function drawPlayer(t) {
  const p = game.player;
  const spr = assets.sprites[game.hero + '-' + p.dir];
  const h = HERO_HEIGHT;
  const w = h * (spr.width / spr.height);
  const bob = p.moving ? Math.sin(t * 0.014) * 3 : 0;
  if (p.hurtT > 0 && Math.floor(t / 80) % 2 === 0) ctx.globalAlpha = 0.35; // i-frame blink
  ctx.drawImage(spr, p.x - w / 2, p.y - h / 2 + bob, w, h);
  ctx.globalAlpha = 1;
}

// Hearts: 6 half-units drawn as 3 pixel-art hearts.
const HEART = [
  '0110110',
  '1111111',
  '1111111',
  '0111110',
  '0011100',
  '0001000',
];
function drawHeart(x, y, fill, px) {
  for (let r = 0; r < HEART.length; r++) {
    for (let c = 0; c < 7; c++) {
      if (HEART[r][c] === '1') {
        const full = fill >= 1 || (fill >= 0.5 && c < 3.5);
        ctx.fillStyle = full ? '#e8302a' : 'rgba(0,0,0,0.35)';
        ctx.fillRect(x + c * px, y + r * px, px, px);
      }
    }
  }
}

function drawHud() {
  const px = 6;
  for (let i = 0; i < 3; i++) {
    const units = Math.max(0, Math.min(2, game.hearts - i * 2)); // 0, 1 or 2 half-units
    drawHeart(16 + i * (7 * px + 10), 14, units / 2, px);
  }
  // score with coin icon
  const coin = assets.sprites['coin'];
  const ch = 34, cw = ch * (coin.width / coin.height);
  ctx.drawImage(coin, W - 150, 12, cw, ch);
  ctx.font = 'bold 30px "Courier New", monospace';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.lineWidth = 5;
  const scoreText = game.score + '/15';
  ctx.strokeText(scoreText, W - 150 + cw + 8, 12 + ch - 8);
  ctx.fillText(scoreText, W - 150 + cw + 8, 12 + ch - 8);
  drawMinimap();
}

function drawHeroCard(hero, cx, t) {
  const spr = assets.sprites[hero + '-down'];
  const h = 260 + Math.sin(t * 0.004 + (hero === 'emily' ? 2 : 0)) * 8;
  const w = h * (spr.width / spr.height);
  ctx.drawImage(spr, cx - w / 2, H * 0.55 - h / 2, w, h);
}

function drawCenterText(text, x, y, size, color = '#fff') {
  ctx.font = 'bold ' + size + 'px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = Math.max(3, size / 8);
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function pulseText(text, x, y, size, t, color = '#fff') {
  ctx.save();
  ctx.globalAlpha = 0.65 + Math.sin(t * 0.005) * 0.35;
  drawCenterText(text, x, y, size, color);
  ctx.restore();
}

// ---------- boot ----------

initInput(canvas);
let last = 0;
function loop(t) {
  const dt = Math.min(0.05, (t - last) / 1000 || 0.016);
  last = t;
  // some embedded/mobile browsers settle the viewport without firing resize
  if (canvas.width !== Math.round(innerWidth * Math.min(devicePixelRatio || 1, 3)) ||
      canvas.height !== Math.round(innerHeight * Math.min(devicePixelRatio || 1, 3))) {
    resize();
  }
  update(dt);
  draw(t);
  requestAnimationFrame(loop);
}

loadAssets().then(a => {
  assets = a;
  setState('TITLE');
}).catch(err => {
  console.error(err);
});
requestAnimationFrame(loop);
