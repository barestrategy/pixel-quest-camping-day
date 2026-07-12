// Pixel Quest Camping Day — main loop and state machine.
import { W, H, loadAssets, ZONE_RECIPES } from './assets.js';
import { input, initInput, getMove, takeTap, clearFrameFlags, drawJoystick } from './input.js';

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
};

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
  setState('PLAY');
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
  const mv = getMove();
  p.moving = !!(mv.dx || mv.dy);
  if (p.moving) {
    p.x += mv.dx * PLAYER_SPEED * dt;
    p.y += mv.dy * PLAYER_SPEED * dt;
    // facing follows the dominant axis
    p.dir = Math.abs(mv.dx) > Math.abs(mv.dy) ? (mv.dx > 0 ? 'right' : 'left') : (mv.dy > 0 ? 'down' : 'up');
  }
  if (p.hurtT > 0) p.hurtT -= dt;
  // Phase 1: clamp to the screen. Zone transitions arrive in Phase 2.
  p.x = Math.max(PLAYER_RADIUS, Math.min(W - PLAYER_RADIUS, p.x));
  p.y = Math.max(PLAYER_RADIUS, Math.min(H - PLAYER_RADIUS, p.y));
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
  const zoneKey = game.zone.x + ',' + game.zone.y;
  ctx.drawImage(assets.zones[zoneKey], 0, 0);
  drawPlayer(t);
  drawHud();
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
