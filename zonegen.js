// Seeded zone generation: every screen is built from props cropped out of the
// kids' two paintings, laid onto tiled grass, with real collision.
import { W, H } from './assets.js';

export const ZONE_DEFS = {
  '0,0': { name: 'Rocky Grove', type: 'rocks' },
  '1,0': { name: "Queen's Clearing", type: 'battlefield' },
  '2,0': { name: 'Deep Woods', type: 'darkwoods' },
  '0,1': { name: 'Willow Bend', type: 'riverbend' },
  '1,1': { name: 'The Campsite', type: 'campsite' },
  '2,1': { name: 'Sunny Meadow', type: 'meadow' },
  '0,2': { name: 'Mossy Hollow', type: 'hollow' },
  '1,2': { name: 'Fern Trail', type: 'autumn' },
  '2,2': { name: 'Shadow Pines', type: 'pines' },
};

const BORDER = 64;   // tree-wall thickness
const GAP = 210;     // opening width in walls that lead to a neighbor
const LANE = 95;     // half-width of the always-clear cross corridors

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashKey(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// ---- collision helpers ----

export function circleHitsBox(x, y, r, b) {
  const cx = Math.max(b.x, Math.min(b.x + b.w, x));
  const cy = Math.max(b.y, Math.min(b.y + b.h, y));
  return (x - cx) * (x - cx) + (y - cy) * (y - cy) < r * r;
}

export function blockedAt(layout, x, y, r) {
  for (const b of layout.colliders) if (circleHitsBox(x, y, r, b)) return true;
  for (const wb of layout.waters) {
    if (circleHitsBox(x, y, r * 0.6, wb)) {
      let onBridge = false;
      for (const br of layout.bridges) {
        if (x > br.x && x < br.x + br.w && y > br.y && y < br.y + br.h) { onBridge = true; break; }
      }
      if (!onBridge) return true;
    }
  }
  return false;
}

// Axis-separated movement with wall sliding. Returns which axes hit.
export function moveWithCollision(ent, dx, dy, layout, r) {
  let hitX = false, hitY = false;
  if (dx) {
    const nx = ent.x + dx;
    if (!blockedAt(layout, nx, ent.y, r)) ent.x = nx; else hitX = true;
  }
  if (dy) {
    const ny = ent.y + dy;
    if (!blockedAt(layout, ent.x, ny, r)) ent.y = ny; else hitY = true;
  }
  return { hitX, hitY };
}

export function randomOpenSpot(layout, margin = 40, avoid = null, avoidDist = 0) {
  for (let i = 0; i < 60; i++) {
    const x = BORDER + margin + Math.random() * (W - 2 * (BORDER + margin));
    const y = BORDER + margin + 30 + Math.random() * (H - 2 * (BORDER + margin) - 30);
    if (blockedAt(layout, x, y, 34)) continue;
    if (avoid && Math.hypot(x - avoid.x, y - avoid.y) < avoidDist) continue;
    return { x, y };
  }
  return { x: W / 2, y: H / 2 + 120 }; // safe fallback: the clear cross lanes
}

// ---- building blocks ----

function addProp(L, img, cx, footY, h, opts = {}) {
  const w = h * (img.width / img.height);
  const p = { img, x: cx - w / 2, y: footY - h, w, h, baseY: footY - h * 0.06 };
  if (opts.solid !== false) {
    const bw = w * (opts.bw ?? 0.72), bh = h * (opts.bh ?? 0.3);
    p.box = opts.centerBox
      ? { x: cx - bw / 2, y: footY - h * 0.62, w: bw, h: h * 0.5 }
      : { x: cx - bw / 2, y: footY - bh, w: bw, h: bh };
    L.colliders.push(p.box);
  }
  L.props.push(p);
  return p;
}

// Cave collision with a real doorway: the drawn cave has its dark opening at
// the bottom center, so walking up into it triggers the tunnel.
function caveWithDoor(L, img, cx, footY, h) {
  const p = addProp(L, img, cx, footY, h, { solid: false });
  const doorW = p.w * 0.41; // matches the drawn opening
  const wallY = footY - h * 0.52;
  L.colliders.push({ x: p.x, y: wallY, w: cx - doorW / 2 - p.x, h: h * 0.52 });
  L.colliders.push({ x: cx + doorW / 2, y: wallY, w: p.x + p.w - (cx + doorW / 2), h: h * 0.52 });
  L.colliders.push({ x: p.x + p.w * 0.06, y: footY - h * 0.86, w: p.w * 0.88, h: h * 0.38 }); // back wall
  L.caveDoor = { x: cx - doorW / 2, y: footY - h * 0.4, w: doorW, h: h * 0.4 + 22 };
  return p;
}

function inLane(x, y) {
  return Math.abs(x - W / 2) < LANE || Math.abs(y - H / 2) < LANE;
}

function scatter(L, rng, imgs, count, hMin, hMax, opts = {}) {
  for (let i = 0; i < count; i++) {
    for (let t = 0; t < 30; t++) {
      const x = BORDER + 50 + rng() * (W - 2 * BORDER - 100);
      const y = BORDER + 90 + rng() * (H - 2 * BORDER - 130);
      if (!opts.allowLane && inLane(x, y)) continue;
      if (blockedAt(L, x, y, 78)) continue;
      addProp(L, imgs[Math.floor(rng() * imgs.length)], x, y, hMin + rng() * (hMax - hMin), opts);
      break;
    }
  }
}

function borderWalls(L, gaps) {
  const gs = (W - GAP) / 2, ge = (W + GAP) / 2;
  const vs = (H - GAP) / 2, ve = (H + GAP) / 2;
  const push = b => L.colliders.push(b);
  if (gaps.n) { push({ x: 0, y: -40, w: gs, h: BORDER + 40 }); push({ x: ge, y: -40, w: W - ge, h: BORDER + 40 }); }
  else push({ x: 0, y: -40, w: W, h: BORDER + 40 });
  if (gaps.s) { push({ x: 0, y: H - BORDER, w: gs, h: BORDER + 40 }); push({ x: ge, y: H - BORDER, w: W - ge, h: BORDER + 40 }); }
  else push({ x: 0, y: H - BORDER, w: W, h: BORDER + 40 });
  if (gaps.w) { push({ x: -40, y: 0, w: BORDER + 40, h: vs }); push({ x: -40, y: ve, w: BORDER + 40, h: H - ve }); }
  else push({ x: -40, y: 0, w: BORDER + 40, h: H });
  if (gaps.e) { push({ x: W - BORDER, y: 0, w: BORDER + 40, h: vs }); push({ x: W - BORDER, y: ve, w: BORDER + 40, h: H - ve }); }
  else push({ x: W - BORDER, y: 0, w: BORDER + 40, h: H });
}

function borderTrees(L, rng, assets, variant = '') {
  const treeNames = ['tree' + variant, 'tree' + (variant === '' ? '-b' : variant + 'b'), 'pine' + variant];
  const place = (cx, footY) => {
    const img = assets.props[treeNames[Math.floor(rng() * treeNames.length)]];
    const h = 84 + rng() * 46;
    const w = h * (img.width / img.height);
    L.props.push({ img, x: cx - w / 2, y: footY - h, w, h, baseY: footY - h * 0.06 });
  };
  const gs = (W - GAP) / 2 - 20, ge = (W + GAP) / 2 + 20;
  const vs = (H - GAP) / 2 - 20, ve = (H + GAP) / 2 + 20;
  for (let x = 24; x < W - 10; x += 52 + rng() * 34) {
    if (!(L.gaps.n && x > gs && x < ge)) place(x + rng() * 10, BORDER * 0.9 + rng() * 26);
    if (!(L.gaps.s && x > gs && x < ge)) place(x + rng() * 10, H - 4 + rng() * 14);
  }
  for (let y = BORDER + 30; y < H - 20; y += 56 + rng() * 34) {
    if (!(L.gaps.w && y > vs && y < ve)) place(20 + rng() * 22, y);
    if (!(L.gaps.e && y > vs && y < ve)) place(W - 42 + rng() * 22, y);
  }
}

function makeGround(assets, rng, tileName, decor) {
  const tile = assets.props[tileName];
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const T = tile.width;
  for (let ty = 0; ty * T < H; ty++) {
    for (let tx = 0; tx * T < W; tx++) {
      ctx.save();
      // mirror-tiling: alternate flips keep the seams continuous
      ctx.translate(tx * T + (tx % 2 ? T : 0), ty * T + (ty % 2 ? T : 0));
      ctx.scale(tx % 2 ? -1 : 1, ty % 2 ? -1 : 1);
      ctx.drawImage(tile, 0, 0);
      ctx.restore();
    }
  }
  for (const [names, count, hMin, hMax] of decor) {
    for (let i = 0; i < count; i++) {
      const img = assets.props[names[Math.floor(rng() * names.length)]];
      const h = hMin + rng() * (hMax - hMin);
      const w = h * (img.width / img.height);
      ctx.drawImage(img, 60 + rng() * (W - 120) - w / 2, 70 + rng() * (H - 140), w, h);
    }
  }
  return c;
}

// ---- rivers ----

function river(L, rng, vertical, c0, bridgeAt, assets) {
  const ctx = L.ground.getContext('2d');
  const phase = rng() * 6;
  const len = vertical ? H : W;
  const PX = 8; // stair-stepped 8px blocks — proper 8-bit water
  const center = t => Math.round((c0 + Math.sin(t / 150 + phase) * 32) / PX) * PX;
  // blocky pool under the bridge so the bridge crop's water edges blend in
  const bc = center(bridgeAt);
  const pool = (rx, ry, col) => {
    ctx.fillStyle = col;
    for (let dy = -ry; dy < ry; dy += PX) {
      const hw = Math.floor(rx * Math.sqrt(Math.max(0, 1 - (dy / ry) ** 2)) / PX) * PX;
      if (vertical) ctx.fillRect(bc - hw, bridgeAt + dy, hw * 2, PX);
      else ctx.fillRect(bridgeAt + dy, bc - hw, PX, hw * 2);
    }
  };
  // grassy shore, dark edge, calm body — with sparse light ripples
  const bands = [[48, '#3d7c2b'], [42, '#2b6a95'], [34, '#4f9fd4']];
  for (let t = -PX; t < len + PX; t += PX) {
    const c = center(t);
    for (const [hw, col] of bands) {
      ctx.fillStyle = col;
      if (vertical) ctx.fillRect(c - hw, t, hw * 2, PX);
      else ctx.fillRect(t, c - hw, PX, hw * 2);
    }
    if (rng() < 0.35) { // ripple dashes
      ctx.fillStyle = rng() < 0.25 ? '#e8f6ff' : '#8ec6e8';
      const fo = (Math.floor(rng() * 7) - 3) * PX;
      if (vertical) ctx.fillRect(c + fo, t, PX, PX / 2);
      else ctx.fillRect(t, c + fo, PX / 2, PX);
    }
  }
  pool(84, 42, '#2b6a95');
  pool(74, 34, '#4f9fd4');
  for (let t = 0; t < len; t += 24) {
    const c = center(t);
    L.waters.push(vertical ? { x: c - 38, y: t, w: 76, h: 24 } : { x: t, y: c - 38, w: 24, h: 76 });
  }
  // the kids' stone bridge — rotated so the walkway crosses the water
  const img = vertical ? assets.props['bridge'] : assets.props['bridge-h'];
  if (vertical) {
    const bw = 148, bh = bw * (img.height / img.width);
    L.props.push({ img, x: bc - bw / 2, y: bridgeAt - bh / 2, w: bw, h: bh, baseY: 0 }); // baseY 0: under entities
    L.bridges.push({ x: bc - 56, y: bridgeAt - 46, w: 112, h: 92 });
  } else {
    const bh = 148, bw = bh * (img.width / img.height);
    L.props.push({ img, x: bridgeAt - bw / 2, y: bc - bh / 2, w: bw, h: bh, baseY: 0 });
    L.bridges.push({ x: bridgeAt - 46, y: bc - 56, w: 92, h: 112 });
  }
}

// Nearest walkable spot to (x, y) — rescues anyone who ends up inside a wall.
export function findOpenNear(layout, x, y) {
  if (!blockedAt(layout, x, y, 22)) return { x, y };
  for (let r = 24; r <= 420; r += 24) {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const nx = Math.max(30, Math.min(W - 30, x + Math.cos(a) * r));
      const ny = Math.max(80, Math.min(H - 30, y + Math.sin(a) * r));
      if (!blockedAt(layout, nx, ny, 22)) return { x: nx, y: ny };
    }
  }
  return { x: W / 2, y: H / 2 };
}

