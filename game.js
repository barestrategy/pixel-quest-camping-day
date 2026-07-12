// Pixel Quest Camping Day — main loop and state machine.
import { W, H, setWorldWidth, loadAssets } from './assets.js';
import { input, initInput, getMove, takeTap, clearFrameFlags, drawJoystick } from './input.js';
import { initItems, enterZone, updateEntities, drawEntities } from './entities.js';
import { ZONE_DEFS, buildZoneLayout, snapshotLayout, moveWithCollision, blockedAt, randomOpenSpot } from './zonegen.js';
import { unlock, setTheme, sfx, toggleMute, isMuted } from './audio.js';

let layouts = {}; // zone key -> generated layout, rebuilt when the world resizes

function getLayout(key) {
  if (!layouts[key]) layouts[key] = buildZoneLayout(key, assets);
  return layouts[key];
}

const muteBtn = () => ({ x: W - 64, y: H - 64, r: 30 });
const startBtnRect = () => ({ x: W / 2 - 150, y: H - 165, w: 300, h: 105 });

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const HERO_HEIGHT = 84;       // on-screen hero height in world px
const PLAYER_SPEED = 220;     // world px / s
const PLAYER_RADIUS = 24;     // collision radius

const view = { scale: 1, ox: 0, oy: 0, dpr: 1 };
let assets = null;

function resize() {
  view.dpr = Math.min(devicePixelRatio || 1, 3);
  canvas.width = Math.round(innerWidth * view.dpr);
  canvas.height = Math.round(innerHeight * view.dpr);
  // world width follows the screen aspect so play fills the whole display
  if (assets) {
    const targetW = Math.max(560, Math.min(1680, Math.round(H * innerWidth / innerHeight)));
    if (Math.abs(targetW - W) / W > 0.05) {
      setWorldWidth(targetW);
      layouts = {};
      clampToWorld();
    }
  }
  view.scale = Math.min(innerWidth / W, innerHeight / H);
  view.ox = (innerWidth - W * view.scale) / 2;
  view.oy = (innerHeight - H * view.scale) / 2;
}
addEventListener('resize', resize);
resize();

function clampToWorld() {
  if (!game.player || state !== 'PLAY') return;
  const layout = getLayout(zoneKey());
  game.player.x = Math.max(30, Math.min(W - 30, game.player.x));
  if (blockedAt(layout, game.player.x, game.player.y, 20)) {
    const pos = randomOpenSpot(layout);
    game.player.x = pos.x; game.player.y = pos.y;
  }
  enterZone(game, layout); // respawn this zone's ants/items inside the new bounds
}

// screen (CSS px) -> world coords
function toWorld(sx, sy) {
  return { x: (sx - view.ox) / view.scale, y: (sy - view.oy) / view.scale };
}

let state = 'LOADING';
let stateTime = 0;

