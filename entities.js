// Collectibles, ants, particles, floating text — collision-aware, y-sorted.
import { W, H } from './assets.js';
import { blockedAt, moveWithCollision, randomOpenSpot, findOpenNear } from './zonegen.js';

const ITEM_RADIUS = 26;
const ANT_SIZE = 52;          // regular ant height in world px
const QUEEN_SIZE = 110;
// v3: the world is meaner — more, faster, more-alert ants (player speed is 220)
const ANT_WANDER_SPEED = 105;
const ANT_CHASE_SPEED = 175;  // still under the player's 220 so escape stays possible
const QUEEN_CHASE_SPEED = 215;
const ANT_AGGRO = 260;
const QUEEN_AGGRO = 320;
const QUEEN_ZONE = '1,0';
const SAFE_ZONE = '1,1';

export const OUTER_ZONES = ['0,0', '1,0', '2,0', '0,1', '2,1', '0,2', '1,2', '2,2'];

// The 7 zones (all but the campsite and the cave-entrance zone) each hide a key:
// bonk every ant in the zone and a key-chest appears.
export const KEY_ZONES = ['0,0', '2,0', '0,1', '2,1', '0,2', '1,2', '2,2'];
export const TOTAL_KEYS = KEY_ZONES.length;

// deterministic ant count per zone (~+1 vs v2; queen zone gets the queen too)
const ANT_COUNTS = { '0,0': 3, '1,0': 2, '2,0': 4, '0,1': 2, '2,1': 3, '0,2': 4, '1,2': 3, '2,2': 4, 'U': 2 };

const rand = (a, b) => a + Math.random() * (b - a);
const keyOf = g => g.inCave ? 'U' : g.zone.x + ',' + g.zone.y;
const rectHas = (r, x, y) => x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h;

// Current collectible type from the score, exactly like the Scratch tiers.
export function itemType(score) {
  return score < 5 ? 'coin' : score < 10 ? 'gem' : 'mushroom';
}

// ---- world init / zone entry ----

export function initItems(game) {
  // positions are assigned lazily, on first entry into each zone
  game.items = OUTER_ZONES.map(z => ({ zone: z, x: 0, y: 0, placed: false }));
  // tunnel treasure: three collectible crystals glinting in the dark
  for (let i = 0; i < 3; i++) game.items.push({ zone: 'U', x: 0, y: 0, placed: false });
  game.drops = [];
  game.keyChests = [];   // key-chests spawned by clearing a zone; persist until grabbed
  game.particles = [];
  game.floats = [];
  game.ants = [];
}

export function enterZone(game, layout) {
  const key = keyOf(game);
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
  // a cleared zone stays peaceful — no ants respawn once you've won its key
  if (key === SAFE_ZONE || (game.clearedZones && game.clearedZones.has(key))) return;
  const n = ANT_COUNTS[key] || 2;
  for (let i = 0; i < n; i++) {
    const pos = randomOpenSpot(layout, 60, p, 280);
    game.ants.push({ x: pos.x, y: pos.y, heading: rand(0, Math.PI * 2), turnT: rand(0.6, 2), queen: false });
  }
  if (key === QUEEN_ZONE && !game.queenDown) {
    const pos = randomOpenSpot(layout, 80, p, 340);
    game.ants.push({ x: pos.x, y: pos.y, heading: rand(0, Math.PI * 2), turnT: 1, queen: true, hp: 5, state: 'wander', stateT: 0 });
  }
}

// A zone is cleared the instant its last non-queen ant is down; drop a key-chest.
function checkZoneCleared(game, layout, events) {
  const key = keyOf(game);
  if (!KEY_ZONES.includes(key) || game.clearedZones.has(key)) return;
  if (game.ants.some(a => !a.queen && !a.bonked && !a.gone)) return; // still some up
  game.clearedZones.add(key);
  const pos = randomOpenSpot(layout, 90, game.player, 150);
  game.keyChests.push({ zone: key, x: pos.x, y: pos.y, t: 0, collected: false });
  events.onZoneCleared();
}

