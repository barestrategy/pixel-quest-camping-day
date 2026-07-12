// Collectibles, ants, particles, floating text.
import { W, H } from './assets.js';

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

// deterministic ant count per zone (1-3, queen zone gets the queen + 1)
const ANT_COUNTS = { '0,0': 2, '1,0': 1, '2,0': 3, '0,1': 1, '2,1': 2, '0,2': 3, '1,2': 2, '2,2': 3 };

const rand = (a, b) => a + Math.random() * (b - a);

function randPos(margin = 90) {
  return { x: rand(margin, W - margin), y: rand(margin + 60, H - margin) }; // extra top margin keeps HUD clear
}

function awayFrom(pos, px, py, minDist) {
  let p = pos, tries = 0;
  while (Math.hypot(p.x - px, p.y - py) < minDist && tries++ < 20) p = randPos();
  return p;
}

// Current collectible type from the score, exactly like the Scratch tiers.
export function itemType(score) {
  return score < 5 ? 'coin' : score < 10 ? 'gem' : 'mushroom';
}

// ---- world init / zone entry ----

export function initItems(game) {
  game.items = OUTER_ZONES.map(z => ({ zone: z, ...randPos() }));
  game.particles = [];
  game.floats = [];
  game.ants = [];
}

export function enterZone(game) {
  const key = game.zone.x + ',' + game.zone.y;
  const p = game.player;
  game.ants = [];
  game.particles = [];
  game.floats = [];
  if (key === SAFE_ZONE) return;
  const n = ANT_COUNTS[key] || 2;
  for (let i = 0; i < n; i++) {
    const pos = awayFrom(randPos(), p.x, p.y, 260);
    game.ants.push({
      x: pos.x, y: pos.y,
      heading: rand(0, Math.PI * 2),
      turnT: rand(0.6, 2),
      queen: false,
    });
  }
  if (key === QUEEN_ZONE) {
    const pos = awayFrom(randPos(), p.x, p.y, 320);
    game.ants.push({ x: pos.x, y: pos.y, heading: rand(0, Math.PI * 2), turnT: 1, queen: true });
  }
}

// ---- update ----

export function updateEntities(game, dt, events) {
  const key = game.zone.x + ',' + game.zone.y;
  const p = game.player;

  // collectibles in this zone
  for (const item of game.items) {
    if (item.zone !== key) continue;
    if (Math.hypot(item.x - p.x, item.y - p.y) < ITEM_RADIUS + 26) {
      game.score++;
      events.onPickup(item.x, item.y);
      burst(game, item.x, item.y, '#ffd94d', 12);
      game.floats.push({ x: item.x, y: item.y - 20, text: '+1', life: 0.9 });
      // the treasure pops away to a random spot in a random outer zone
      const zone = OUTER_ZONES[Math.floor(Math.random() * OUTER_ZONES.length)];
      const pos = zone === key ? awayFrom(randPos(), p.x, p.y, 200) : randPos();
      item.zone = zone; item.x = pos.x; item.y = pos.y;
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
    a.x += Math.cos(a.heading) * speed * dt;
    a.y += Math.sin(a.heading) * speed * dt;
    // bounce off edges (Scratch "if on edge, bounce")
    const m = size / 2;
    if (a.x < m || a.x > W - m) { a.heading = Math.PI - a.heading; a.x = Math.max(m, Math.min(W - m, a.x)); }
    if (a.y < m || a.y > H - m) { a.heading = -a.heading; a.y = Math.max(m, Math.min(H - m, a.y)); }

    // contact damage
    if (p.hurtT <= 0 && dist < m + 22) {
      game.hearts--;
      p.hurtT = 1;
      // knockback away from the ant (random direction if dead-centered)
      const ka = dist > 4 ? Math.atan2(-dy, -dx) : rand(0, Math.PI * 2);
      p.x = Math.max(30, Math.min(W - 30, p.x + Math.cos(ka) * 80));
      p.y = Math.max(30, Math.min(H - 30, p.y + Math.sin(ka) * 80));
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

export function drawEntities(ctx, assets, game, t) {
  const key = game.zone.x + ',' + game.zone.y;

  for (const item of game.items) {
    if (item.zone !== key) continue;
    const spr = assets.sprites[itemType(game.score)];
    const h = 46, w = h * (spr.width / spr.height);
    const bob = Math.sin(t * 0.004 + item.x) * 5;
    ctx.drawImage(spr, item.x - w / 2, item.y - h / 2 + bob, w, h);
    // sparkle
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

  for (const a of game.ants) {
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
