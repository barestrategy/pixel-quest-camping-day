// Asset loading, sprite trimming, walk-frame generation, and zone building.
// World height is fixed; width follows the screen aspect so the game always
// fills the display (no letterbox bars).
export const H = 720;
export let W = 960;

export function setWorldWidth(w) {
  W = Math.max(560, Math.min(1680, Math.round(w)));
}

const IMAGE_NAMES = [
  'pixely-up', 'pixely-down', 'pixely-left', 'pixely-right',
  'emily-up', 'emily-down', 'emily-left', 'emily-right',
  'queen-ant', 'coin', 'gem', 'mushroom',
  'screen-title', 'screen-died', 'screen-win', 'start-button',
];

const SPRITE_NAMES = [
  'pixely-up', 'pixely-down', 'pixely-left', 'pixely-right',
  'emily-up', 'emily-down', 'emily-left', 'emily-right',
  'queen-ant', 'coin', 'gem', 'mushroom', 'start-button',
];

const HERO_DIR_NAMES = [
  'pixely-up', 'pixely-down', 'pixely-left', 'pixely-right',
  'emily-up', 'emily-down', 'emily-left', 'emily-right',
];

// The whole prop set is now code-drawn — no more crops from the paintings.

function rotate90(src) {
  const c = document.createElement('canvas');
  c.width = src.height; c.height = src.width;
  const x = c.getContext('2d');
  x.translate(c.width / 2, c.height / 2);
  x.rotate(Math.PI / 2);
  x.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}

// A clean pixel well to replace the messy crop from the painting.
function makeWell() {
  const c = document.createElement('canvas');
  c.width = 96; c.height = 100;
  const x = c.getContext('2d');
  const blockEllipse = (cx, cy, rx, ry, col) => {
    x.fillStyle = col;
    for (let dy = -ry; dy < ry; dy += 4) {
      const hw = Math.floor(rx * Math.sqrt(Math.max(0, 1 - (dy / ry) ** 2)) / 4) * 4;
      x.fillRect(cx - hw, cy + dy, hw * 2, 4);
    }
  };
  // posts and little roof
  x.fillStyle = '#6b4a26';
  x.fillRect(12, 16, 8, 52); x.fillRect(76, 16, 8, 52);
  x.fillStyle = '#8a5f33'; x.fillRect(4, 12, 88, 8);
  x.fillStyle = '#a9713d'; x.fillRect(12, 4, 72, 8);
  x.fillStyle = '#4a3418'; x.fillRect(20, 34, 56, 5); // crank bar
  x.fillStyle = '#7d5a2e'; x.fillRect(41, 39, 14, 11); // bucket
  x.fillStyle = '#5c3f1c'; x.fillRect(41, 39, 14, 3);
  // stone ring
  blockEllipse(48, 76, 44, 20, '#6e695f');
  blockEllipse(48, 72, 44, 20, '#9a958a');
  blockEllipse(48, 72, 30, 12, '#191512');
  x.fillStyle = '#c9c4b8'; // highlight blocks
  x.fillRect(16, 62, 8, 4); x.fillRect(60, 84, 8, 4);
  return c;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('failed to load ' + src));
    img.src = src;
  });
}