const game = {
  hero: 'pixely',
  score: 0,               // total this run = carried + banked; 15 wins
  carried: 0,             // loose treasure — an ant hit knocks one out
  banked: 0,              // safe in the campsite chest
  wallet: Number(localStorage.getItem('pq-wallet') || 0), // lifetime, for the shop
  hearts: 6,              // half-heart units; 6 = three full hearts
  zone: { x: 1, y: 1 },
  player: { x: W / 2, y: H / 2 + 60, dir: 'down', moving: false, hurtT: 0 },
  best: Number(localStorage.getItem('pq-best') || 0),
  select: { chosen: null },
  inCave: false,
  fade: null,
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

function zoneKey() { return game.inCave ? 'U' : game.zone.x + ',' + game.zone.y; }

// fade-to-black used for cave entrances/exits; action fires at the midpoint
function startFade(action) {
  game.fade = { t: 0, dur: 0.7, action, done: false };
  sfx.whoosh();
}

function showBanner(text) {
  game.banner.text = text;
  game.banner.t = 2.2;
}

function startTransition(dx, dy) {
  game.transition = { dx, dy, t: 0 };
  sfx.whoosh();
}

function setState(s) {
  state = s;
  stateTime = 0;
}

function startGame(hero) {
  game.hero = hero;
  game.score = 0;
  game.carried = 0;
  game.banked = 0;
  game.rested = false;
  game.hearts = 6;
  game.zone = { x: 1, y: 1 };
  game.player.x = W / 2;
  game.player.y = H / 2 + 60;
  game.player.dir = 'down';
  game.player.hurtT = 0;
  game.transition = null;
  game.inCave = false;
  game.fade = null;
  game.visited = new Set(['1,1']);
  game.shake = 0;
  game.flash = 0;
  initItems(game);
  enterZone(game, getLayout('1,1'));
  showBanner(ZONE_DEFS['1,1'].name);
  setTheme('camp');
  setState('PLAY');
}

function endGame(won) {
  game.best = Math.max(game.best, game.score);
  localStorage.setItem('pq-best', String(game.best));
  setTheme(null);
  if (won) sfx.win(); else sfx.die();
  setState(won ? 'WIN' : 'DIED');
}

// ---------- update ----------

function update(dt) {
  stateTime += dt;
  if (input.anyPress) unlock(); // iOS: audio must start from a user gesture
  let tap = takeTap();

  // mute button works in every state
  if (tap) {
    const w = toWorld(tap.x, tap.y);
    const mb = muteBtn();
    if (Math.hypot(w.x - mb.x, w.y - mb.y) < mb.r + 10) {
      toggleMute();
      tap = null;
    }
  }

  if (state === 'TITLE') {
    if (tap) {
      game.select.chosen = null;
      setState('SELECT');
    }
  } else if (state === 'SELECT') {
    if (tap) {
      const w = toWorld(tap.x, tap.y);
      const b = startBtnRect();
      if (game.select.chosen && w.x > b.x && w.x < b.x + b.w && w.y > b.y && w.y < b.y + b.h) {
        startGame(game.select.chosen);
      } else if (w.y > H * 0.16) {
        game.select.chosen = w.x < W / 2 ? 'pixely' : 'emily';
        sfx.pickup();
      }
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

  if (game.fade) {
    const f = game.fade;
    f.t += dt;
    if (!f.done && f.t >= f.dur / 2) { f.done = true; f.action(); }
    if (f.t >= f.dur) game.fade = null;
    return;
  }

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

  const layout = getLayout(zoneKey());
  const mv = getMove();
  p.moving = !!(mv.dx || mv.dy);
  if (p.moving) {
    moveWithCollision(p, mv.dx * PLAYER_SPEED * dt, mv.dy * PLAYER_SPEED * dt, layout, 20);
    // facing follows the dominant axis
    p.dir = Math.abs(mv.dx) > Math.abs(mv.dy) ? (mv.dx > 0 ? 'right' : 'left') : (mv.dy > 0 ? 'down' : 'up');
  }
  if (p.hurtT > 0) p.hurtT -= dt;
  if (game.shake > 0) game.shake -= dt;
  if (game.flash > 0) game.flash -= dt;

  // footstep dust
  if (p.moving) {
    p.dustT = (p.dustT || 0) - dt;
    if (p.dustT <= 0) {
      p.dustT = 0.16;
      game.particles.push({
        x: p.x + (Math.random() - 0.5) * 12, y: p.y + HERO_HEIGHT / 2 - 8,
        vx: (Math.random() - 0.5) * 30, vy: -25, life: 0.35, color: '#cbbb96',
      });
    }
  }

  updateEntities(game, dt, {
    onPickup: () => {
      sfx.pickup();
      game.score = game.carried + game.banked;
      if (game.score >= 15) endGame(true);
    },
    onHeal: () => sfx.heal(),
    onRest: () => sfx.rest(),
    onBank: n => {
      sfx.clink();
      game.wallet += n;
      localStorage.setItem('pq-wallet', String(game.wallet));
    },
    onDropLost: () => {
      game.score = game.carried + game.banked;
      sfx.drop();
    },
    onHurt: () => {
      game.shake = 0.3;
      game.flash = 0.25;
      if (game.hearts <= 0) endGame(false);
      else sfx.hurt();
    },
  }, layout);
  if (state !== 'PLAY') return;

  // cave doorways lead underground; ladders lead back up
  if (!game.inCave && layout.caveDoor && rectHas(layout.caveDoor, p.x, p.y)) {
    const from = zoneKey();
    return startFade(() => {
      game.inCave = true;
      const exit = getLayout('U').exits.find(e => e.to === from) || getLayout('U').exits[0];
      p.x = exit.rect.x + exit.rect.w / 2;
      p.y = exit.rect.y + exit.rect.h + 30;
      onZoneEnter();
    });
  }
  if (game.inCave) {
    for (const exit of layout.exits) {
      if (rectHas(exit.rect, p.x, p.y)) {
        return startFade(() => {
          game.inCave = false;
          const [zx, zy] = exit.to.split(',').map(Number);
          game.zone = { x: zx, y: zy };
          const door = getLayout(exit.to).caveDoor;
          p.x = door.x + door.w / 2;
          p.y = door.y + door.h + 34;
          onZoneEnter();
        });
      }
    }
  }

  // walk off an edge -> slide to the neighboring zone (if there is one)
  if (!game.inCave) {
    if (p.x < PLAYER_RADIUS && game.zone.x > 0) return startTransition(-1, 0);
    if (p.x > W - PLAYER_RADIUS && game.zone.x < 2) return startTransition(1, 0);
    if (p.y < PLAYER_RADIUS && game.zone.y > 0) return startTransition(0, -1);
    if (p.y > H - PLAYER_RADIUS && game.zone.y < 2) return startTransition(0, 1);
  }
  p.x = Math.max(PLAYER_RADIUS, Math.min(W - PLAYER_RADIUS, p.x));
  p.y = Math.max(PLAYER_RADIUS, Math.min(H - PLAYER_RADIUS, p.y));
}

function rectHas(r, x, y) {
  return x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h;
}

function onZoneEnter() {
  const key = zoneKey();
  game.visited.add(key);
  const layout = getLayout(key);
  showBanner(layout.name);
  enterZone(game, layout);
  setTheme(key === 'U' ? 'cave' : key === '1,1' ? 'camp' : 'adventure');
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
    drawMenuScreen('screen-title');
    pulseText('TAP TO START', W / 2, H * 0.72, 40, t);
    drawCenterText('A game by the Pixel Quest kids', W / 2, H - 30, 20, 'rgba(255,255,255,0.75)');
  } else if (state === 'SELECT') {
    drawSelect(t);
  } else if (state === 'PLAY') {
    drawPlay(t);
  } else if (state === 'WIN') {
    drawMenuScreen('screen-win');
    drawCenterText('Best: ' + game.best + ' treasures', W / 2, H * 0.8, 28, '#053305');
    pulseText('TAP TO PLAY AGAIN', W / 2, H * 0.9, 32, t, '#053305');
  } else if (state === 'DIED') {
    drawMenuScreen('screen-died');
    drawCenterText('Treasures found: ' + game.score, W / 2, H * 0.8, 28, '#3a0000');
    pulseText('TAP TO TRY AGAIN', W / 2, H * 0.9, 32, t, '#3a0000');
  }

  if (state !== 'LOADING') drawMuteButton();
  drawJoystick(ctx, view.dpr);
}

function drawMuteButton() {
  const { x, y, r } = muteBtn();
  ctx.save();
  ctx.globalAlpha = 0.8;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff';
  // pixel speaker
  ctx.fillRect(x - 14, y - 6, 8, 12);
  ctx.beginPath();
  ctx.moveTo(x - 6, y - 6); ctx.lineTo(x + 2, y - 13); ctx.lineTo(x + 2, y + 13); ctx.lineTo(x - 6, y + 6);
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 3;
  if (isMuted()) {
    ctx.strokeStyle = '#e8302a';
    ctx.beginPath(); ctx.moveTo(x + 6, y - 8); ctx.lineTo(x + 16, y + 8); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + 16, y - 8); ctx.lineTo(x + 6, y + 8); ctx.stroke();
  } else {
    ctx.beginPath(); ctx.arc(x + 4, y, 8, -0.9, 0.9); ctx.stroke();
    ctx.beginPath(); ctx.arc(x + 4, y, 14, -0.9, 0.9); ctx.stroke();
  }
  ctx.restore();
}

function drawPlay(t) {
  if (game.transition) {
    // slide the old zone out and the new one in
    const tr = game.transition;
    const k = Math.min(1, tr.t / TRANSITION_TIME);
    const e = k * k * (3 - 2 * k); // smoothstep
    const nx = game.zone.x + tr.dx, ny = game.zone.y + tr.dy;
    ctx.drawImage(snapshotLayout(getLayout(zoneKey())), -tr.dx * e * W, -tr.dy * e * H);
    ctx.drawImage(snapshotLayout(getLayout(nx + ',' + ny)), tr.dx * W - tr.dx * e * W, tr.dy * H - tr.dy * e * H);
  } else {
    if (game.shake > 0) {
      ctx.translate((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14);
    }
    const layout = getLayout(zoneKey());
    ctx.drawImage(layout.ground, 0, 0);
    drawEntities(ctx, assets, game, t, layout, () => drawPlayer(t));
    if (game.inCave) { // lantern-light darkness around the hero
      const p = game.player;
      const g = ctx.createRadialGradient(p.x, p.y, 130, p.x, p.y, 420);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(8,5,2,0.82)');
      ctx.fillStyle = g;
      ctx.fillRect(-20, -20, W + 40, H + 40);
    }
    if (game.flash > 0) {
      ctx.fillStyle = 'rgba(232,48,42,' + (game.flash * 1.2) + ')';
      ctx.fillRect(-20, -20, W + 40, H + 40);
    }
  }
  drawHud();
  drawBanner();
  if (game.fade) {
    const f = game.fade;
    const a = 1 - Math.abs(1 - 2 * (f.t / f.dur)); // 0 -> 1 -> 0
    ctx.fillStyle = 'rgba(0,0,0,' + Math.min(1, a * 1.25) + ')';
    ctx.fillRect(-20, -20, W + 40, H + 40);
  }
}

function drawBanner() {
  if (game.banner.t <= 0) return;
  const a = Math.min(1, game.banner.t / 0.5); // fade out over the last half second
  ctx.save();
  ctx.globalAlpha = a;
  drawCenterText(game.banner.text, W / 2, 152, 40, '#ffe9a8');
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
      const cur = !game.inCave && zx === game.zone.x && zy === game.zone.y;
      ctx.fillStyle = cur ? '#ffe14d' : game.visited.has(key) ? 'rgba(180,230,140,0.9)' : 'rgba(255,255,255,0.25)';
      ctx.fillRect(x0 + pad + zx * (cell + gap), y0 + pad + zy * (cell + gap), cell, cell);
    }
  }
  if (game.inCave) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x0, y0 + mw + 4, mw, 22);
    drawCenterText('CAVE', x0 + mw / 2, y0 + mw + 21, 16, '#8adfff');
  }
}

