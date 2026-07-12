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
    const bw = w * (opts.bw ?? 0.62), bh = h * (opts.bh ?? 0.24);
    p.box = opts.centerBox
      ? { x: cx - bw / 2, y: footY - h * 0.62, w: bw, h: h * 0.5 }
      : { x: cx - bw / 2, y: footY - bh, w: bw, h: bh };
    L.colliders.push(p.box);
  }
  L.props.push(p);
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
  const treeNames = ['tree1' + variant, 'tree2' + variant, 'tree3' + variant, 'pine' + variant];
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
  const center = t => c0 + Math.sin(t / 150 + phase) * 32;
  for (let t = -8; t < len + 8; t += 6) {
    const c = center(t);
    const bands = [[34, '#2f6f9f'], [26, '#58a8d8'], [13, '#a5d8f0']];
    for (const [hw, col] of bands) {
      ctx.fillStyle = col;
      if (vertical) ctx.fillRect(c - hw, t, hw * 2, 7);
      else ctx.fillRect(t, c - hw, 7, hw * 2);
    }
    if (rng() < 0.10) {
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      const fo = (rng() - 0.5) * 40;
      if (vertical) ctx.fillRect(c + fo, t, 3, 3); else ctx.fillRect(t, c + fo, 3, 3);
    }
  }
  for (let t = 0; t < len; t += 24) {
    const c = center(t + 12);
    L.waters.push(vertical ? { x: c - 32, y: t, w: 64, h: 24 } : { x: t, y: c - 32, w: 24, h: 64 });
  }
  // bridge: kids' stone bridge, walkable strip over the water
  const bc = center(bridgeAt);
  // widen the water under the bridge so the bridge crop's water edges blend in
  for (const [rx, ry, col] of [[86, 42, '#2f6f9f'], [78, 36, '#58a8d8'], [62, 26, '#a5d8f0']]) {
    ctx.fillStyle = col;
    ctx.beginPath();
    if (vertical) ctx.ellipse(bc, bridgeAt, rx, ry, 0, 0, Math.PI * 2);
    else ctx.ellipse(bridgeAt, bc, ry, rx, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const img = assets.props['bridge'];
  const bw = 148, bh = bw * (img.height / img.width);
  if (vertical) {
    L.props.push({ img, x: bc - bw / 2, y: bridgeAt - bh / 2, w: bw, h: bh, baseY: 0 }); // baseY 0: under entities
    L.bridges.push({ x: bc - 56, y: bridgeAt - 44, w: 112, h: 88 });
  } else {
    L.props.push({ img, x: bridgeAt - bw / 2, y: bc - bh / 2, w: bw, h: bh, baseY: 0 });
    L.bridges.push({ x: bridgeAt - 56, y: bc - 44, w: 112, h: 88 });
  }
}

// ---- zone recipes ----

export function buildZoneLayout(key, assets) {
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
    campsite: 'grass2', battlefield: 'grass1', rocks: 'grass1',
    darkwoods: 'grass1-dark', riverbend: 'grass2', meadow: 'grass1-sunny',
    hollow: 'grass1-dark', autumn: 'grass2-autumn', pines: 'grass1-dark',
  };
  const baseDecor = [[['flower1', 'flower2'], 10, 22, 34], [['sparkle'], 3, 20, 30]];
  const decorByType = {
    meadow: [[['flower1', 'flower2'], 46, 24, 40], [['sparkle'], 8, 22, 34]],
    autumn: [[['stone1', 'stone2'], 14, 30, 48], [['flower2'], 8, 22, 32]],
    rocks: [[['stone1', 'stone2'], 18, 28, 52], [['flower1'], 6, 22, 30]],
    hollow: [[['mushroom1', 'mushroom2'], 12, 22, 36], [['stone2'], 6, 30, 44]],
  };
  L.ground = makeGround(assets, rng, groundByType[def.type], decorByType[def.type] || baseDecor);

  borderWalls(L, gaps);

  if (def.type === 'campsite') {
    river(L, rng, true, W * 0.72, H * 0.5, assets);
    const cave = addProp(L, P['cave-dark'], W * 0.17, H * 0.26, 128, { bw: 0.85, bh: 0.5 });
    L.caveDoor = { x: cave.x + cave.w * 0.32, y: cave.y + cave.h * 0.55, w: cave.w * 0.36, h: cave.h * 0.42 };
    addProp(L, P['sign-go'], W * 0.17 + 95, H * 0.26, 46, { solid: false });
    addProp(L, P['well'], W * 0.46, H * 0.44, 88, { bw: 0.8, bh: 0.4 });
    addProp(L, P['pine-big'], W * 0.3, H * 0.3, 165);
    L.chestSpot = { x: W * 0.35, y: H * 0.66 };   // chest becomes interactive in Phase D
    L.firePit = { x: W * 0.27, y: H * 0.74 };     // tent + bonfire land here in Phase D
    addProp(L, P['chest'], L.chestSpot.x, L.chestSpot.y, 54, { bw: 0.9, bh: 0.3 });
    addProp(L, P['sign-post'], W * 0.6, H * 0.72, 46, { solid: false });
    scatter(L, rng, [P['tree1'], P['tree2'], P['tree3']], 3, 80, 110);
  } else if (def.type === 'battlefield') {
    const cave = addProp(L, P['cave-stone'], W * 0.21, H * 0.33, 205, { bw: 0.8, bh: 0.42 });
    L.caveDoor = { x: cave.x + cave.w * 0.34, y: cave.y + cave.h * 0.5, w: cave.w * 0.32, h: cave.h * 0.48 };
    addProp(L, P['sign-go'], W * 0.21 + 130, H * 0.33, 48, { solid: false });
    addProp(L, P['pond'], W * 0.63, H * 0.36, 175, { bw: 0.8, centerBox: true });
    addProp(L, P['obelisk'], W * 0.79, H * 0.7, 168, { bw: 0.5, bh: 0.2 });
    addProp(L, P['lantern'], W * 0.71, H * 0.78, 54);
    addProp(L, P['sign-motivate'], W * 0.68, H * 0.63, 48, { solid: false });
    scatter(L, rng, [P['tree1'], P['tree2']], 3, 78, 105);
    scatter(L, rng, [P['rock1'], P['rock2']], 3, 36, 54);
  } else if (def.type === 'riverbend') {
    river(L, rng, false, H * 0.44, W * 0.5, assets);
    scatter(L, rng, [P['tree1'], P['tree2'], P['tree3']], 6, 80, 115);
    scatter(L, rng, [P['rock3']], 2, 38, 52);
  } else if (def.type === 'rocks') {
    scatter(L, rng, [P['rock1'], P['rock2'], P['rock3']], 10, 38, 64);
    scatter(L, rng, [P['tree1'], P['tree3']], 4, 80, 108);
    addProp(L, P['lantern'], W * 0.5 + 130, H * 0.5 + 130, 52);
  } else if (def.type === 'darkwoods') {
    scatter(L, rng, [P['tree1-dark'], P['tree2-dark'], P['tree3-dark']], 13, 82, 120);
    scatter(L, rng, [P['pine-dark']], 4, 100, 140);
    scatter(L, rng, [P['mushroom1'], P['mushroom2']], 4, 26, 38, { solid: false });
  } else if (def.type === 'meadow') {
    scatter(L, rng, [P['tree1'], P['tree2']], 3, 78, 100);
    addProp(L, P['well'], W * 0.5 + 150, H * 0.5 - 150, 80, { bw: 0.8, bh: 0.4 });
  } else if (def.type === 'hollow') {
    addProp(L, P['pond'], W * 0.5 + 140, H * 0.5 + 155, 140, { bw: 0.8, centerBox: true });
    scatter(L, rng, [P['tree1-dark'], P['tree3-dark']], 6, 80, 112);
    scatter(L, rng, [P['rock2'], P['rock3']], 4, 36, 54);
  } else if (def.type === 'autumn') {
    scatter(L, rng, [P['tree1-autumn'], P['tree2-autumn'], P['tree3-autumn']], 9, 80, 118);
    scatter(L, rng, [P['pine-autumn']], 3, 95, 130);
    scatter(L, rng, [P['rock1']], 3, 36, 50);
  } else if (def.type === 'pines') {
    scatter(L, rng, [P['pine-dark']], 10, 95, 145);
    scatter(L, rng, [P['pine-big-dark']], 3, 130, 170);
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