// The hero swings in their facing direction; nearby ants get bonked.
const DIRV = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };

export function bonkAttack(game, events, layout) {
  const p = game.player;
  const dv = DIRV[p.dir];
  for (const a of game.ants) {
    if (a.gone || a.bonked) continue;
    const dx = a.x - p.x, dy = a.y - p.y;
    const d = Math.hypot(dx, dy) || 1;
    if (d > 100 || (dx * dv.x + dy * dv.y) / d < -0.25) continue;
    if (a.queen) {
      a.hp--;
      a.hurtFlash = 0.45;
      a.state = 'cooldown'; a.stateT = 1.2;
      moveWithCollision(a, (dx / d) * 46, (dy / d) * 46, layout, QUEEN_SIZE * 0.3);
      if (a.hp <= 0) {
        a.gone = true;
        a.respawnT = Infinity;
        game.queenDown = true;
        for (let i = 0; i < 5; i++) { // gem shower!
          game.drops.push({
            x: a.x, y: a.y, vx: rand(-240, 240), vy: rand(-340, -160),
            type: 'gem', age: 0, settled: false,
          });
        }
        burst(game, a.x, a.y, '#ffd94d', 22);
        events.onQueenDown();
      } else {
        burst(game, a.x, a.y, '#e8302a', 8);
        events.onQueenHit();
      }
    } else {
      a.bonked = { t: 0.85, vx: (dx / d) * 280, vy: (dy / d) * 280 - 60 };
      a.respawnT = rand(6, 10);
      burst(game, a.x, a.y, '#fff', 8);
      events.onBonk();
      checkZoneCleared(game, layout, events);
    }
  }
}

// ---- update ----