function drawPlayer(t) {
  const p = game.player;
  const key = game.hero + '-' + p.dir;
  const spr = p.moving ? assets.walk[key][Math.floor(t / 130) % 2] : assets.sprites[key];
  const h = HERO_HEIGHT;
  const w = h * (spr.width / spr.height);
  if (p.hurtT > 0 && Math.floor(t / 80) % 2 === 0) ctx.globalAlpha = 0.35; // i-frame blink
  ctx.drawImage(spr, p.x - w / 2, p.y - h / 2, w, h);
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
  // banked treasure marker
  if (game.banked > 0) {
    const chest = assets.props['chest'];
    const chH = 26, chW = chH * (chest.width / chest.height);
    ctx.drawImage(chest, W - 150, 50, chW, chH);
    ctx.font = 'bold 22px "Courier New", monospace';
    ctx.strokeText('x' + game.banked, W - 150 + chW + 6, 70);
    ctx.fillText('x' + game.banked, W - 150 + chW + 6, 70);
  }
  drawMinimap();
}

// Menu art has flat backgrounds: extend the color edge-to-edge, contain-fit the art.
function drawMenuScreen(key) {
  ctx.fillStyle = assets.menuBg[key];
  ctx.fillRect(0, 0, W, H);
  const img = assets.imgs[key];
  const s = Math.min(W / img.naturalWidth, H / img.naturalHeight);
  const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
  ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
}

