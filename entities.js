// Collectibles, ants, particles, floating text — collision-aware, y-sorted.
import { W, H } from './assets.js';
import { blockedAt, moveWithCollision, randomOpenSpot } from './zonegen.js';

const ITEM_RADIUS = 26;
const ANT_SIZE = 52;          // regular ant height in world px
const QUEEN_SIZE = 110;
const ANT_WANDER_SPEED = 90;
const ANT_CHASE_SPEED = 150;  // slower than the player's 220 so escape is possible
const QUEEN_CHASE_SPEED = 195;
const ANT_AGGRO = 220;
const QUEEN_AGGRO = 320;
const QUEEN_ZONE = '1,0';
const SAFE_ZONE = '1,1';

export const OUTER_ZONES = ['0,0', '1,0', '2,0', '0,1', '2,1', '0,2', '1,2', '2,2'];

// deterministic ant count per zone (queen zone gets the queen + 1)
const ANT_COUNTS = { '0,0': 2, '1,0': 1, '2,0': 3, '0,1': 1, '2,1': 2, '0,2': 3, '1,2': 2, '2,2': 3 };

const rand = (a, b) => a + Math.random() * (b - a);

// Current collectible type from the score, exactly like the Scratch tiers.
export function itemType(score) {
  return score < 5 ? 'coin' : score < 10 ? 'gem' : 'mushroom';
}

// ---- world init / zone entry ----

export function initItems(game) {
  // positions are assigned lazily, on first entry into each zone
  game.items = OUTER_ZONES.map(z => ({ zone: z, x: 0, y: 0, placed: false }));
  game.drops = [];
  game.particles = [];
  game.floats = [];
  game.ants = [];
}

export function enterZone(game, layout) {
  const key = game.zone.x + ',' + game.zone.y;
  const p = game.player;
  game.ants = [];
  game.drops = [];
  game.particles = [];
  game.floats = [];
  for (const item of game.items) {
    if (item.zone !== key) continue;
    if (!item.placed || blockedAt(layout, item.x, item.y, 20)) {
      const pos = randomOpenSpot(layout, 50, p, 220);
      item.x = pos.x; item.y = pos.y; item.placed = true;
    }
  }
  if (key === SAFE_ZONE) return;
  const n = ANT_COUNTS[key] || 2;
  for (let i = 0; i < n; i++) {
    const pos = randomOpenSpot(layout, 60, p, 280);
    game.ants.push({ x: pos.x, y: pos.y, heading: rand(0, Math.PI * 2), turnT: rand(0.6, 2), queen: false });
  }
  if (key === QUEEN_ZONE) {
    const pos = randomOpenSpot(layout, 80, p, 340);
    game.ants.push({ x: pos.x, y: pos.y, heading: rand(0, Math.PI * 2), turnT: 1, queen: true });
  }
}

// ---- update ----

export function updateEntities(game, dt, events, layout) {
  const key = game.zone.x + ',' + game.zone.y;
  const p = game.player;

  // collectibles in this zone
  for (const item of game.items) {
    if (item.zone !== key || !item.placed) continue;
    if (Math.hypot(item.x - p.x, item.y - p.y) < ITEM_RADIUS + 26) {
      game.score++;
      events.onPickup(item.x, item.y);
      burst(game, item.x, item.y, '#ffd94d', 12);
      game.floats.push({ x: item.x, y: item.y - 20, text: '+1', life: 0.9 });
      // the treasure pops away to a random spot in a random outer zone
      item.zone = OUTER_ZONES[Math.floor(Math.random() * OUTER_ZONES.length)];
      item.placed = false;
      if (item.zone === key) {
        const pos = randomOpenSpot(layout, 50, p, 200);
        item.x = pos.x; item.y = pos.y; item.placed = true;
      }
    }
  }

  // ants
  for (const a of game.ants) {
    const chaseSpeed = a.queen ? QUEEN_CHASE_SPEED : ANT_CHASE_SPEED;
    const aggro = a.queen ? QUEEN_AGGRO : ANT_AGGRO;
    const size = a.queen ? QUEEN_SIZE : ANT_SIZE;
    const dx = p.x - a.x, dy = p.y - a.y;
    const dist = Math.hypot(dx, dy);
    let speed = ANT_WANDER_SPEED;
    if (dist < aggro) {
      a.heading = Math.atan2(dy, dx); // spotted you — chase!
      speed = chaseSpeed;
      a.chasing = true;
    } else {
      a.chasing = false;
      a.turnT -= dt;
      if (a.turnT <= 0) { a.heading = rand(0, Math.PI * 2); a.turnT = rand(0.6, 2); }
    }
    const r = size * 0.3;
    const hit = moveWithCollision(a, Math.cos(a.heading) * speed * dt, Math.sin(a.heading) * speed * dt, layout, r);
    if (hit.hitX) a.heading = Math.PI - a.heading;
    if (hit.hitY) a.heading = -a.heading;
    a.x = Math.max(r, Math.min(W - r, a.x));
    a.y = Math.max(r, Math.min(H - r, a.y));

    // contact damage
    if (p.hurtT <= 0 && dist < size / 2 + 22) {
      game.hearts--;
      p.hurtT = 1;
      // knockback away from the ant (skip if a wall is in the way)
      const ka = dist > 4 ? Math.atan2(-dy, -dx) : rand(0, Math.PI * 2);
      for (const kd of [80, 40]) {
        const nx = p.x + Math.cos(ka) * kd, ny = p.y + Math.sin(ka) * kd;
        if (nx > 30 && nx < W - 30 && ny > 30 && ny < H - 30 && !blockedAt(layout, nx, ny, 20)) {
          p.x = nx; p.y = ny;
          break;
        }
      }
      burst(game, p.x, p.y, '#e8302a', 10);
      events.onHurt();
    }
  }

  // particles & floats
  for (const pt of game.particles) {
    pt.x += pt.vx * dt; pt.y += pt.vy * dt;
    pt.vy += 300 * dt;
    pt.life -= dt;
  }
  game.particles = game.particles.filter(pt => pt.life > 0);
  for (const f of game.floats) { f.y -= 50 * dt; f.life -= dt; }
  game.floats = game.floats.filter(f => f.life > 0);
}