// Crop an image to its non-transparent bounds; returns a canvas.
function trim(img) {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height).data;
  let minX = c.width, minY = c.height, maxX = -1, maxY = -1;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      if (data[(y * c.width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return c; // fully transparent, shouldn't happen
  const out = document.createElement('canvas');
  out.width = maxX - minX + 1; out.height = maxY - minY + 1;
  out.getContext('2d').drawImage(c, -minX, -minY);
  return out;
}

// CSS-filter-spec hue-rotate matrix + brightness/saturate, applied per pixel.
// Done manually because iOS Safari lacks CanvasRenderingContext2D.filter.
export function applyColorFilter(canvas, { hue = 0, bright = 1, sat = 1 }) {
  if (!hue && bright === 1 && sat === 1) return canvas;
  const ctx = canvas.getContext('2d');
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = imgData.data;
  const a = (hue * Math.PI) / 180;
  const cos = Math.cos(a), sin = Math.sin(a);
  // hue-rotate matrix (CSS Filter Effects spec)
  let m = [
    0.213 + cos * 0.787 - sin * 0.213, 0.715 - cos * 0.715 - sin * 0.715, 0.072 - cos * 0.072 + sin * 0.928,
    0.213 - cos * 0.213 + sin * 0.143, 0.715 + cos * 0.285 + sin * 0.140, 0.072 - cos * 0.072 - sin * 0.283,
    0.213 - cos * 0.213 - sin * 0.787, 0.715 - cos * 0.715 + sin * 0.715, 0.072 + cos * 0.928 + sin * 0.072,
  ];
  if (sat !== 1) {
    // compose with saturate matrix
    const s = [
      0.213 + 0.787 * sat, 0.715 - 0.715 * sat, 0.072 - 0.072 * sat,
      0.213 - 0.213 * sat, 0.715 + 0.285 * sat, 0.072 - 0.072 * sat,
      0.213 - 0.213 * sat, 0.715 - 0.715 * sat, 0.072 + 0.928 * sat,
    ];
    const out = new Array(9);
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 3; c++)
        out[r * 3 + c] = m[r * 3] * s[c] + m[r * 3 + 1] * s[3 + c] + m[r * 3 + 2] * s[6 + c];
    m = out;
  }
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    d[i]     = Math.min(255, (m[0] * r + m[1] * g + m[2] * b) * bright);
    d[i + 1] = Math.min(255, (m[3] * r + m[4] * g + m[5] * b) * bright);
    d[i + 2] = Math.min(255, (m[6] * r + m[7] * g + m[8] * b) * bright);
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

// Two-frame walk cycle: legs (bottom ~28%) split into halves that lift alternately.
function makeWalkFrames(spr) {
  const legY = Math.round(spr.height * 0.72);
  const legH = spr.height - legY;
  const halfW = Math.round(spr.width / 2);
  const frames = [];
  for (const [dl, dr] of [[-Math.max(3, spr.height * 0.03), 0], [0, -Math.max(3, spr.height * 0.03)]]) {
    const c = document.createElement('canvas');
    c.width = spr.width; c.height = spr.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(spr, 0, legY, halfW, legH, 0, legY + dl, halfW, legH);
    ctx.drawImage(spr, halfW, legY, spr.width - halfW, legH, halfW, legY + dr, spr.width - halfW, legH);
    ctx.drawImage(spr, 0, 0, spr.width, legY, 0, 0, spr.width, legY); // torso over lifted legs
    frames.push(c);
  }
  return frames;
}

function sampleColor(img) {
  const c = document.createElement('canvas');
  c.width = 8; c.height = 8;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, 8, 8, 0, 0, 8, 8); // top-left corner block
  const d = ctx.getImageData(4, 4, 1, 1).data;
  return `rgb(${d[0]},${d[1]},${d[2]})`;
}

// The kids' art has no tent or campfire — these two are drawn to match.
function makeTent() {
  const c = document.createElement('canvas');
  c.width = 140; c.height = 110;
  const x = c.getContext('2d');
  x.fillStyle = '#e06a24';
  x.beginPath(); x.moveTo(70, 4); x.lineTo(134, 102); x.lineTo(6, 102); x.closePath(); x.fill();
  x.fillStyle = '#c2531a'; // right-side shading
  x.beginPath(); x.moveTo(70, 4); x.lineTo(134, 102); x.lineTo(70, 102); x.closePath(); x.fill();
  x.strokeStyle = '#5c2508'; x.lineWidth = 5; x.lineJoin = 'round';
  x.beginPath(); x.moveTo(70, 4); x.lineTo(134, 102); x.lineTo(6, 102); x.closePath(); x.stroke();
  x.fillStyle = '#2b1608'; // door
  x.beginPath(); x.moveTo(70, 32); x.lineTo(94, 102); x.lineTo(46, 102); x.closePath(); x.fill();
  x.strokeStyle = '#ffd84d'; x.lineWidth = 3; // trim
  x.beginPath(); x.moveTo(70, 32); x.lineTo(94, 102); x.moveTo(70, 32); x.lineTo(46, 102); x.stroke();
  return c;
}

function makeLogs() {
  const c = document.createElement('canvas');
  c.width = 56; c.height = 30;
  const x = c.getContext('2d');
  x.strokeStyle = '#6b4a26'; x.lineWidth = 8; x.lineCap = 'round';
  x.beginPath(); x.moveTo(10, 20); x.lineTo(46, 13); x.stroke();
  x.strokeStyle = '#57381b';
  x.beginPath(); x.moveTo(10, 11); x.lineTo(46, 21); x.stroke();
  x.fillStyle = '#8f8b80'; // stone ring
  [[5, 24], [17, 27], [30, 28], [43, 26], [51, 22]].forEach(([sx, sy]) => {
    x.beginPath(); x.arc(sx, sy, 4.5, 0, 7); x.fill();
  });
  return c;
}

function makeBerry() {
  const c = document.createElement('canvas');
  c.width = 26; c.height = 26;
  const x = c.getContext('2d');
  x.fillStyle = '#2f8a1f';
  x.fillRect(11, 2, 4, 6); // stem
  x.fillRect(14, 4, 7, 4); // leaf
  for (const [bx, by] of [[8, 14], [16, 14], [12, 19]]) {
    x.fillStyle = '#d81f30';
    x.beginPath(); x.arc(bx, by, 6, 0, 7); x.fill();
    x.fillStyle = '#ff8a94';
    x.fillRect(bx - 3, by - 4, 2, 2);
  }
  return c;
}

function makeSmore() {
  const c = document.createElement('canvas');
  c.width = 30; c.height = 24;
  const x = c.getContext('2d');
  x.fillStyle = '#c98a3b'; x.fillRect(2, 1, 26, 6);   // graham top
  x.fillStyle = '#fffdf2'; x.fillRect(4, 7, 22, 6);   // marshmallow
  x.fillStyle = '#5d3413'; x.fillRect(3, 13, 24, 4);  // chocolate
  x.fillStyle = '#c98a3b'; x.fillRect(2, 17, 26, 6);  // graham bottom
  x.fillStyle = '#e8ab5e'; x.fillRect(2, 1, 26, 2); x.fillRect(2, 17, 26, 2);
  return c;
}

function makeHat(kind) {
  const c = document.createElement('canvas');
  c.width = 36; c.height = 26;
  const x = c.getContext('2d');
  if (kind === 'party') {
    x.fillStyle = '#ff4fa3';
    x.beginPath(); x.moveTo(18, 1); x.lineTo(30, 24); x.lineTo(6, 24); x.closePath(); x.fill();
    x.fillStyle = '#ffd84d';
    x.fillRect(14, 8, 3, 3); x.fillRect(20, 14, 3, 3); x.fillRect(11, 18, 3, 3);
    x.beginPath(); x.arc(18, 3, 4, 0, 7); x.fill();
  } else if (kind === 'crown') {
    x.fillStyle = '#ffd84d';
    x.beginPath();
    x.moveTo(5, 24); x.lineTo(5, 8); x.lineTo(12, 16); x.lineTo(18, 4); x.lineTo(24, 16); x.lineTo(31, 8); x.lineTo(31, 24);
    x.closePath(); x.fill();
    x.fillStyle = '#e8302a'; x.fillRect(16, 17, 4, 4);
  } else { // wizard
    x.fillStyle = '#4053c9';
    x.beginPath(); x.moveTo(18, 0); x.lineTo(27, 20); x.lineTo(9, 20); x.closePath(); x.fill();
    x.fillRect(2, 20, 32, 5);
    x.fillStyle = '#ffd84d'; x.fillRect(16, 10, 4, 4);
  }
  return c;
}

// ---- code-drawn pixel props (same chunky style as the well) ----

function mk(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// blocky ellipse — the core shape of the whole prop set
function bEllipse(x, cx, cy, rx, ry, col, B = 4) {
  x.fillStyle = col;
  for (let dy = -ry; dy < ry; dy += B) {
    const hw = Math.floor(rx * Math.sqrt(Math.max(0, 1 - ((dy + B / 2) / ry) ** 2)) / B) * B;
    x.fillRect(cx - hw, cy + dy, hw * 2, B);
  }
}

function speck(x, rng, n, xa, ya, xb, yb, cols, B = 4) {
  for (let i = 0; i < n; i++) {
    x.fillStyle = cols[Math.floor(rng() * cols.length)];
    x.fillRect(xa + Math.floor(rng() * (xb - xa) / B) * B, ya + Math.floor(rng() * (yb - ya) / B) * B, B, B);
  }
}

const rng01 = seed => { let a = seed; return () => { a = (a * 1103515245 + 12345) & 0x7fffffff; return a / 0x7fffffff; }; };

const TREE_PALS = {
  '':        { leafD: '#2e6b23', leaf: '#429331', leafL: '#61b649', trunk: '#6b4a26', trunkD: '#57381b' },
  '-b':      { leafD: '#2a6130', leaf: '#3a883f', leafL: '#55ab52', trunk: '#6b4a26', trunkD: '#57381b' },
  '-dark':   { leafD: '#1d4718', leaf: '#2b6322', leafL: '#3d7d30', trunk: '#4a3418', trunkD: '#38260f' },
  '-darkb':  { leafD: '#1b4022', leaf: '#28592c', leafL: '#39733c', trunk: '#4a3418', trunkD: '#38260f' },
  '-autumn': { leafD: '#8a4d16', leaf: '#b56a1e', leafL: '#dd922e', trunk: '#5c3a1c', trunkD: '#452a11' },
  '-autumnb':{ leafD: '#7d3f12', leaf: '#a85a24', leafL: '#cc7f2e', trunk: '#5c3a1c', trunkD: '#452a11' },
};

function makeTree(pal, seed) {
  const c = mk(88, 108);
  const x = c.getContext('2d');
  const rng = rng01(seed);
  x.fillStyle = pal.trunk; x.fillRect(36, 72, 16, 32);
  x.fillStyle = pal.trunkD; x.fillRect(46, 72, 6, 32);
  bEllipse(x, 44, 46, 40, 36, pal.leafD);
  bEllipse(x, 40, 40, 32, 28, pal.leaf);
  bEllipse(x, 34, 32, 18, 14, pal.leafL);
  speck(x, rng, 14, 12, 12, 76, 70, [pal.leafL, pal.leafD]);
  return c;
}

function makePine(pal) {
  const c = mk(72, 124);
  const x = c.getContext('2d');
  x.fillStyle = pal.trunk; x.fillRect(30, 100, 12, 24);
  const tier = (topY, halfW, hgt, col, off = 0) => {
    x.fillStyle = col;
    for (let dy = 0; dy < hgt; dy += 4) {
      const hw = Math.floor((halfW * (dy + 4) / hgt) / 4) * 4;
      x.fillRect(36 + off - hw, topY + dy, hw * 2, 4);
    }
  };
  tier(44, 34, 60, pal.leafD);
  tier(24, 26, 52, pal.leaf);
  tier(4, 18, 40, pal.leafL, -2);
  return c;
}

const PINE_PALS = {
  '':        { leafD: '#24512c', leaf: '#33703c', leafL: '#4b9150', trunk: '#57381b' },
  '-dark':   { leafD: '#183a20', leaf: '#24512c', leafL: '#33703c', trunk: '#38260f' },
  '-autumn': { leafD: '#6b3d12', leaf: '#96591c', leafL: '#bf7c28', trunk: '#452a11' },
};

function makeRock(w, h, seed) {
  const c = mk(w, h);
  const x = c.getContext('2d');
  const rng = rng01(seed);
  bEllipse(x, w / 2, h / 2 + 4, w / 2 - 2, h / 2 - 6, '#4a463e');
  bEllipse(x, w / 2, h / 2, w / 2 - 4, h / 2 - 8, '#8b867c');
  bEllipse(x, w / 2 - 6, h / 2 - 6, w / 4, h / 5, '#b3ada1');
  speck(x, rng, 6, 8, h / 3, w - 8, h - 8, ['#6e695f', '#9a958a']);
  return c;
}

function makeStone() {
  const c = mk(40, 22);
  const x = c.getContext('2d');
  bEllipse(x, 20, 12, 18, 8, '#6e695f');
  bEllipse(x, 20, 10, 16, 6, '#9a958a');
  return c;
}

function makeFlower(col) {
  const c = mk(22, 24);
  const x = c.getContext('2d');
  x.fillStyle = '#2f8a1f';
  x.fillRect(10, 12, 3, 10);
  x.fillRect(4, 16, 6, 3);
  x.fillStyle = col;
  x.fillRect(7, 3, 4, 4); x.fillRect(15, 3, 4, 4);
  x.fillRect(7, 9, 4, 4); x.fillRect(15, 9, 4, 4);
  x.fillStyle = '#ffd84d'; x.fillRect(11, 6, 4, 4);
  return c;
}

function makeMush() {
  const c = mk(26, 26);
  const x = c.getContext('2d');
  x.fillStyle = '#efe6d4'; x.fillRect(9, 14, 8, 10);
  bEllipse(x, 13, 10, 12, 7, '#c1272b');
  x.fillStyle = '#fff'; x.fillRect(7, 6, 3, 3); x.fillRect(15, 8, 3, 3);
  return c;
}

function makeSparkleProp() {
  const c = mk(28, 28);
  const x = c.getContext('2d');
  x.fillStyle = '#f4fbff';
  x.fillRect(12, 2, 4, 24); x.fillRect(2, 12, 24, 4);
  x.fillStyle = '#bfe6ff'; x.fillRect(12, 12, 4, 4);
  return c;
}

function makeLantern() {
  const c = mk(36, 56);
  const x = c.getContext('2d');
  x.fillStyle = '#6e695f'; x.fillRect(8, 46, 20, 8);   // base
  x.fillStyle = '#8b867c'; x.fillRect(14, 24, 8, 24);  // post
  x.fillStyle = '#4a463e'; x.fillRect(6, 8, 24, 18);   // housing
  x.fillStyle = '#ffd84d'; x.fillRect(12, 12, 12, 10); // light
  x.fillStyle = '#8b867c'; x.fillRect(4, 4, 28, 6);    // cap
  return c;
}

// top-down wooden bridge: dark rails, planked walkway
function makeBridge() {
  const c = mk(152, 84);
  const x = c.getContext('2d');
  x.fillStyle = '#8a5f33';
  x.fillRect(0, 10, 152, 64);
  x.fillStyle = '#a9713d';
  for (let px = 0; px < 152; px += 16) x.fillRect(px, 10, 8, 64);
  x.fillStyle = '#6b4a26';
  for (let px = 0; px < 152; px += 16) x.fillRect(px + 14, 10, 2, 64);
  x.fillStyle = '#4a3418';
  x.fillRect(0, 0, 152, 10); x.fillRect(0, 74, 152, 10);
  x.fillStyle = '#5c452a';
  for (let px = 0; px < 152; px += 24) { x.fillRect(px, 0, 6, 10); x.fillRect(px, 74, 6, 10); }
  return c;
}

// rocky mound with a dark south-facing doorway at the bottom center
function makeCave(base, light, dark, seed) {
  const c = mk(176, 132);
  const x = c.getContext('2d');
  const rng = rng01(seed);
  bEllipse(x, 88, 78, 86, 54, dark);
  bEllipse(x, 88, 72, 80, 48, base);
  bEllipse(x, 78, 58, 52, 28, light);
  speck(x, rng, 16, 16, 24, 160, 100, [dark, light]);
  x.fillStyle = '#3f7d31'; // mossy top blocks
  speck(x, rng, 8, 40, 12, 130, 40, ['#3f7d31', '#2e6b23']);
  // doorway
  x.fillStyle = '#15100b';
  x.fillRect(56, 78, 64, 54);
  bEllipse(x, 88, 80, 32, 18, '#15100b');
  x.fillStyle = dark; // arch trim
  x.fillRect(52, 76, 6, 56); x.fillRect(118, 76, 6, 56);
  x.fillStyle = '#57381b'; x.fillRect(58, 126, 60, 6); // dirt floor hint
  return c;
}

function makePond() {
  const c = mk(224, 148);
  const x = c.getContext('2d');
  bEllipse(x, 112, 76, 110, 68, '#57524a');
  bEllipse(x, 112, 74, 102, 60, '#8b867c');
  bEllipse(x, 112, 76, 90, 50, '#2b6a95');
  bEllipse(x, 112, 74, 82, 44, '#4f9fd4');
  bEllipse(x, 96, 62, 36, 16, '#8ec6e8');
  const rng = rng01(7);
  speck(x, rng, 8, 48, 40, 180, 110, ['#e8f6ff']);
  for (const [lx, ly] of [[70, 96], [150, 58], [138, 104]]) {
    bEllipse(x, lx, ly, 12, 7, '#3f8f2e');
    bEllipse(x, lx - 2, ly - 1, 6, 3, '#61b649');
  }
  return c;
}

const GRASS_PALS = {
  'grass':        { base: '#65a83c', d: '#58962f', l: '#74ba49' },
  'grass-sunny':  { base: '#85b944', d: '#76a739', l: '#98cc55' },
  'grass-dark':   { base: '#4c7d31', d: '#417029', l: '#588c3a' },
  'grass-autumn': { base: '#b08a3c', d: '#9e7a32', l: '#c19c4a' },
};

function makeGrass(pal, seed) {
  const c = mk(64, 64);
  const x = c.getContext('2d');
  const rng = rng01(seed);
  x.fillStyle = pal.base;
  x.fillRect(0, 0, 64, 64);
  speck(x, rng, 26, 0, 0, 64, 64, [pal.d, pal.l]);
  for (let i = 0; i < 5; i++) { // grass tufts
    const tx = Math.floor(rng() * 15) * 4, ty = Math.floor(rng() * 14) * 4;
    x.fillStyle = pal.l;
    x.fillRect(tx, ty, 2, 6); x.fillRect(tx + 4, ty + 2, 2, 4);
  }
  return c;
}

// readable wooden signpost with actual text on the board
function makeSign(lines) {
  const font = 'bold 15px "Courier New", monospace';
  const meas = mk(1, 1).getContext('2d');
  meas.font = font;
  const tw = Math.max(...lines.map(l => meas.measureText(l).width));
  const lineH = 17, padX = 12;
  const bw = Math.ceil(tw) + padX * 2, bh = lines.length * lineH + 12;
  const c = mk(bw, bh + 26);
  const x = c.getContext('2d');
  x.fillStyle = '#6b4a26'; x.fillRect(bw / 2 - 5, bh - 4, 10, 30); // post
  x.fillStyle = '#8a5f33'; x.fillRect(0, 0, bw, bh);               // board
  x.fillStyle = '#a9713d'; x.fillRect(0, 0, bw, 4);
  x.strokeStyle = '#5c3a1c'; x.lineWidth = 3;
  x.strokeRect(1.5, 1.5, bw - 3, bh - 3);
  x.fillStyle = '#4a3418'; x.fillRect(5, 5, 3, 3); x.fillRect(bw - 8, 5, 3, 3); // nails
  x.font = font; x.textAlign = 'center'; x.fillStyle = '#31200c';
  lines.forEach((l, i) => x.fillText(l, bw / 2, 18 + i * lineH));
  return c;
}

function makeChest() {
  const c = mk(48, 42);
  const x = c.getContext('2d');
  x.fillStyle = '#5c3a1c'; x.fillRect(2, 6, 44, 34);   // outline body
  x.fillStyle = '#a06238'; x.fillRect(5, 9, 38, 12);   // lid
  x.fillStyle = '#8a5230'; x.fillRect(5, 21, 38, 16);  // base
  x.fillStyle = '#c17c48'; x.fillRect(5, 9, 38, 4);    // lid highlight
  x.fillStyle = '#3d2610';                             // straps
  x.fillRect(10, 6, 5, 34); x.fillRect(33, 6, 5, 34);
  x.fillStyle = '#ffd84d'; x.fillRect(20, 17, 8, 11);  // lock
  x.fillStyle = '#8a6a10'; x.fillRect(23, 21, 2, 4);   // keyhole
  return c;
}

// the mysterious glowing obelisk (recreated from the kids' battlefield painting)
function makeObelisk() {
  const c = mk(72, 152);
  const x = c.getContext('2d');
  x.fillStyle = '#57524a'; x.fillRect(8, 138, 56, 12);   // stepped base
  x.fillStyle = '#6e695f'; x.fillRect(14, 128, 44, 12);
  x.fillStyle = '#8b867c'; x.fillRect(22, 14, 28, 116);  // slab
  x.fillStyle = '#b3ada1'; x.fillRect(22, 14, 7, 116);   // lit edge
  x.fillStyle = '#5d584f'; x.fillRect(44, 14, 6, 116);   // shaded edge
  x.fillStyle = '#9a958a'; x.fillRect(24, 6, 24, 10);    // cap
  x.fillStyle = '#b3ada1'; x.fillRect(28, 2, 16, 6);     // tip
  [26, 40, 54, 68, 82, 96, 110].forEach((gy, i) => {     // glowing glyphs
    x.fillStyle = '#2f86c8';
    x.fillRect(31, gy, 10, 9);
    x.fillStyle = '#8fd8ff';
    if (i % 3 === 0) x.fillRect(33, gy + 3, 6, 3);
    else if (i % 3 === 1) { x.fillRect(33, gy + 2, 2, 5); x.fillRect(37, gy + 2, 2, 5); }
    else { x.fillRect(33, gy + 2, 6, 2); x.fillRect(35, gy + 5, 2, 2); }
  });
  return c;
}

// a chunky gold key (used on the key-chest and the HUD counter)
function makeKey() {
  const c = mk(34, 20);
  const x = c.getContext('2d');
  x.fillStyle = '#3a2c08'; // outline
  x.fillRect(2, 4, 16, 12);
  x.fillRect(18, 8, 14, 4);
  x.fillRect(26, 12, 3, 5);
  x.fillRect(30, 12, 3, 5);
  x.fillStyle = '#ffd84d'; // gold
  x.fillRect(4, 6, 12, 8);
  x.fillRect(18, 9, 12, 2);
  x.fillStyle = '#8a6a10'; // ring hole
  x.fillRect(7, 8, 5, 4);
  x.fillStyle = '#fff2a8'; // glint
  x.fillRect(5, 6, 3, 2);
  return c;
}

// leafy bush — replaces mushroom decor (looked too much like the collectible)
function makeBush() {
  const c = mk(34, 26);
  const x = c.getContext('2d');
  bEllipse(x, 17, 17, 15, 8, '#255c1c');
  bEllipse(x, 14, 12, 11, 7, '#2e6b23');
  bEllipse(x, 20, 10, 7, 5, '#429331');
  x.fillStyle = '#61b649';
  x.fillRect(8, 8, 3, 3); x.fillRect(22, 14, 3, 3);
  return c;
}

function cloneCanvas(c) {
  const out = document.createElement('canvas');
  out.width = c.width; out.height = c.height;
  out.getContext('2d').drawImage(c, 0, 0);
  return out;
}

export async function loadAssets() {
  const imgs = {};
  await Promise.all(IMAGE_NAMES.map(async n => { imgs[n] = await loadImage('assets/' + n + '.png'); }));
  const sprites = {};
  for (const n of SPRITE_NAMES) sprites[n] = trim(imgs[n]);
  const walk = {};
  for (const n of HERO_DIR_NAMES) walk[n] = makeWalkFrames(sprites[n]);
  const menuBg = {
    'screen-title': sampleColor(imgs['screen-title']),
    'screen-win': sampleColor(imgs['screen-win']),
    'screen-died': sampleColor(imgs['screen-died']),
  };
  const props = {};
  props['tent'] = makeTent();
  props['logs'] = makeLogs();
  props['well'] = makeWell();
  props['berry'] = makeBerry();
  props['smore'] = makeSmore();
  props['hat-party'] = makeHat('party');
  props['hat-crown'] = makeHat('crown');
  props['hat-wizard'] = makeHat('wizard');
  // the whole prop set is code-drawn in the same chunky style as the well
  for (const [suffix, pal] of Object.entries(TREE_PALS)) {
    props['tree' + suffix] = makeTree(pal, 11 + suffix.length);
  }
  for (const [suffix, pal] of Object.entries(PINE_PALS)) {
    props['pine' + suffix] = makePine(pal);
  }
  props['rock1'] = makeRock(68, 48, 3);
  props['rock2'] = makeRock(52, 38, 8);
  props['rock3'] = makeRock(60, 42, 21);
  props['stone'] = makeStone();
  props['flower-purple'] = makeFlower('#b45ad0');
  props['flower-blue'] = makeFlower('#5a8ad0');
  props['flower-pink'] = makeFlower('#e46a9c');
  props['mush'] = makeMush();
  props['bush'] = makeBush();
  props['sparkle'] = makeSparkleProp();
  props['lantern'] = makeLantern();
  props['chest'] = makeChest();
  props['key'] = makeKey();
  props['obelisk'] = makeObelisk();
  props['sign-goin'] = makeSign(['GO IN', 'HERE!']);
  props['sign-motivation'] = makeSign(['THIS IS', 'MOTIVATION']);
  props['sign-home'] = makeSign(['HOME SWEET', 'HOME']);
  props['bridge'] = makeBridge();
  props['bridge-h'] = rotate90(props['bridge']);
  props['cave-dark'] = makeCave('#6e6152', '#8a7a66', '#463c30', 5);
  props['cave-stone'] = makeCave('#77746e', '#96938a', '#4a473f', 9);
  props['pond'] = makePond();
  for (const [name, pal] of Object.entries(GRASS_PALS)) {
    props[name] = makeGrass(pal, 17 + name.length);
  }
  return { imgs, sprites, walk, menuBg, props };
}