export function updateEntities(game, dt, events, layout) {
  const key = keyOf(game);
  const p = game.player;

  // collectibles (and heart pickups) in this zone
  for (const item of game.items) {
    if (item.zone !== key || !item.placed) continue;
    if (Math.hypot(item.x - p.x, item.y - p.y) < ITEM_RADIUS + 26) {
      if (item.kind === 'heart') {
        if (game.hearts >= 6) continue; // full health: leave it for later
        game.hearts = Math.min(6, game.hearts + 2);
        events.onHeal();
        burst(game, item.x, item.y, '#ff6b8a', 12);
        game.floats.push({ x: item.x, y: item.y - 20, text: '+♥', life: 0.9 });
      } else if (item.kind === 'berry') {
        game.buffs.speed = 10;
        events.onBuff();
        burst(game, item.x, item.y, '#ff8a94', 10);
        game.floats.push({ x: item.x, y: item.y - 20, text: 'ZOOM!', life: 1.1 });
      } else if (item.kind === 'smore') {
        game.buffs.invuln = 8;
        events.onBuff();
        burst(game, item.x, item.y, '#fffdf2', 12);
        game.floats.push({ x: item.x, y: item.y - 20, text: "S'MORE POWER!", life: 1.2 });
      } else {
        game.carried++;
        events.onPickup(key === 'U');
        burst(game, item.x, item.y, '#ffd94d', 12);
        game.floats.push({ x: item.x, y: item.y - 20, text: '+1', life: 0.9 });
      }
      // pops away to a random spot in a random outer zone, sometimes as a
      // heart or a snack power-up
      item.zone = OUTER_ZONES[Math.floor(Math.random() * OUTER_ZONES.length)];
      item.placed = false;
      const count = kind => game.items.filter(i => i.kind === kind && i !== item).length;
      const roll = Math.random();
      if (count('heart') < 2 && roll < 0.12) item.kind = 'heart';
      else if (count('berry') < 1 && roll < 0.24) item.kind = 'berry';
      else if (count('smore') < 1 && roll < 0.36) item.kind = 'smore';
      else item.kind = 'treasure';
      if (item.zone === key) {
        const pos = randomOpenSpot(layout, 50, p, 200);
        item.x = pos.x; item.y = pos.y; item.placed = true;
      }
    }
  }

  // dropped treasures: arc out, settle, then can be scooped back up
  for (const dr of game.drops) {
    dr.age += dt;
    if (!dr.settled) {
      dr.x += dr.vx * dt; dr.y += dr.vy * dt;
      dr.vy += 700 * dt;
      dr.x = Math.max(40, Math.min(W - 40, dr.x));
      dr.y = Math.max(80, Math.min(H - 40, dr.y));
      if (dr.vy > 0 && dr.age > 0.35) dr.settled = true;
    } else if (dr.age > 0.8 && Math.hypot(dr.x - p.x, dr.y - p.y) < 42) {
      dr.collected = true;
      game.carried++;
      events.onPickup(false);
      burst(game, dr.x, dr.y, '#ffd94d', 8);
      game.floats.push({ x: dr.x, y: dr.y - 20, text: '+1', life: 0.9 });
    }
  }
  game.drops = game.drops.filter(dr => !dr.collected);

  // key-chest: appears when you clear a zone; walk in to claim the key
  for (const kc of game.keyChests) {
    if (kc.zone !== key || kc.collected) continue;
    kc.t += dt;
    if (kc.t > 0.4 && Math.hypot(kc.x - p.x, kc.y - p.y) < 46) {
      kc.collected = true;
      game.keys++;
      events.onKey();
      burst(game, kc.x, kc.y, '#ffd84d', 18);
      game.floats.push({ x: kc.x, y: kc.y - 26, text: 'KEY! ' + game.keys + '/' + TOTAL_KEYS, life: 1.7, color: '#ffe14d' });
    }
  }
  game.keyChests = game.keyChests.filter(kc => !kc.collected);

  // tent: step inside to sleep (game.js runs the night-time sequence)
  if (layout.tentDoor && rectHas(layout.tentDoor, p.x, p.y)) {
    if (game.hearts < 6 && !game.rested && !game.sleep) {
      game.rested = true;
      events.onRest();
    }
  } else {
    game.rested = false;
  }

  // treasure chest: bank what you carry
  if (layout.chestZone && rectHas(layout.chestZone, p.x, p.y) && game.carried > 0) {
    const n = game.carried;
    game.banked += n;
    game.carried = 0;
    events.onBank(n);
    burst(game, layout.chestSpot.x, layout.chestSpot.y - 20, '#ffd94d', 10);
    game.floats.push({ x: layout.chestSpot.x, y: layout.chestSpot.y - 44, text: '+' + n + ' stored!', life: 1.4 });
  }

  // ants
  const invuln = game.buffs && game.buffs.invuln > 0;
  for (const a of game.ants) {
    // bonked: spin away, then wait to respawn at a new spot
    if (a.bonked) {
      a.bonked.t -= dt;
      a.x += a.bonked.vx * dt; a.y += a.bonked.vy * dt;
      a.bonked.vx *= 0.94; a.bonked.vy *= 0.94;
      if (a.bonked.t <= 0) { a.bonked = null; a.gone = true; }
      continue;
    }
    if (a.gone) {
      if (game.clearedZones.has(key)) continue; // cleared zone: stay gone for good
      a.respawnT -= dt;
      if (a.respawnT <= 0) {
        const pos = randomOpenSpot(layout, 60, p, 300);
        a.x = pos.x; a.y = pos.y; a.gone = false; a.chasing = false;
      }
      continue;
    }
    // bounced off the hero: recoil, then a 2s grace period before it can bite again
    if (a.hitCd > 0) a.hitCd -= dt;
    if (a.kb) {
      a.kb.t -= dt;
      const kr = (a.queen ? QUEEN_SIZE : ANT_SIZE) * 0.3;
      moveWithCollision(a, a.kb.vx * dt, a.kb.vy * dt, layout, kr); // never recoil into a wall/pond
      a.kb.vx *= 0.88; a.kb.vy *= 0.88;
      a.x = Math.max(20, Math.min(W - 20, a.x));
      a.y = Math.max(20, Math.min(H - 20, a.y));
      if (a.kb.t <= 0) a.kb = null;
      continue;
    }

    const chaseSpeed = a.queen ? QUEEN_CHASE_SPEED : ANT_CHASE_SPEED;
    const aggro = a.queen ? QUEEN_AGGRO : ANT_AGGRO;
    const size = a.queen ? QUEEN_SIZE : ANT_SIZE;
    const dx = p.x - a.x, dy = p.y - a.y;
    const dist = Math.hypot(dx, dy);
    let speed = ANT_WANDER_SPEED;
    if (a.hurtFlash > 0) a.hurtFlash -= dt;

    if (a.queen) {
      // boss brain: wander -> telegraph ('!!') -> charge -> cooldown
      a.stateT -= dt;
      if (a.state === 'telegraph') {
        speed = 0;
        if (a.stateT <= 0) {
          a.state = 'charge'; a.stateT = 0.8;
          a.heading = Math.atan2(dy, dx);
        }
      } else if (a.state === 'charge') {
        speed = 470;
        if (a.stateT <= 0) { a.state = 'cooldown'; a.stateT = 1.3; }
      } else if (a.state === 'cooldown') {
        speed = 70;
        a.turnT -= dt;
        if (a.turnT <= 0) { a.heading = rand(0, Math.PI * 2); a.turnT = rand(0.6, 1.4); }
        if (a.stateT <= 0) a.state = 'wander';
      } else { // wander
        speed = 95;
        a.turnT -= dt;
        if (a.turnT <= 0) { a.heading = rand(0, Math.PI * 2); a.turnT = rand(0.6, 2); }
        if (dist < aggro && a.stateT <= 0) { a.state = 'telegraph'; a.stateT = 0.7; events.onQueenRoar(); }
      }
      a.chasing = a.state === 'charge';
    } else if (invuln && dist < aggro * 1.2) {
      a.heading = Math.atan2(-dy, -dx); // flee the s'more-powered hero!
      speed = chaseSpeed;
      a.chasing = false;
    } else if (a.hitCd > 0) {
      a.chasing = false; // just bit you — wanders off for a moment
      a.turnT -= dt;
      if (a.turnT <= 0) { a.heading = rand(0, Math.PI * 2); a.turnT = rand(0.6, 2); }
    } else if (dist < aggro) {
      a.heading = Math.atan2(dy, dx); // spotted you — chase!
      speed = chaseSpeed;
      a.chasing = true;
    } else {
      a.chasing = false;
      a.turnT -= dt;
      if (a.turnT <= 0) { a.heading = rand(0, Math.PI * 2); a.turnT = rand(0.6, 2); }
    }
    const r = size * 0.3;
    if (blockedAt(layout, a.x, a.y, r * 0.7)) { // somehow wedged inside something — pop free
      const pos = findOpenNear(layout, a.x, a.y);
      a.x = pos.x; a.y = pos.y;
    }
    const hit = moveWithCollision(a, Math.cos(a.heading) * speed * dt, Math.sin(a.heading) * speed * dt, layout, r);
    if (hit.hitX) { a.heading = Math.PI - a.heading; if (a.state === 'charge') a.stateT = 0; }
    if (hit.hitY) { a.heading = -a.heading; if (a.state === 'charge') a.stateT = 0; }
    a.x = Math.max(r, Math.min(W - r, a.x));
    a.y = Math.max(r, Math.min(H - r, a.y));

    // contact damage — both bounce apart, and this ant backs off for 2s
    if (!invuln && p.hurtT <= 0 && (!a.hitCd || a.hitCd <= 0) && dist < size / 2 + 22) {
      game.hearts--;
      p.hurtT = 1;
      a.hitCd = 2;
      const away = dist > 4 ? Math.atan2(dy, dx) : rand(0, Math.PI * 2);
      a.kb = { vx: -Math.cos(away) * (a.queen ? 160 : 240), vy: -Math.sin(away) * (a.queen ? 160 : 240), t: 0.38 };
      if (a.queen) { a.state = 'cooldown'; a.stateT = 1.5; }
      if (game.carried > 0) { // one carried treasure pops loose
        game.carried--;
        game.drops.push({
          x: p.x, y: p.y - 10,
          vx: rand(-150, 150), vy: rand(-280, -180),
          type: itemType(game.score), age: 0, settled: false,
        });
        events.onDropLost();
      }
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
  const key = keyOf(game);
  const drawables = [];

  for (const p of layout.props) drawables.push({ baseY: p.baseY, draw: () => ctx.drawImage(p.img, p.x, p.y, p.w, p.h) });

  for (const item of game.items) {
    if (item.zone !== key || !item.placed) continue;
    drawables.push({ baseY: item.y + 22, draw: () => drawItem(ctx, assets, game, item, t) });
  }

  for (const dr of game.drops) {
    drawables.push({ baseY: dr.y + 18, draw: () => drawDrop(ctx, assets, dr, t) });
  }

  for (const kc of game.keyChests) {
    if (kc.zone !== key || kc.collected) continue;
    drawables.push({ baseY: kc.y + 20, draw: () => drawKeyChest(ctx, assets, kc, t) });
  }

  for (const a of game.ants) {
    if (a.gone) continue;
    drawables.push({ baseY: a.y + (a.queen ? QUEEN_SIZE : ANT_SIZE) / 2, draw: () => drawAnt(ctx, assets, a, t) });
  }

  if (layout.firePit) {
    drawables.push({ baseY: layout.firePit.y + 12, draw: () => drawFire(ctx, assets, game, layout.firePit, t) });
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
    // keep the text on screen even when it spawns near an edge
    const fw = ctx.measureText(f.text).width / 2 + 12;
    const fx = Math.max(fw, Math.min(W - fw, f.x));
    ctx.strokeText(f.text, fx, f.y);
    ctx.fillStyle = f.color || '#ffe14d';
    ctx.fillText(f.text, fx, f.y);
    ctx.restore();
  }
}

const HEART_BMP = ['0110110', '1111111', '1111111', '0111110', '0011100', '0001000'];

function drawHeartAt(ctx, cx, cy, px) {
  for (let r = 0; r < HEART_BMP.length; r++) {
    for (let c = 0; c < 7; c++) {
      if (HEART_BMP[r][c] === '1') {
        ctx.fillStyle = '#e8302a';
        ctx.fillRect(cx + (c - 3.5) * px, cy + (r - 3) * px, px, px);
      }
    }
  }
  ctx.fillStyle = '#ff9aa8'; // glint
  ctx.fillRect(cx - 2 * px, cy - 2 * px, px, px);
}

function drawKeyChest(ctx, assets, kc, t) {
  const pop = Math.min(1, kc.t / 0.3);           // spawn scale-up
  const e = pop < 1 ? 1 - (1 - pop) * (1 - pop) : 1; // ease-out
  const chest = assets.props['chest'];
  const h = 52 * (0.4 + e * 0.6), w = h * (chest.width / chest.height);
  // glow pool
  const g = ctx.createRadialGradient(kc.x, kc.y, 6, kc.x, kc.y, 60);
  g.addColorStop(0, 'rgba(255,216,77,0.35)');
  g.addColorStop(1, 'rgba(255,216,77,0)');
  ctx.fillStyle = g;
  ctx.fillRect(kc.x - 60, kc.y - 60, 120, 120);
  ctx.drawImage(chest, kc.x - w / 2, kc.y - h + 8, w, h);
  // floating key bobbing above
  const key = assets.props['key'];
  const kh = 30, kw = kh * (key.width / key.height);
  const bob = Math.sin(t * 0.005) * 5;
  ctx.drawImage(key, kc.x - kw / 2, kc.y - h - 26 + bob, kw, kh);
  // sparkle
  if ((t * 0.003 + kc.x * 0.1) % 1 < 0.4) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(kc.x + 16, kc.y - h - 20 + bob, 3, 3);
  }
}

function drawDrop(ctx, assets, dr, t) {
  const spr = assets.sprites[dr.type];
  const h = 38, w = h * (spr.width / spr.height);
  const blink = dr.age < 0.8 && Math.floor(t / 90) % 2 === 0;
  if (blink) ctx.globalAlpha = 0.5;
  ctx.drawImage(spr, dr.x - w / 2, dr.y - h / 2, w, h);
  ctx.globalAlpha = 1;
}

function drawFire(ctx, assets, game, fp, t) {
  // glow
  const g = ctx.createRadialGradient(fp.x, fp.y - 10, 8, fp.x, fp.y - 10, 95 + Math.sin(t * 0.013) * 10);
  g.addColorStop(0, 'rgba(255,160,60,0.30)');
  g.addColorStop(1, 'rgba(255,160,60,0)');
  ctx.fillStyle = g;
  ctx.fillRect(fp.x - 110, fp.y - 120, 220, 220);
  ctx.drawImage(assets.props['logs'], fp.x - 28, fp.y - 15, 56, 30);
  const h = 32 + Math.sin(t * 0.019) * 5 + Math.sin(t * 0.043) * 4;
  flame(ctx, fp.x, fp.y - 6, h, '#ff5a1f');
  flame(ctx, fp.x + Math.sin(t * 0.03) * 2, fp.y - 6, h * 0.68, '#ff9a2b');
  flame(ctx, fp.x, fp.y - 6, h * 0.4, '#ffd84d');
  if (Math.random() < 0.1) {
    game.particles.push({
      x: fp.x + (Math.random() - 0.5) * 18, y: fp.y - 22,
      vx: (Math.random() - 0.5) * 24, vy: -95, life: 0.55, color: '#ffb454',
    });
  }
}

function flame(ctx, x, y, h, col) {
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.moveTo(x - h * 0.38, y);
  ctx.quadraticCurveTo(x - h * 0.3, y - h * 0.55, x, y - h);
  ctx.quadraticCurveTo(x + h * 0.3, y - h * 0.55, x + h * 0.38, y);
  ctx.closePath();
  ctx.fill();
}

function drawItem(ctx, assets, game, item, t) {
  const bob0 = Math.sin(t * 0.004 + item.x) * 5;
  if (item.kind === 'heart') {
    drawHeartAt(ctx, item.x, item.y + bob0, 5);
    return;
  }
  if (item.kind === 'berry' || item.kind === 'smore') {
    const spr = assets.props[item.kind];
    ctx.drawImage(spr, item.x - spr.width, item.y - spr.height + bob0, spr.width * 2, spr.height * 2);
    return;
  }
  const spr = assets.sprites[itemType(game.score)];
  const h = 46, w = h * (spr.width / spr.height);
  const bob = bob0;
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
  const shake = a.queen && a.state === 'telegraph' ? (Math.random() - 0.5) * 6 : 0;
  ctx.save();
  ctx.translate(a.x + shake, a.y + scurry);
  if (a.bonked) { // spinning away!
    const k = a.bonked.t / 0.85;
    ctx.globalAlpha = k;
    ctx.rotate((1 - k) * 14);
    ctx.scale(0.4 + k * 0.6, 0.4 + k * 0.6);
  }
  if (flip) ctx.scale(-1, 1);
  ctx.drawImage(spr, -w / 2, -h / 2, w, h);
  if (a.hurtFlash > 0 && Math.floor(t / 70) % 2 === 0) {
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = 'rgba(255,80,80,0.55)';
    ctx.fillRect(-w / 2, -h / 2, w, h);
  }
  ctx.restore();
  ctx.font = 'bold 26px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#e8302a';
  if (a.queen && a.state === 'telegraph') {
    ctx.font = 'bold 34px "Courier New", monospace';
    ctx.fillText('!!', a.x, a.y - h / 2 - 8);
  } else if (a.chasing && !a.bonked) {
    ctx.fillText('!', a.x, a.y - h / 2 - 6);
  }
  if (a.queen) { // boss health pips
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = i < a.hp ? '#e8302a' : 'rgba(0,0,0,0.35)';
      ctx.fillRect(a.x - 24 + i * 18, a.y + h / 2 + 8, 12, 8);
    }
  }
}
