// Pixel Quest Camping Day — main loop and state machine.
import { W, H, setWorldWidth, loadAssets } from './assets.js';
import { input, initInput, getMove, takeTap, clearFrameFlags, drawJoystick } from './input.js';
import { initItems, enterZone, updateEntities, drawEntities, bonkAttack, zapAllAnts, TOTAL_KEYS } from './entities.js';
import { ZONE_DEFS, CAVE_ENTRANCE, CAVE_ROOMS, buildZoneLayout, snapshotLayout, moveWithCollision, blockedAt, randomOpenSpot, findOpenNear } from './zonegen.js';
import { unlock, setTheme, sfx, toggleMute, isMuted } from './audio.js';

let layouts = {}; // zone key -> generated layout, rebuilt when the world resizes

function getLayout(key) {
  if (!layouts[key]) layouts[key] = buildZoneLayout(key, assets);
  return layouts[key];
}

const muteBtn = () => ({ x: W - 64 - view.safe.r, y: H - 64 - view.safe.b, r: 30 });
const bonkBtn = () => ({ x: W - 130 - view.safe.r, y: H - 250 - view.safe.b, r: 96 });
const homeBtn = () => ({ x: 64 + view.safe.l, y: H - 64 - view.safe.b, r: 30 });
const pauseBtn = () => ({ x: 152 + view.safe.l, y: H - 64 - view.safe.b, r: 30 });
const startBtnRect = () => ({ x: W / 2 - 150, y: H - 165, w: 300, h: 105 });

// hats are badges earned during the run — everything resets when it ends
const HATS = [
  { id: 'party', name: 'Party Hat', how: 'Store 8 treasures' },
  { id: 'crown', name: 'Crown', how: 'Bonk the Queen!' },
  { id: 'wizard', name: 'Wizard Hat', how: 'Collect 12 treasures' },
];
const FLASHLIGHT_AT = 10;   // total treasures to unlock the flashlight
const PARTY_AT = 8;         // treasures banked to earn the Party Hat
const WIZARD_AT = 12;       // total treasures collected to earn the Wizard Hat
const DAZZLE_TIME = 6;      // seconds the Party Hat's confetti blast dazzles ants
const ESCAPE_TIME = 15;     // seconds to flee the cave after the Queen falls
const COLLAPSE_DUR = 2.6;   // cave-collapse animation length before the death screen
const BUFF_TIME = { speed: 10, invuln: 8 };
let invSlots = [];  // inventory strip tap targets (flashlight badge + worn/available hats)

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const HERO_HEIGHT = 84;       // on-screen hero height in world px
const PLAYER_SPEED = 220;     // world px / s
const PLAYER_RADIUS = 24;     // collision radius

const view = { scale: 1, ox: 0, oy: 0, dpr: 1, safe: { l: 0, t: 0, r: 0, b: 0 } };
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
  // keep the HUD out of notches and rounded phone corners
  const cs = getComputedStyle(document.documentElement);
  const inset = name => (parseFloat(cs.getPropertyValue(name)) || 0) / view.scale;
  view.safe = { l: inset('--sal'), t: inset('--sat'), r: inset('--sar'), b: inset('--sab') };
}
addEventListener('resize', resize);
resize();

function clampToWorld() {
  if (!game.player || state !== 'PLAY') return;
  const layout = getLayout(zoneKey());
  game.player.x = Math.max(30, Math.min(W - 30, game.player.x));
  if (blockedAt(layout, game.player.x, game.player.y, 20)) {
    const pos = findOpenNear(layout, game.player.x, game.player.y);
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
  caveFinds: 0,           // tunnel treasures found this run (3 earns the wizard hat)
  hearts: 6,              // half-heart units; 6 = three full hearts
  zone: { x: 1, y: 1 },
  caveRoom: { ...CAVE_ENTRANCE }, // current dungeon room while inCave
  player: { x: W / 2, y: H / 2 + 60, dir: 'down', moving: false, hurtT: 0 },
  best: Number(localStorage.getItem('pq-best') || 0),
  select: { chosen: null },
  inCave: false,
  fade: null,
  buffs: { speed: 0, invuln: 0 },
  queenDown: false,
  hatsOwned: new Set(),
  hat: null,
  banner: { text: '', t: 0 },
  transition: null,       // { dx, dy, t } while sliding between zones
  visited: new Set(['1,1']),
  caveVisited: new Set(), // fog-of-war: dungeon rooms seen this run
  skitterT: 2,
  paused: false,
};

window.pq = game; // debug/testing handle
window.pqStart = h => startGame(h);
window.pqState = () => state;
window.pqDebug = () => ({ state, view: { ...view }, joy: { ...input.joy }, taps: input.taps.length });

const TRANSITION_TIME = 0.45;
const EDGE = 8;           // how close to the edge triggers a zone change

function currentCoord() { return game.inCave ? game.caveRoom : game.zone; }
function zoneKey() {
  const c = currentCoord();
  return game.inCave ? 'U:' + c.x + ',' + c.y : c.x + ',' + c.y;
}

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
  if (s === 'TITLE' || s === 'SELECT') setTheme('menu');
}