// ---- underground tunnel (linked by the two caves) ----

function buildCaveLayout(assets) {
  const rng = mulberry32(hashKey('U:' + W));
  const L = {
    name: 'The Old Tunnel', type: 'cave', gaps: {},
    props: [], colliders: [], waters: [], bridges: [],
    caveDoor: null, tentDoor: null, chestSpot: null, firePit: null,
    exits: [], _snap: null,
  };
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  // stone floor
  ctx.fillStyle = '#332e28';
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = ['#3a352e', '#2c2822', '#403a32', '#37322b'][Math.floor(rng() * 4)];
    ctx.fillRect(Math.floor(rng() * W / 8) * 8, Math.floor(rng() * H / 8) * 8, 8, 8);
  }
  // rocky walls: dark blobs ringing the room
  const wall = (x, y, r) => {
    ctx.fillStyle = '#1c1916';
    ctx.beginPath(); ctx.arc(x, y + 6, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#4a4238';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#5d5548';
    ctx.beginPath(); ctx.arc(x - r * 0.25, y - r * 0.3, r * 0.5, 0, Math.PI * 2); ctx.fill();
  };
  for (let x = 0; x < W + 40; x += 46) { wall(x + rng() * 20, 30 + rng() * 26, 34 + rng() * 16); wall(x + rng() * 20, H - 36 - rng() * 20, 34 + rng() * 16); }
  for (let y = 60; y < H - 40; y += 48) { wall(26 + rng() * 22, y, 34 + rng() * 14); wall(W - 30 - rng() * 22, y, 34 + rng() * 14); }
  borderWalls(L, {});
  // glowing crystals (the kids' gem, cyan-shifted, with a light pool)
  const gem = assets.sprites['gem'];
  for (let i = 0; i < 7; i++) {
    const x = 140 + rng() * (W - 280), y = 150 + rng() * (H - 280);
    const g = ctx.createRadialGradient(x, y, 4, x, y, 55);
    g.addColorStop(0, 'rgba(120,220,255,0.35)');
    g.addColorStop(1, 'rgba(120,220,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 55, y - 55, 110, 110);
    const h = 24 + rng() * 16, w = h * (gem.width / gem.height);
    ctx.drawImage(gem, x - w / 2, y - h / 2, w, h);
  }
  // two lit exits: west ladder -> campsite cave, east ladder -> battlefield cave
  const ladder = (x, y) => {
    const g = ctx.createRadialGradient(x, y, 6, x, y, 80);
    g.addColorStop(0, 'rgba(255,240,180,0.5)');
    g.addColorStop(1, 'rgba(255,240,180,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 80, y - 80, 160, 160);
    ctx.fillStyle = '#7a5a30';
    ctx.fillRect(x - 22, y - 46, 8, 92); ctx.fillRect(x + 14, y - 46, 8, 92);
    for (let r = -38; r <= 38; r += 14) ctx.fillRect(x - 22, y + r, 44, 6);
  };
  const ex1 = { x: W * 0.14, y: H * 0.5 }, ex2 = { x: W * 0.86, y: H * 0.5 };
  ladder(ex1.x, ex1.y); ladder(ex2.x, ex2.y);
  L.exits.push({ rect: { x: ex1.x - 40, y: ex1.y - 50, w: 80, h: 100 }, to: '1,1' });
  L.exits.push({ rect: { x: ex2.x - 40, y: ex2.y - 50, w: 80, h: 100 }, to: '1,0' });
  L.ground = c;
  return L;
}

// ---- zone recipes ----

export function buildZoneLayout(key, assets) {
  if (key === 'U') return buildCaveLayout(assets);
  const def = ZONE_DEFS[key];
  const rng = mulberry32(hashKey(key + ':' + W));
  const [zx, zy] = key.split(',').map(Number);
  const gaps = { n: zy > 0, s: zy < 2, w: zx > 0, e: zx < 2 };
  const L = {
    name: def.name, type: def.type, gaps,
    props: [], colliders: [], waters: [], bridges: [],
    caveDoor: null, tentDoor: null, chestSpot: null, firePit: null,
    _snap: null,
  };
  const P = assets.props;

  const groundByType = {
    campsite: 'grass', battlefield: 'grass', rocks: 'grass',
    darkwoods: 'grass-dark', riverbend: 'grass', meadow: 'grass-sunny',
    hollow: 'grass-dark', autumn: 'grass-autumn', pines: 'grass-dark',
  };
  const FLOWERS = ['flower-purple', 'flower-blue', 'flower-pink'];
  const baseDecor = [[FLOWERS, 10, 20, 28], [['sparkle'], 3, 18, 26]];
  const decorByType = {
    meadow: [[FLOWERS, 46, 22, 32], [['sparkle'], 8, 20, 28]],
    autumn: [[['stone'], 14, 26, 40], [['flower-pink'], 8, 20, 28]],
    rocks: [[['stone'], 18, 26, 44], [['flower-blue'], 6, 20, 26]],
    hollow: [[['mush'], 12, 22, 32], [['stone'], 6, 26, 38]],
  };
  L.ground = makeGround(assets, rng, groundByType[def.type], decorByType[def.type] || baseDecor);

  borderWalls(L, gaps);

  if (def.type === 'campsite') {
    river(L, rng, true, W * 0.72, H * 0.5, assets);
    caveWithDoor(L, P['cave-dark'], W * 0.17, H * 0.26, 132);
    addProp(L, P['sign-go'], W * 0.17 + 105, H * 0.26, 46, { solid: false });
    addProp(L, P['well'], W * 0.46, H * 0.44, 88, { bw: 0.8, bh: 0.4 });
    addProp(L, P['pine'], W * 0.3, H * 0.3, 160);
    // home sweet home: tent (walk in to rest), bonfire, treasure chest
    const tent = addProp(L, P['tent'], W * 0.28, H * 0.82, 140, { bw: 0.8, bh: 0.3 });
    L.tentDoor = { x: tent.x + tent.w * 0.34, y: tent.y + tent.h * 0.6, w: tent.w * 0.32, h: tent.h * 0.46 };
    L.colliders.pop(); // the door replaces the tent's solid box; re-add side walls
    L.colliders.push({ x: tent.x, y: tent.y + tent.h * 0.55, w: tent.w * 0.3, h: tent.h * 0.4 });
    L.colliders.push({ x: tent.x + tent.w * 0.7, y: tent.y + tent.h * 0.55, w: tent.w * 0.3, h: tent.h * 0.4 });
    L.firePit = { x: W * 0.28 + 130, y: H * 0.82 - 10 };
    L.colliders.push({ x: L.firePit.x - 22, y: L.firePit.y - 12, w: 44, h: 22 });
    L.chestSpot = { x: W * 0.42, y: H * 0.76 };
    const chest = addProp(L, P['chest'], L.chestSpot.x, L.chestSpot.y, 54, { bw: 0.9, bh: 0.3 });
    L.chestZone = { x: chest.x - 24, y: chest.y - 20, w: chest.w + 48, h: chest.h + 44 };
    addProp(L, P['sign-post'], W * 0.6, H * 0.72, 46, { solid: false });
    scatter(L, rng, [P['tree'], P['tree-b']], 3, 80, 110);
  } else if (def.type === 'battlefield') {
    caveWithDoor(L, P['cave-stone'], W * 0.21, H * 0.31, 185);
    addProp(L, P['sign-go'], W * 0.21 + 135, H * 0.31, 48, { solid: false });
    addProp(L, P['pond'], W * 0.63, H * 0.36, 175, { bw: 0.8, centerBox: true });
    addProp(L, P['obelisk'], W * 0.79, H * 0.7, 168, { bw: 0.5, bh: 0.2 });
    addProp(L, P['lantern'], W * 0.71, H * 0.78, 54);
    addProp(L, P['sign-motivate'], W * 0.68, H * 0.63, 48, { solid: false });
    scatter(L, rng, [P['tree'], P['tree-b']], 3, 78, 105);
    scatter(L, rng, [P['rock1'], P['rock2']], 3, 36, 54);
  } else if (def.type === 'riverbend') {
    // river sits in the north third, clear of the east/west entry corridors
    river(L, rng, false, H * 0.22, W * 0.5, assets);
    scatter(L, rng, [P['tree'], P['tree-b']], 6, 80, 115);
    scatter(L, rng, [P['rock3']], 2, 38, 52);
  } else if (def.type === 'rocks') {
    scatter(L, rng, [P['rock1'], P['rock2'], P['rock3']], 10, 38, 64);
    scatter(L, rng, [P['tree'], P['tree-b']], 4, 80, 108);
    addProp(L, P['lantern'], W * 0.5 + 130, H * 0.5 + 130, 52);
  } else if (def.type === 'darkwoods') {
    scatter(L, rng, [P['tree-dark'], P['tree-darkb']], 13, 82, 120);
    scatter(L, rng, [P['pine-dark']], 4, 100, 140);
    scatter(L, rng, [P['mush']], 4, 26, 38, { solid: false });
  } else if (def.type === 'meadow') {
    scatter(L, rng, [P['tree'], P['tree-b']], 3, 78, 100);
    addProp(L, P['well'], W * 0.5 + 150, H * 0.5 - 150, 80, { bw: 0.8, bh: 0.4 });
  } else if (def.type === 'hollow') {
    addProp(L, P['pond'], W * 0.5 + 140, H * 0.5 + 155, 140, { bw: 0.8, centerBox: true });
    scatter(L, rng, [P['tree-dark'], P['tree-darkb']], 6, 80, 112);
    scatter(L, rng, [P['rock2'], P['rock3']], 4, 36, 54);
  } else if (def.type === 'autumn') {
    scatter(L, rng, [P['tree-autumn'], P['tree-autumnb']], 9, 80, 118);
    scatter(L, rng, [P['pine-autumn']], 3, 95, 130);
    scatter(L, rng, [P['rock1']], 3, 36, 50);
  } else if (def.type === 'pines') {
    scatter(L, rng, [P['pine-dark']], 10, 95, 145);
    scatter(L, rng, [P['pine-dark']], 3, 130, 168);
    scatter(L, rng, [P['rock2']], 3, 38, 54);
  }

  borderTrees(L, rng, assets, def.type === 'darkwoods' || def.type === 'pines' ? '-dark' : def.type === 'autumn' ? '-autumn' : '');
  L.props.sort((a, b) => a.baseY - b.baseY);
  return L;
}

// Static composite (ground + props) used for slide transitions.
export function snapshotLayout(L) {
  if (L._snap) return L._snap;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(L.ground, 0, 0);
  for (const p of L.props) ctx.drawImage(p.img, p.x, p.y, p.w, p.h);
  L._snap = c;
  return c;
}