function drawSelect(t) {
  const chosen = game.select.chosen;
  const strip = H * 0.14;
  // kids' select-screen palette: bright green split panels, black divider, white title strip
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, strip);
  ctx.fillStyle = '#04e360';
  ctx.fillRect(0, strip + 8, W / 2 - 12, H);
  ctx.fillStyle = '#04f04c';
  ctx.fillRect(W / 2 + 12, strip + 8, W / 2 - 12, H);
  drawCenterText('Choose Your Character!', W / 2, strip * 0.68, Math.min(48, W * 0.045), '#111');

  for (const [hero, label, cx] of [['pixely', 'Pixely', W * 0.25], ['emily', 'Emily', W * 0.75]]) {
    const spr = assets.sprites[hero + '-down'];
    const isChosen = chosen === hero;
    const h = isChosen ? 200 : 165;
    const w = h * (spr.width / spr.height);
    const cy = H * 0.52;
    if (isChosen) { // soft highlight pad under the chosen camper
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath();
      ctx.ellipse(cx, cy + h / 2 + 8, w * 0.9, 18, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.drawImage(spr, cx - w / 2, cy - h / 2, w, h);
    // name chip
    ctx.fillStyle = '#fff';
    const chipW = 150, chipY = strip + 24;
    ctx.fillRect(cx - chipW / 2, chipY, chipW, 42);
    drawCenterText(label, cx, chipY + 31, 28, '#111');
    if (isChosen) drawSpeechBubble(`Hi! I'm ${label}!`, cx, cy - h / 2 - 30);
  }

  if (chosen) {
    const b = startBtnRect();
    const spr = assets.sprites['start-button'];
    const pulse = 1 + Math.sin(t * 0.006) * 0.03;
    const bw = b.w * pulse, bh = b.h * pulse;
    ctx.drawImage(spr, b.x + b.w / 2 - bw / 2, b.y + b.h / 2 - bh / 2, bw, bh);
  } else {
    pulseText('Tap a camper!', W / 2, H - 60, 30, t, '#fff');
  }
}

function drawSpeechBubble(text, cx, cy) {
  ctx.font = 'bold 26px "Courier New", monospace';
  const bw = ctx.measureText(text).width + 44;
  const bh = 56;
  const x = Math.max(10, Math.min(W - bw - 10, cx - bw / 2));
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(x, cy - bh, bw, bh, 12);
  ctx.fill(); ctx.stroke();
  ctx.beginPath(); // tail
  ctx.moveTo(cx - 10, cy - 3); ctx.lineTo(cx + 12, cy - 3); ctx.lineTo(cx, cy + 16); ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#111';
  ctx.textAlign = 'center';
  ctx.fillText(text, x + bw / 2, cy - bh / 2 + 9);
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
  resize(); // adopt the real screen aspect now that zones can rebuild
  setState('TITLE');
}).catch(err => {
  console.error(err);
});
requestAnimationFrame(loop);