function startGame(hero) {
  game.hero = hero;
  game.hatsOwned = new Set(); // fresh run, fresh badges
  game.hat = null;
  game.score = 0;
  game.carried = 0;
  game.banked = 0;
  game.caveFinds = 0;
  game.keys = 0;
  game.clearedZones = new Set();
  game.caveUnlocked = false;
  game.caveUnlockT = 0;      // gate-burst animation timer at the cave mouth
  game.lockHintT = -99;
  game.keyGrab = null;       // active open-chest-and-lift-key celebration
  game.escaping = false;     // true after beating the Queen — race to the exit
  game.rumbleT = 0;          // timer between falling-debris particles during the escape
  game.escapeT = 0;          // countdown: reach the exit before the cave comes down
  game.escapeWarned = false; // one-time "HURRY!" warning as the timer runs low
  game.collapse = null;      // { t, dur } while the cave-collapse animation plays
  game.flashlight = false;
  game.inventoryHats = new Set(); // owned, unworn one-shot powers (party/wizard)
  game.wornHat = null;            // which inventory power BONK will fire next
  game.dazzle = 0;                // confetti-dazzle timer (party power)
  game.zapFlash = 0;               // lightning-flash timer (wizard power)
  game.rested = false;
  game.sleep = null;
  game.homeArm = 0;
  game.buffs = { speed: 0, invuln: 0 };
  game.queenDown = false;
  game.hearts = 6;
  game.zone = { x: 1, y: 1 };
  game.caveRoom = { ...CAVE_ENTRANCE };
  game.caveVisited = new Set();
  game.skitterT = 2;
  game.paused = false;
  game.player.x = W / 2;
  game.player.y = H / 2 + 60;
  game.player.dir = 'down';
  game.player.hurtT = 0;
  game.player.swing = null;
  game.player.swingCd = 0;
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
  if (input.anyPress) {
    unlock(); // backup — the primary unlock happens inside the gesture handler
    if (screen.orientation && screen.orientation.lock) {
      screen.orientation.lock('landscape').catch(() => {}); // works on installed Android PWAs
    }
  }
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
    if (tap) {
      const w = toWorld(tap.x, tap.y);
      const pz = pauseBtn();
      const bb = bonkBtn();
      const hb = homeBtn();
      if (Math.hypot(w.x - pz.x, w.y - pz.y) < pz.r + 12) {
        game.paused = !game.paused;
        tap = null;
      } else if (game.paused) {
        game.paused = false; // tap anywhere to resume
        tap = null;
      } else if (Math.hypot(w.x - bb.x, w.y - bb.y) < bb.r + 12) {
        if (navigator.vibrate) navigator.vibrate(30); // confirm the tap landed, even on cooldown
        tryBonk();
        tap = null;
      } else if (Math.hypot(w.x - hb.x, w.y - hb.y) < hb.r + 10) {
        if (game.homeArm > 0) {
          setState('TITLE');
        } else {
          game.homeArm = 2.5;
          game.floats.push({ x: hb.x + 90, y: hb.y - 50, text: 'Tap again to quit!', life: 2.2, color: '#fff' });
        }
        tap = null;
      } else {
        for (const slot of invSlots) {
          if (w.x > slot.x && w.x < slot.x + slot.w && w.y > slot.y && w.y < slot.y + slot.h) {
            if (slot.hatId) wearHat(slot.hatId);
            tap = null;
            break;
          }
        }
      }
    }
    if (!game.paused) {
      if (input.bonkPressed) tryBonk();
      updatePlay(dt);
    }
  } else if (state === 'WIN' || state === 'DIED') {
    if (tap && stateTime > 0.8) setState('TITLE');
  }
  clearFrameFlags();
}

function tryBonk() {
  const p = game.player;
  if (state !== 'PLAY' || game.transition || game.fade || p.swingCd > 0) return;
  p.swing = { t: 0.25, dir: p.dir };
  p.swingCd = 0.45;
  if (game.wornHat === 'party') return firePartyPower();
  if (game.wornHat === 'wizard') return fireWizardPower();
  bonkAttack(game, entityEvents, getLayout(zoneKey()));
}

function firePartyPower() {
  const p = game.player;
  game.dazzle = DAZZLE_TIME;
  sfx.confetti();
  showBanner('Confetti blast — ants dazzled!');
  for (let i = 0; i < 30; i++) {
    const a = Math.random() * Math.PI * 2, s = 100 + Math.random() * 260;
    game.particles.push({
      x: p.x, y: p.y - 20, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 120,
      life: 0.5 + Math.random() * 0.5, color: ['#ff4fa3', '#ffd84d', '#4dd2ff', '#8aff8a'][i % 4],
    });
  }
  consumeWornHat('party');
}

function fireWizardPower() {
  zapAllAnts(game, entityEvents, getLayout(zoneKey()));
  sfx.zap();
  showBanner('Lightning strike!');
  game.zapFlash = 0.35;
  game.shake = Math.max(game.shake, 0.3);
  consumeWornHat('wizard');
}

function consumeWornHat(id) {
  game.inventoryHats.delete(id);
  game.wornHat = null;
  game.hat = null;
}

// tap an inventory badge to wear its power (BONK fires it); tap again to take it off
function wearHat(id) {
  if (game.wornHat === id) {
    game.wornHat = null;
    game.hat = null;
    sfx.pickup();
  } else if (game.inventoryHats.has(id)) {
    game.wornHat = id;
    game.hat = id;
    sfx.pickup();
  }
}

function unlockHat(id) {
  if (game.hatsOwned.has(id)) return;
  game.hatsOwned.add(id);
  game.inventoryHats.add(id); // sits in the inventory until tapped to wear
  const hat = HATS.find(h => h.id === id);
  showBanner(hat.name + ' earned! Tap it to wear.');
  sfx.buff();
}

const entityEvents = {
  onPickup: fromCave => {
    sfx.pickup();
    if (fromCave) game.caveFinds++;
    // treasures no longer win the game — they fuel tools/powers (Phase 2).
    // You win by beating the Queen in the cave and escaping.
    game.score = game.carried + game.banked;
  },
  onHeal: () => sfx.heal(),
  onRest: () => {
    game.sleep = { t: 0, dur: 2.6, healed: false };
    sfx.rest();
  },
  onBuff: () => sfx.buff(),
  onBank: () => sfx.clink(), // banking treasure; powers arrive in Phase 2
  onDropLost: () => {
    game.score = game.carried + game.banked;
    sfx.drop();
  },
  onBonk: () => {
    sfx.bonk();
    game.shake = Math.max(game.shake, 0.15);
  },
  onZoneCleared: () => {
    sfx.buff();
    showBanner('Zone cleared — open the chest!');
  },
  onChestOpen: () => sfx.creak(),
  onQueenRoar: () => sfx.buzz(),
  onSkitter: () => sfx.skitter(),
  onQueenHit: () => {
    sfx.bossHit();
    game.shake = 0.35;
  },
  onQueenDown: () => {
    sfx.bossDown();
    showBanner('QUEEN DEFEATED — grab the guarded treasure and RUN!');
    game.shake = 0.6;
    // the Crown: King Mode (invincible + fast) powers the escape to the exit
    game.escaping = true;
    game.escapeT = ESCAPE_TIME; // beat the collapse or get buried with the Queen
    game.hat = 'crown';
    game.buffs.invuln = 999;
    game.buffs.speed = 999;
    // a disturbed swarm pours out of the nest — harmless against King Mode, pure spectacle
    const layout = getLayout(zoneKey());
    for (let i = 0; i < 4; i++) {
      const pos = randomOpenSpot(layout, 60, game.player, 140);
      game.ants.push({ x: pos.x, y: pos.y, heading: Math.random() * Math.PI * 2, turnT: 1, queen: false });
    }
  },
  onHurt: () => {
    game.shake = 0.3;
    game.flash = 0.25;
    if (game.hearts <= 0) endGame(false);
    else sfx.hurt();
  },
};