function burst(game, x, y, color, n) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2), s = rand(60, 220);
    game.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 80, life: rand(0.3, 0.7), color });
  }
}

// ---- draw ----

let antSprite = null; // darkened queen-ant, built once

function getAntSprite(assets) {
  if (antSprite) return antSprite;
  const src = assets.sprites['queen-ant'];
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const cx = c.getContext('2d');
  cx.drawImage(src, 0, 0);
  cx.globalCompositeOperation = 'source-atop';
  cx.fillStyle = 'rgba(30,20,10,0.45)';
  cx.fillRect(0, 0, c.width, c.height);
  antSprite = c;
  return c;
}

// Everything in the zone drawn back-to-front by baseY (painter's algorithm).
export function drawEntities(ctx, assets, game, t, layout, drawPlayerFn) {
  const key = game.zone.x + ',' + game.zone.y;
  const drawables = [];

  for (const p of layout.props) drawables.push({ baseY: p.baseY, draw: () => ctx.drawImage(p.img, p.x, p.y, p.w, p.h) });

  for (const item of game.items) {
    if (item.zone !== key || !item.placed) continue;
    drawables.push({ baseY: item.y + 22, draw: () => drawItem(ctx, assets, game, item, t) });
  }

  for (const a of game.ants) {
    drawables.push({ baseY: a.y + (a.queen ? QUEEN_SIZE : ANT_SIZE) / 2, draw: () => drawAnt(ctx, assets, a, t) });
  }

  drawables.push({ baseY: game.player.y + 38, draw: drawPlayerFn });

  drawables.sort((a, b) => a.baseY - b.baseY);
  for (const d of drawables) d.draw();

  for (const pt of game.particles) {
    ctx.globalAlpha = Math.max(0, Math.min(1, pt.life * 2));
    ctx.fillStyle = pt.color;
    ctx.fillRect(pt.x - 3, pt.y - 3, 6, 6);
  }
  ctx.globalAlpha = 1;

  for (const f of game.floats) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, f.life * 2);
    ctx.font = 'bold 30px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 4;
    ctx.strokeText(f.text, f.x, f.y);
    ctx.fillStyle = '#ffe14d';
    ctx.fillText(f.text, f.x, f.y);
    ctx.restore();
  }
}

function drawItem(ctx, assets, game, item, t) {
  const spr = assets.sprites[itemType(game.score)];
  const h = 46, w = h * (spr.width / spr.height);
  const bob = Math.sin(t * 0.004 + item.x) * 5;
  ctx.drawImage(spr, item.x - w / 2, item.y - h / 2 + bob, w, h);
  const sp = (t * 0.003 + item.x * 0.1) % 1;
  if (sp < 0.35) {
    ctx.save();
    ctx.globalAlpha = 1 - sp / 0.35;
    ctx.fillStyle = '#fff';
    const sx = item.x + Math.sin(item.x + t * 0.001) * 18, sy = item.y - 20 + bob;
    ctx.fillRect(sx - 1.5, sy - 6, 3, 12);
    ctx.fillRect(sx - 6, sy - 1.5, 12, 3);
    ctx.restore();
  }
}

function drawAnt(ctx, assets, a, t) {
  const spr = a.queen ? assets.sprites['queen-ant'] : getAntSprite(assets);
  const h = a.queen ? QUEEN_SIZE : ANT_SIZE;
  const w = h * (spr.width / spr.height);
  const scurry = a.chasing ? Math.sin(t * 0.03) * 3 : 0;
  const flip = Math.cos(a.heading) < 0;
  ctx.save();
  ctx.translate(a.x, a.y + scurry);
  if (flip) ctx.scale(-1, 1);
  ctx.drawImage(spr, -w / 2, -h / 2, w, h);
  ctx.restore();
  if (a.chasing) { // alert marker
    ctx.font = 'bold 26px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#e8302a';
    ctx.fillText('!', a.x, a.y - h / 2 - 6);
  }
}