function updatePlay(dt) {
  const p = game.player;
  if (game.banner.t > 0) game.banner.t -= dt;
  if (game.homeArm > 0) game.homeArm -= dt;

  // asleep in the tent: night falls, hearts refill, morning comes
  if (game.sleep) {
    const s = game.sleep;
    s.t += dt;
    if (!s.healed && s.t >= s.dur / 2) {
      s.healed = true;
      game.hearts = 6;
      game.floats.push({ x: p.x, y: p.y - 60, text: 'All rested!', life: 1.4 });
      sfx.heal();
    }
    if (s.t >= s.dur) game.sleep = null;
    return;
  }

  // opening a key-chest: the lid lifts and the hero raises the key overhead
  if (game.keyGrab) {
    const kg = game.keyGrab;
    p.moving = false;   // stand still (not the walk cycle) while celebrating
    p.dir = 'down';
    kg.t += dt;
    if (!kg.awarded && kg.t >= 0.95) {
      kg.awarded = true;
      game.keys++;
      sfx.clink();
      game.shake = Math.max(game.shake, 0.2);
      showBanner(game.keys >= TOTAL_KEYS ? 'All keys — open the cave!' : 'Got a key!  ' + game.keys + '/' + TOTAL_KEYS);
    }
    if (kg.t >= 1.7) { kg.kc.collected = true; game.keyGrab = null; }
    return;
  }

  // too slow — the cave comes down: violent shake, raining rock, fade to black, then the death screen
  if (game.collapse) {
    const c = game.collapse;
    c.t += dt;
    p.moving = false;
    game.shake = Math.max(game.shake, 0.4);
    for (let i = 0; i < 4; i++) { // rock rains harder than the escape rumble ever did
      game.particles.push({
        x: Math.random() * W, y: -20 - Math.random() * 60,
        vx: (Math.random() - 0.5) * 60, vy: 300 + Math.random() * 260, life: 1.4,
        color: ['#5d5548', '#3a352e', '#241b12', '#6e6355'][Math.floor(Math.random() * 4)],
      });
    }
    // the world is frozen (we return early), so keep the debris falling ourselves
    for (const pt of game.particles) {
      pt.x += pt.vx * dt; pt.y += pt.vy * dt;
      pt.vy += 300 * dt;
      pt.life -= dt;
    }
    game.particles = game.particles.filter(pt => pt.life > 0);
    if (c.t >= c.dur) endGame(false);
    return;
  }

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
      const c = currentCoord();
      c.x += tr.dx;
      c.y += tr.dy;
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
  if (game.buffs.speed > 0) game.buffs.speed -= dt;
  if (game.buffs.invuln > 0) game.buffs.invuln -= dt;
  const speed = PLAYER_SPEED * (game.buffs.speed > 0 ? 1.6 : 1);
  const mv = getMove();
  p.moving = !!(mv.dx || mv.dy);
  if (p.moving) {
    moveWithCollision(p, mv.dx * speed * dt, mv.dy * speed * dt, layout, 20);
    // facing follows the dominant axis
    p.dir = Math.abs(mv.dx) > Math.abs(mv.dy) ? (mv.dx > 0 ? 'right' : 'left') : (mv.dy > 0 ? 'down' : 'up');
    if (game.buffs.speed > 0) { // zoom trail
      game.particles.push({ x: p.x, y: p.y + 20, vx: -mv.dx * 60, vy: -mv.dy * 60 - 30, life: 0.3, color: '#ff8a94' });
    }
  }
  if (game.buffs.invuln > 0 && Math.random() < 0.3) { // sparkle aura
    game.particles.push({
      x: p.x + (Math.random() - 0.5) * 50, y: p.y + (Math.random() - 0.5) * 60,
      vx: 0, vy: -50, life: 0.4, color: '#ffe9a8',
    });
  }
  if (p.hurtT > 0) p.hurtT -= dt;

  // bonk!
  if (p.swing) { p.swing.t -= dt; if (p.swing.t <= 0) p.swing = null; }
  if (p.swingCd > 0) p.swingCd -= dt;
  if (game.shake > 0) game.shake -= dt;
  if (game.flash > 0) game.flash -= dt;
  if (game.zapFlash > 0) game.zapFlash -= dt;
  if (game.dazzle > 0) {
    game.dazzle -= dt;
    if (Math.random() < 0.35) { // lingering confetti sparkle while dazzled
      game.particles.push({
        x: p.x + (Math.random() - 0.5) * 60, y: p.y - 40 + (Math.random() - 0.5) * 30,
        vx: (Math.random() - 0.5) * 40, vy: -40, life: 0.5,
        color: ['#ff4fa3', '#ffd84d', '#4dd2ff', '#8aff8a'][Math.floor(Math.random() * 4)],
      });
    }
  }

  // the cave is coming down around you — sustained tremor + falling debris
  if (game.escaping) {
    game.escapeT -= dt;
    if (!game.escapeWarned && game.escapeT <= 6) {
      game.escapeWarned = true;
      showBanner('The cave is collapsing — HURRY!');
      sfx.buzz();
    }
    if (game.escapeT <= 0) {
      game.collapse = { t: 0, dur: COLLAPSE_DUR };
      sfx.rumble();
      return;
    }
    game.shake = Math.max(game.shake, 0.15);
    game.rumbleT -= dt;
    if (game.rumbleT <= 0) {
      game.rumbleT = 0.1;
      game.particles.push({
        x: Math.random() * W, y: -10,
        vx: (Math.random() - 0.5) * 30, vy: 220 + Math.random() * 140, life: 1.2,
        color: ['#5d5548', '#3a352e', '#241b12'][Math.floor(Math.random() * 3)],
      });
    }
  }

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

  updateEntities(game, dt, entityEvents, layout);
  if (state !== 'PLAY') return;

  // tool/power unlocks — fuel earned from treasures, not a win condition
  if (!game.flashlight && game.score >= FLASHLIGHT_AT) {
    game.flashlight = true;
    showBanner('Flashlight unlocked!');
    sfx.buff();
  }
  if (game.banked >= PARTY_AT) unlockHat('party');
  if (game.score >= WIZARD_AT) unlockHat('wizard');

  if (game.caveUnlockT > 0) game.caveUnlockT -= dt;

  // the cave is chained shut until all 7 keys are found
  if (!game.inCave && layout.caveDoor && rectHas(layout.caveDoor, p.x, p.y)) {
    const d = layout.caveDoor, cx = d.x + d.w / 2, cy = d.y + d.h / 2;
    if (!game.caveUnlocked) {
      if (game.keys >= TOTAL_KEYS) {
        // burst the chains open — a one-time celebration, then step in to enter
        game.caveUnlocked = true;
        game.caveUnlockT = 1;
        game.shake = 0.4;
        sfx.clink();
        showBanner('The cave creaks open!');
        for (let i = 0; i < 26; i++) {
          const a = Math.random() * Math.PI * 2, s = 120 + Math.random() * 260;
          game.particles.push({ x: cx, y: cy, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60, life: 0.5 + Math.random() * 0.4, color: ['#8b867c', '#6e695f', '#c9c4b8'][i % 3] });
        }
        p.y = d.y + d.h + 26; // nudge out so you don't enter on the same touch
        return;
      }
      // still locked: show what's needed and block
      if (stateTime - game.lockHintT > 1.8) {
        game.lockHintT = stateTime;
        game.floats.push({ x: cx, y: d.y - 6, text: 'Need ' + TOTAL_KEYS + ' keys! (' + game.keys + '/' + TOTAL_KEYS + ')', life: 1.8, color: '#fff' });
      }
      p.y = d.y + d.h + 26;
      return;
    }
    // unlocked → descend, always landing at the Cave Mouth (the dungeon entrance)
    return startFade(() => {
      game.inCave = true;
      game.caveRoom = { ...CAVE_ENTRANCE };
      // well below the ladder trigger, near the bottom edge — so an instinctive
      // "move up" doesn't immediately walk you straight back out
      p.x = W / 2;
      p.y = H - 110;
      onZoneEnter();
    });
  }
  if (game.inCave) {
    for (const exit of layout.exits) {
      if (rectHas(exit.rect, p.x, p.y)) {
        if (game.escaping) { endGame(true); return; } // made it out — you win!
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

  // walk off an edge -> slide to the neighboring zone/room (if the map connects there)
  if (!game.inCave) {
    if (p.x < PLAYER_RADIUS && game.zone.x > 0) return startTransition(-1, 0);
    if (p.x > W - PLAYER_RADIUS && game.zone.x < 2) return startTransition(1, 0);
    if (p.y < PLAYER_RADIUS && game.zone.y > 0) return startTransition(0, -1);
    if (p.y > H - PLAYER_RADIUS && game.zone.y < 2) return startTransition(0, 1);
  } else {
    if (p.x < PLAYER_RADIUS && layout.gaps.w) return startTransition(-1, 0);
    if (p.x > W - PLAYER_RADIUS && layout.gaps.e) return startTransition(1, 0);
    if (p.y < PLAYER_RADIUS && layout.gaps.n) return startTransition(0, -1);
    if (p.y > H - PLAYER_RADIUS && layout.gaps.s) return startTransition(0, 1);
  }
  p.x = Math.max(PLAYER_RADIUS, Math.min(W - PLAYER_RADIUS, p.x));
  p.y = Math.max(PLAYER_RADIUS, Math.min(H - PLAYER_RADIUS, p.y));
}

function rectHas(r, x, y) {
  return x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h;
}

function onZoneEnter() {
  const key = zoneKey();
  if (game.inCave) game.caveVisited.add(key); else game.visited.add(key);
  const layout = getLayout(key);
  // never arrive stuck inside water or a wall
  const pos = findOpenNear(layout, game.player.x, game.player.y);
  game.player.x = pos.x;
  game.player.y = pos.y;
  showBanner(layout.name);
  enterZone(game, layout);
  setTheme(game.inCave ? 'cave' : key === '1,1' ? 'camp' : 'adventure');
}

// ---------- draw ----------

function draw(t) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(view.scale * view.dpr, 0, 0, view.scale * view.dpr, view.ox * view.dpr, view.oy * view.dpr);
  ctx.imageSmoothingEnabled = false;

  if (state === 'LOADING') {
    drawCenterText('Loading…', W / 2, H / 2, 36, '#cfe8b0');
  } else if (state === 'TITLE') {
    drawMenuScreen('screen-title');
    drawTitleDecor(t);
    pulseText('TAP TO START', W / 2, H * 0.72, 40, t);
    drawCenterText('Created by: Ashton and Kenzie', W / 2, H - 30, 20, 'rgba(255,255,255,0.75)');
  } else if (state === 'SELECT') {
    drawSelect(t);
  } else if (state === 'PLAY') {
    drawPlay(t);
  } else if (state === 'WIN') {
    drawMenuScreen('screen-win');
    drawWinFlourish(t);
    drawCenterText('You escaped the cave!  Treasures: ' + game.score, W / 2, H * 0.8, 26, '#053305');
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
    const c = currentCoord();
    const nx = c.x + tr.dx, ny = c.y + tr.dy;
    const nextKey = game.inCave ? 'U:' + nx + ',' + ny : nx + ',' + ny;
    ctx.drawImage(snapshotLayout(getLayout(zoneKey())), -tr.dx * e * W, -tr.dy * e * H);
    ctx.drawImage(snapshotLayout(getLayout(nextKey)), tr.dx * W - tr.dx * e * W, tr.dy * H - tr.dy * e * H);
  } else {
    if (game.shake > 0) {
      ctx.translate((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14);
    }
    const layout = getLayout(zoneKey());
    ctx.drawImage(layout.ground, 0, 0);
    drawEntities(ctx, assets, game, t, layout, () => drawPlayer(t));
    if (!game.inCave && !game.caveUnlocked && layout.caveMouth) drawCaveGate(layout.caveMouth);
    if (game.keyGrab && !game.inCave) drawKeyLift();
    if (game.inCave) { // near-black without the flashlight; a wide warm pool once it's unlocked
      const p = game.player;
      const [inner, outer] = game.flashlight ? [130, 420] : [45, 150];
      const g = ctx.createRadialGradient(p.x, p.y, inner, p.x, p.y, outer);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(8,5,2,0.88)');
      ctx.fillStyle = g;
      ctx.fillRect(-20, -20, W + 40, H + 40);
    }
    if (game.flash > 0) {
      ctx.fillStyle = 'rgba(232,48,42,' + (game.flash * 1.2) + ')';
      ctx.fillRect(-20, -20, W + 40, H + 40);
    }
    if (game.zapFlash > 0) {
      ctx.fillStyle = 'rgba(210,230,255,' + (game.zapFlash * 1.4) + ')';
      ctx.fillRect(-20, -20, W + 40, H + 40);
    }
    if (game.escaping) { // pulsing red vignette — the cave is collapsing, get out!
      const pulse = 0.5 + Math.sin(t * 0.012) * 0.5;
      ctx.fillStyle = 'rgba(160,20,10,' + (0.1 + pulse * 0.12) + ')';
      ctx.fillRect(-20, -20, W + 40, H + 40);
    }
    if (game.collapse) { // rubble dust swallows the screen as everything caves in
      const c = game.collapse;
      const k = Math.min(1, c.t / (c.dur * 0.8));
      ctx.fillStyle = 'rgba(20,14,8,' + (k * k).toFixed(3) + ')';
      ctx.fillRect(-20, -20, W + 40, H + 40);
      if (c.t > 0.2) drawCenterText('THE CAVE COLLAPSED!', W / 2, H / 2, 52, '#e8302a');
    }
    if (game.sleep) drawSleep(layout);
  }
  drawHud();
  drawBanner();
  if (game.paused) { // freeze frame with a dim overlay so nothing sneaks up on you
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(-20, -20, W + 40, H + 40);
    drawCenterText('PAUSED', W / 2, H / 2 - 10, 56, '#ffe9a8');
    pulseText('TAP TO RESUME', W / 2, H / 2 + 44, 30, t);
  }
  if (game.fade) {
    const f = game.fade;
    const a = 1 - Math.abs(1 - 2 * (f.t / f.dur)); // 0 -> 1 -> 0
    ctx.fillStyle = 'rgba(0,0,0,' + Math.min(1, a * 1.25) + ')';
    ctx.fillRect(-20, -20, W + 40, H + 40);
  }
}

// a closed metal park gate (barred, padlocked) fitted into the cave opening
function drawCaveGate(m) {
  const x0 = m.x, y0 = m.y, w = m.w, h = m.h, cx = x0 + w / 2;
  ctx.save();
  // side frame set just inside the arch
  ctx.fillStyle = '#33333a';
  ctx.fillRect(x0 - 3, y0 - 2, 5, h + 2);
  ctx.fillRect(x0 + w - 2, y0 - 2, 5, h + 2);
  // vertical bars filling the opening
  const gap = Math.max(9, w / 7);
  for (let bx = x0 + 3; bx < x0 + w - 3; bx += gap) {
    ctx.fillStyle = '#5a5a62'; ctx.fillRect(bx, y0, 4, h);
    ctx.fillStyle = '#828290'; ctx.fillRect(bx, y0, 2, h); // highlight
  }
  // horizontal rails (top / middle / bottom)
  ctx.fillStyle = '#484850';
  for (const ry of [y0, y0 + h * 0.5 - 3, y0 + h - 6]) ctx.fillRect(x0, ry, w, 6);
  ctx.fillStyle = '#6c6c78';
  for (const ry of [y0, y0 + h * 0.5 - 3, y0 + h - 6]) ctx.fillRect(x0, ry, w, 2);
  // center seam where the two gate halves meet
  ctx.fillStyle = '#2a2a30'; ctx.fillRect(cx - 2, y0, 4, h);
  // padlock hanging in the middle
  const ly = y0 + h * 0.5 + 2;
  ctx.strokeStyle = '#b8901f'; ctx.lineWidth = 4; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(cx, ly - 2, 7, Math.PI, 0); ctx.stroke();
  ctx.fillStyle = '#ffd84d'; ctx.fillRect(cx - 10, ly + 1, 20, 16);
  ctx.fillStyle = '#c9a227'; ctx.fillRect(cx - 10, ly + 1, 20, 3);
  ctx.fillStyle = '#7a5a10'; ctx.fillRect(cx - 2, ly + 6, 4, 7);
  ctx.restore();
}

// the key floats up out of the chest and the hero holds it overhead
function drawKeyLift() {
  const kg = game.keyGrab, p = game.player;
  if (kg.t < 0.3) return;
  const key = assets.props['key'];
  const headX = p.x, headY = p.y - HERO_HEIGHT / 2 - 24;
  const riseK = Math.min(1, (kg.t - 0.3) / 0.6);
  const e = riseK * (2 - riseK); // ease-out
  const fromX = kg.kc.x, fromY = kg.kc.y - 34;
  const kx = fromX + (headX - fromX) * e;
  const ky = fromY + (headY - fromY) * e - (kg.t > 0.9 ? Math.sin((kg.t - 0.9) * 8) * 3 : 0);
  // short blocky arm stubs lift straight up from the shoulders — they don't
  // reach the key or head, just a small raise (no separate hand blocks)
  if (kg.t > 0.55) {
    const dirKey = game.hero + '-' + p.dir;
    const spr = assets.sprites[dirKey];
    const h = HERO_HEIGHT;
    const bodyW = h * (spr.width / spr.height);
    const armK = Math.min(1, (kg.t - 0.55) / 0.2);
    const ease = armK * (2 - armK);
    const armW = Math.max(4, Math.round(bodyW * 0.16));
    const armLen = Math.round(h * 0.15); // a third of the old shoulder-to-head reach
    const shoulderY = p.y - h * 0.05;
    const armTopY = Math.round(shoulderY - armLen * ease);
    const leftX = Math.round(p.x - bodyW * 0.30 - armW / 2);
    const rightX = Math.round(p.x + bodyW * 0.30 - armW / 2);
    ctx.fillStyle = '#e8b98a';
    ctx.fillRect(leftX, armTopY, armW, Math.max(armW, Math.round(shoulderY - armTopY)));
    ctx.fillRect(rightX, armTopY, armW, Math.max(armW, Math.round(shoulderY - armTopY)));
  }
  const kh = 36, kw = kh * (key.width / key.height);
  ctx.drawImage(key, kx - kw / 2, ky - kh / 2, kw, kh);
  if (kg.t > 0.9) { // triumphant sparkles
    ctx.fillStyle = '#fff';
    for (let i = 0; i < 3; i++) {
      const a = kg.t * 4 + i * 2.1;
      ctx.fillRect(kx + Math.cos(a) * 22 - 1.5, ky + Math.sin(a) * 22 - 1.5, 3, 3);
    }
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
  const x0 = W / 2 - mw / 2, y0 = 12 + view.safe.t;
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillRect(x0, y0, mw, mw);
  if (game.inCave) {
    // fog of war: a room only appears once you've actually been there
    for (const coord of Object.keys(CAVE_ROOMS)) {
      const [zx, zy] = coord.split(',').map(Number);
      const key = 'U:' + coord;
      const cur = zx === game.caveRoom.x && zy === game.caveRoom.y;
      if (!cur && !game.caveVisited.has(key)) continue;
      ctx.fillStyle = cur ? '#ffe14d' : 'rgba(120,220,255,0.85)';
      ctx.fillRect(x0 + pad + zx * (cell + gap), y0 + pad + zy * (cell + gap), cell, cell);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x0, y0 + mw + 4, mw, 22);
    drawCenterText('CAVE', x0 + mw / 2, y0 + mw + 21, 16, '#8adfff');
  } else {
    for (let zy = 0; zy < 3; zy++) {
      for (let zx = 0; zx < 3; zx++) {
        const key = zx + ',' + zy;
        const cur = zx === game.zone.x && zy === game.zone.y;
        // gold = key already found here; pale green = explored but not cleared yet
        ctx.fillStyle = cur ? '#ffffff' : game.clearedZones.has(key) ? '#ffd84d' : game.visited.has(key) ? 'rgba(180,230,140,0.9)' : 'rgba(255,255,255,0.25)';
        ctx.fillRect(x0 + pad + zx * (cell + gap), y0 + pad + zy * (cell + gap), cell, cell);
      }
    }
  }
}

function drawPlayer(t) {
  const p = game.player;
  const key = game.hero + '-' + p.dir;
  const spr = p.moving ? assets.walk[key][Math.floor(t / 130) % 2] : assets.sprites[key];
  const h = HERO_HEIGHT;
  const w = h * (spr.width / spr.height);
  if (game.buffs.invuln > 0) { // s'more glow
    const g = ctx.createRadialGradient(p.x, p.y, 8, p.x, p.y, 64);
    g.addColorStop(0, 'rgba(255,225,120,0.5)');
    g.addColorStop(1, 'rgba(255,225,120,0)');
    ctx.fillStyle = g;
    ctx.fillRect(p.x - 66, p.y - 66, 132, 132);
  }
  if (p.hurtT > 0 && Math.floor(t / 80) % 2 === 0) ctx.globalAlpha = 0.35; // i-frame blink
  ctx.drawImage(spr, p.x - w / 2, p.y - h / 2, w, h);
  if (game.hat) {
    const hat = assets.props['hat-' + game.hat];
    const hw = 40, hh = hw * (hat.height / hat.width);
    ctx.drawImage(hat, p.x - hw / 2, p.y - h / 2 - hh + 10, hw, hh);
  }
  ctx.globalAlpha = 1;
  if (p.swing) { // bonk swoosh
    const k = p.swing.t / 0.25;
    const ang = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 }[p.swing.dir];
    ctx.save();
    ctx.globalAlpha = k * 0.9;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 64, ang - 0.9 + (1 - k) * 0.6, ang + 0.9 + (1 - k) * 0.6);
    ctx.stroke();
    ctx.restore();
  }
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

// night falls over the camp while you sleep; Zzz's drift up from the tent
function drawSleep(layout) {
  const s = game.sleep;
  const k = Math.sin(Math.PI * Math.min(1, s.t / s.dur)); // 0 -> 1 -> 0
  ctx.fillStyle = 'rgba(9,14,46,' + (k * 0.8).toFixed(3) + ')';
  ctx.fillRect(-20, -20, W + 40, H + 40);
  if (k > 0.25) { // a few stars once it's dark enough
    ctx.fillStyle = 'rgba(255,255,240,' + ((k - 0.25) * 0.9).toFixed(3) + ')';
    for (let i = 0; i < 9; i++) {
      ctx.fillRect(((i * 173 + 60) % W), 40 + ((i * 97) % 130), 3, 3);
    }
  }
  const d = layout.tentDoor;
  if (d) {
    ctx.textAlign = 'center';
    for (let i = 0; i < 3; i++) {
      const zt = (s.t * 0.55 + i * 0.33) % 1;
      ctx.font = 'bold ' + Math.round(22 + i * 7 + zt * 8) + 'px "Courier New", monospace';
      ctx.fillStyle = 'rgba(255,255,255,' + ((1 - zt) * k).toFixed(3) + ')';
      ctx.fillText('Z', d.x + d.w / 2 + 26 + zt * 44 + i * 10, d.y - 30 - zt * 70 - i * 12);
    }
  }
}

// bottom-center strip: flashlight badge + any earned, unspent hat powers.
// Tap a hat badge to wear it (BONK then fires its power once); tap again to take it off.
function drawInventory() {
  invSlots = [];
  const slotW = 52, gap = 10;
  const powerHats = HATS.filter(h => h.id !== 'crown' && game.inventoryHats.has(h.id));
  const n = 1 + powerHats.length; // flashlight badge always shown
  const totalW = n * slotW + (n - 1) * gap;
  const x0 = W / 2 - totalW / 2, y0 = H - 78;

  // flashlight badge (not tappable — auto-on in the cave once unlocked)
  drawBadgeBg(x0, y0, slotW, false);
  ctx.save();
  if (!game.flashlight) ctx.globalAlpha = 0.3;
  drawFlashlightIcon(x0 + slotW / 2, y0 + slotW / 2);
  ctx.restore();
  invSlots.push({ x: x0, y: y0, w: slotW, h: slotW, hatId: null });

  powerHats.forEach((hat, i) => {
    const sx = x0 + (i + 1) * (slotW + gap);
    const worn = game.wornHat === hat.id;
    drawBadgeBg(sx, y0, slotW, worn);
    const img = assets.props['hat-' + hat.id];
    ctx.drawImage(img, sx + slotW / 2 - 22, y0 + 10, 44, 44 * (img.height / img.width));
    invSlots.push({ x: sx, y: y0, w: slotW, h: slotW, hatId: hat.id });
  });
}

function drawBadgeBg(x, y, s, active) {
  ctx.fillStyle = active ? 'rgba(138,255,138,0.35)' : 'rgba(0,0,0,0.45)';
  ctx.fillRect(x, y, s, s);
  ctx.strokeStyle = active ? '#8aff8a' : 'rgba(255,255,255,0.5)';
  ctx.lineWidth = active ? 3 : 2;
  ctx.strokeRect(x, y, s, s);
}

function drawFlashlightIcon(cx, cy) {
  ctx.fillStyle = '#ffe9a8';
  ctx.fillRect(cx - 6, cy - 12, 12, 16);
  ctx.fillStyle = '#8a8a8a';
  ctx.fillRect(cx - 8, cy + 4, 16, 10);
  ctx.fillStyle = '#5a5a5a';
  ctx.fillRect(cx - 5, cy + 14, 10, 6);
  if (game.flashlight) {
    ctx.fillStyle = 'rgba(255,233,168,0.5)';
    ctx.beginPath();
    ctx.moveTo(cx - 5, cy - 12); ctx.lineTo(cx - 16, cy - 26); ctx.lineTo(cx + 16, cy - 26); ctx.lineTo(cx + 5, cy - 12);
    ctx.closePath(); ctx.fill();
  }
}

function drawHud() {
  const px = 6;
  const hx = 22 + view.safe.l, hy = 18 + view.safe.t;
  for (let i = 0; i < 3; i++) {
    const units = Math.max(0, Math.min(2, game.hearts - i * 2)); // 0, 1 or 2 half-units
    drawHeart(hx + i * (7 * px + 10), hy, units / 2, px);
  }
  // active buff icons under the hearts
  let bx = hx + 2;
  for (const [buff, prop] of [['speed', 'berry'], ['invuln', 'smore']]) {
    if (game.buffs[buff] > 0) {
      const img = assets.props[prop];
      ctx.drawImage(img, bx, hy + 48, 30, 30 * (img.height / img.width));
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(bx, hy + 80, 30, 5);
      ctx.fillStyle = '#8aff8a';
      ctx.fillRect(bx, hy + 80, 30 * Math.min(1, game.buffs[buff] / BUFF_TIME[buff]), 5);
      bx += 40;
    }
  }
  // bonk button — relabels while a hat power is worn and ready to fire
  const bb = bonkBtn();
  const powered = game.wornHat === 'party' ? 'PARTY!' : game.wornHat === 'wizard' ? 'ZAP!' : null;
  ctx.save();
  ctx.globalAlpha = game.player.swingCd > 0 ? 0.45 : 0.85;
  ctx.fillStyle = powered ? 'rgba(120,60,160,0.55)' : 'rgba(0,0,0,0.45)';
  ctx.beginPath(); ctx.arc(bb.x, bb.y, bb.r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = powered ? '#ffe14d' : '#fff';
  ctx.lineWidth = 5;
  ctx.beginPath(); ctx.arc(bb.x, bb.y, bb.r - 4, 0, Math.PI * 2); ctx.stroke();
  if (!powered) {
    ctx.lineWidth = 12;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(bb.x, bb.y, bb.r - 44, -2.2, 0.4); ctx.stroke(); // swoosh icon
  }
  ctx.font = 'bold 26px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  ctx.fillText(powered || 'BONK', bb.x, bb.y + bb.r - 28);
  ctx.restore();
  // home button (tap twice to quit to the title screen)
  const hb = homeBtn();
  ctx.save();
  ctx.globalAlpha = game.homeArm > 0 ? 1 : 0.7;
  ctx.fillStyle = game.homeArm > 0 ? 'rgba(160,40,30,0.7)' : 'rgba(0,0,0,0.45)';
  ctx.beginPath(); ctx.arc(hb.x, hb.y, hb.r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath(); // roof
  ctx.moveTo(hb.x, hb.y - 15); ctx.lineTo(hb.x + 16, hb.y - 1); ctx.lineTo(hb.x - 16, hb.y - 1);
  ctx.closePath(); ctx.fill();
  ctx.fillRect(hb.x - 10, hb.y - 1, 20, 14); // walls
  ctx.fillStyle = game.homeArm > 0 ? 'rgba(160,40,30,0.9)' : 'rgba(0,0,0,0.6)';
  ctx.fillRect(hb.x - 3, hb.y + 4, 6, 9); // door
  ctx.restore();
  // pause button — pause bars while playing, a play triangle while paused
  const pz = pauseBtn();
  ctx.save();
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath(); ctx.arc(pz.x, pz.y, pz.r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff';
  if (game.paused) {
    ctx.beginPath(); // play triangle
    ctx.moveTo(pz.x - 7, pz.y - 11); ctx.lineTo(pz.x + 12, pz.y); ctx.lineTo(pz.x - 7, pz.y + 11);
    ctx.closePath(); ctx.fill();
  } else {
    ctx.fillRect(pz.x - 9, pz.y - 11, 6, 22); // pause bars
    ctx.fillRect(pz.x + 3, pz.y - 11, 6, 22);
  }
  ctx.restore();
  // score with coin icon
  const coin = assets.sprites['coin'];
  const ch = 34, cw = ch * (coin.width / coin.height);
  const sx = W - 168 - view.safe.r, sy = 16 + view.safe.t;
  ctx.drawImage(coin, sx, sy, cw, ch);
  ctx.font = 'bold 30px "Courier New", monospace';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.lineWidth = 5;
  const scoreText = String(game.score);
  ctx.strokeText(scoreText, sx + cw + 8, sy + ch - 8);
  ctx.fillText(scoreText, sx + cw + 8, sy + ch - 8);
  // key counter
  const keyImg = assets.props['key'];
  const kh = 22, kw = kh * (keyImg.width / keyImg.height);
  ctx.drawImage(keyImg, sx, sy + 40, kw, kh);
  ctx.font = 'bold 24px "Courier New", monospace';
  ctx.strokeText(game.keys + '/' + TOTAL_KEYS, sx + kw + 8, sy + 60);
  ctx.fillText(game.keys + '/' + TOTAL_KEYS, sx + kw + 8, sy + 60);
  // banked treasure marker
  if (game.banked > 0) {
    const chest = assets.props['chest'];
    const chH = 24, chW = chH * (chest.width / chest.height);
    ctx.drawImage(chest, sx, sy + 68, chW, chH);
    ctx.font = 'bold 20px "Courier New", monospace';
    ctx.strokeText('x' + game.banked, sx + chW + 6, sy + 86);
    ctx.fillText('x' + game.banked, sx + chW + 6, sy + 86);
  }
  drawMinimap();
  drawQuest();
  drawInventory();
}

// one-line "what to do next" tracker under the minimap
function drawQuest() {
  let text;
  if (game.escaping) text = 'ESCAPE! Run to the ladder!';
  else if (game.inCave) text = 'Find and defeat the Queen!';
  else if (game.keys < TOTAL_KEYS) text = 'Clear zones to find keys: ' + game.keys + '/' + TOTAL_KEYS;
  else if (!game.caveUnlocked) text = 'Open the cave in The Old Cave!';
  else text = 'Enter the cave!';
  const y = 12 + view.safe.t + (3 * 16 + 2 * 3 + 12) + 20;
  ctx.font = 'bold 18px "Courier New", monospace';
  ctx.textAlign = 'center';
  const w = ctx.measureText(text).width + 24;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(W / 2 - w / 2, y - 15, w, 24);
  ctx.fillStyle = '#ffe9a8';
  ctx.fillText(text, W / 2, y + 3);
  // big escape countdown under the quest line — goes red and pulses when time is short
  if (game.escaping && !game.collapse && game.escapeT > 0) {
    const s = Math.ceil(game.escapeT);
    const low = game.escapeT <= 6;
    ctx.save();
    if (low) ctx.globalAlpha = 0.6 + Math.abs(Math.sin(game.escapeT * 6)) * 0.4;
    // sits below the banner line (y≈152) so "HURRY!" and zone names never overlap it
    drawCenterText('0:' + String(s).padStart(2, '0'), W / 2, y + 105, 42, low ? '#ff5a4d' : '#ffe14d');
    ctx.restore();
  }
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

// drifting confetti over the win screen — a light victory flourish, kids' art untouched underneath
function drawWinFlourish(t) {
  const colors = ['#ffd84d', '#8aff8a', '#4dd2ff', '#ff4fa3'];
  for (let i = 0; i < 22; i++) {
    const seed = i * 137.5;
    const x = (seed * 2.3 + t * 0.02 + Math.sin(t * 0.001 + i) * 30) % W;
    const y = (seed * 4.1 + t * 0.06) % H;
    const s = 4 + (i % 3) * 2;
    ctx.fillStyle = colors[i % colors.length];
    ctx.fillRect(x < 0 ? x + W : x, y, s, s);
  }
}

// a cozy camp scene dressing up the title screen
function drawTitleDecor(t) {
  const P = assets.props;
  const trees = [P['tree'], P['tree-b'], P['pine']];
  for (let i = 0, x = -24; x < W + 40; i++, x += 96) { // treetops peeking in
    const img = trees[i % 3];
    const h = 84 + (i % 2) * 24;
    ctx.drawImage(img, x, -h * 0.4, h * (img.width / img.height), h);
  }
  const tent = P['tent'];
  const th = 118, tw = th * (tent.width / tent.height);
  const baseY = H - 36;
  ctx.drawImage(tent, W * 0.05, baseY - th, tw, th);
  const fx = W * 0.05 + tw + 48, fy = baseY - 14;
  ctx.drawImage(P['logs'], fx - 28, fy - 15, 56, 30);
  drawMenuFlame(fx, fy - 6, t);
  const px = assets.sprites['pixely-down'], em = assets.sprites['emily-down'];
  const hh = 84;
  ctx.drawImage(px, fx + 42, baseY - hh, hh * (px.width / px.height), hh);
  ctx.drawImage(em, fx + 42 + 64, baseY - hh, hh * (em.width / em.height), hh);
  const fl = [P['flower-purple'], P['flower-pink'], P['flower-blue']];
  for (let i = 0; i < 6; i++) {
    ctx.drawImage(fl[i % 3], W - 60 - i * 48, H - 48 - (i % 2) * 16, 22, 24);
  }
  ctx.drawImage(P['bush'], W - 120, H - 40, 44, 34);
}

function drawMenuFlame(x, y, t) {
  const h = 30 + Math.sin(t * 0.019) * 5 + Math.sin(t * 0.043) * 3;
  for (const [k, col] of [[1, '#ff5a1f'], [0.68, '#ff9a2b'], [0.4, '#ffd84d']]) {
    const hh = h * k;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(x - hh * 0.38, y);
    ctx.quadraticCurveTo(x - hh * 0.3, y - hh * 0.55, x, y - hh);
    ctx.quadraticCurveTo(x + hh * 0.3, y - hh * 0.55, x + hh * 0.38, y);
    ctx.closePath();
    ctx.fill();
  }
}

function drawSelect(t) {
  const chosen = game.select.chosen;
  const strip = H * 0.14;
  // kids' select-screen palette: bright green split panels, black divider, white title strip
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, strip);
  ctx.fillStyle = '#8ed8f8'; // open sky behind the campers
  ctx.fillRect(0, strip + 8, W / 2 - 12, H);
  ctx.fillStyle = '#7fcdf2';
  ctx.fillRect(W / 2 + 12, strip + 8, W / 2 - 12, H);
  // drifting pixel clouds
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  for (const [cx2, cy2, s] of [[0.14, 0.3, 1], [0.34, 0.42, 0.7], [0.64, 0.32, 1.1], [0.86, 0.45, 0.8]]) {
    const px2 = cx2 * W, py2 = cy2 * H * 0.8;
    ctx.fillRect(px2 - 28 * s, py2, 56 * s, 12 * s);
    ctx.fillRect(px2 - 16 * s, py2 - 10 * s, 32 * s, 12 * s);
  }
  // grassy ground strip with flowers under the campers
  const gt = assets.props['grass'];
  for (let gx = 0; gx < W; gx += 64) ctx.drawImage(gt, gx, H - 56, 64, 64);
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(W / 2 - 12, H - 56, 24, 56);
  const fl = [assets.props['flower-purple'], assets.props['flower-pink'], assets.props['flower-blue']];
  for (let i = 0; i < 8; i++) {
    ctx.drawImage(fl[i % 3], 40 + i * (W - 110) / 8 + (i % 2) * 18, H - 50 - (i % 2) * 10, 20, 22);
  }
  const tr = assets.props['tree'], tb = assets.props['tree-b'];
  ctx.drawImage(tr, 10, H - 130, 96 * (tr.width / tr.height), 96);
  ctx.drawImage(tb, W - 100, H - 130, 96 * (tb.width / tb.height), 96);
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
  if (innerHeight > innerWidth) { // landscape-only: ask for a rotate
    drawRotatePrompt(t);
    requestAnimationFrame(loop);
    return;
  }
  update(dt);
  draw(t);
  requestAnimationFrame(loop);
}

function drawRotatePrompt(t) {
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, innerWidth, innerHeight);
  const cx = innerWidth / 2, cy = innerHeight / 2;
  ctx.save();
  ctx.translate(cx, cy - 40);
  ctx.rotate(Math.sin(t * 0.003) * 0.35 + 0.35); // gently rocks toward landscape
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 5;
  ctx.strokeRect(-28, -48, 56, 96); // phone outline
  ctx.fillRect(-8, 36, 16, 5);      // home bar
  ctx.restore();
  ctx.font = 'bold 22px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  ctx.fillText('Turn your device sideways!', cx, cy + 70);
}

loadAssets().then(a => {
  assets = a;
  resize(); // adopt the real screen aspect now that zones can rebuild
  setState('TITLE');
}).catch(err => {
  console.error(err);
});
requestAnimationFrame(loop);
