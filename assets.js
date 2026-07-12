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
  'bg-campsite', 'bg-battlefield',
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

// Props cropped straight out of the kids' two paintings: [source, x, y, w, h].
const PROP_RECTS = {
  'cave-dark':     ['bg-campsite', 115, 96, 125, 112],
  'well':          ['bg-campsite', 443, 315, 100, 75],
  'chest':         ['bg-campsite', 582, 352, 44, 40],
  'bridge':        ['bg-campsite', 612, 418, 92, 50],
  'pine-big':      ['bg-campsite', 178, 300, 85, 158],
  'sign-arrow':    ['bg-campsite', 283, 110, 44, 44],
  'sign-post':     ['bg-campsite', 835, 243, 40, 44],
  'cave-stone':    ['bg-battlefield', 128, 92, 232, 215],
  'pond':          ['bg-battlefield', 482, 176, 230, 162],
  'obelisk':       ['bg-battlefield', 714, 282, 86, 176],
  'lantern':       ['bg-battlefield', 692, 452, 58, 60],
  'bridge2':       ['bg-battlefield', 806, 58, 112, 65],
  'pine':          ['bg-battlefield', 362, 58, 66, 140],
  'tree1':         ['bg-battlefield', 830, 325, 70, 70],
  'tree2':         ['bg-battlefield', 697, 66, 68, 66],
  'tree3':         ['bg-battlefield', 50, 298, 68, 65],
  'rock1':         ['bg-battlefield', 253, 36, 50, 42],
  'rock2':         ['bg-battlefield', 855, 533, 56, 50],
  'rock3':         ['bg-battlefield', 60, 573, 55, 48],
  'mushroom1':     ['bg-battlefield', 213, 310, 30, 30],
  'mushroom2':     ['bg-battlefield', 112, 398, 44, 42],
  'sign-go':       ['bg-battlefield', 359, 197, 55, 50],
  'sign-motivate': ['bg-battlefield', 609, 402, 90, 50],
  'stone1':        ['bg-battlefield', 650, 510, 52, 32],
  'stone2':        ['bg-battlefield', 570, 576, 50, 34],
  'flower1':       ['bg-battlefield', 812, 373, 32, 30],
  'flower2':       ['bg-battlefield', 685, 648, 36, 40],
  'sparkle':       ['bg-battlefield', 850, 608, 34, 36],
  'grass1':        ['bg-battlefield', 386, 340, 100, 100],
  'grass2':        ['bg-campsite', 84, 232, 128, 128],
};

// Tiles keep their full rectangle; bridges only lose their corners (they sit on
// drawn water that covers their edge midpoints).
const NO_MASK = new Set(['grass1', 'grass2']);
const CORNER_MASK = new Set(['bridge', 'bridge2']);

function cropProp(imgs, [src, x, y, w, h], mode) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.drawImage(imgs[src], x, y, w, h, 0, 0, w, h);
  if (mode === 'none') return c;
  // blocky elliptical cutout: crops lose their rectangle corners with a crisp
  // 4px-stepped edge (soft gradient fades read as blurry blobs in pixel art)
  const d = ctx.getImageData(0, 0, w, h);
  const rx = w / 2, ry = h / 2;
  const cut = mode === 'corners' ? 1.45 : 0.94;
  const B = 4;
  for (let by = 0; by < h; by += B) {
    for (let bx = 0; bx < w; bx += B) {
      const nx = (bx + B / 2 - rx) / rx, ny = (by + B / 2 - ry) / ry;
      if (nx * nx + ny * ny > cut) {
        for (let py = by; py < Math.min(h, by + B); py++) {
          for (let px = bx; px < Math.min(w, bx + B); px++) {
            d.data[(py * w + px) * 4 + 3] = 0;
          }
        }
      }
    }
  }
  ctx.putImageData(d, 0, 0);
  return c;
}

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
  for (const [name, rect] of Object.entries(PROP_RECTS)) {
    props[name] = cropProp(imgs, rect, NO_MASK.has(name) ? 'none' : CORNER_MASK.has(name) ? 'corners' : 'ellipse');
  }
  // mood variants for the themed zones
  for (const n of ['tree1', 'tree2', 'tree3', 'pine', 'pine-big']) {
    props[n + '-dark'] = applyColorFilter(cloneCanvas(props[n]), { bright: 0.68 });
    props[n + '-autumn'] = applyColorFilter(cloneCanvas(props[n]), { hue: -45, sat: 1.15 });
  }
  props['tent'] = makeTent();
  props['logs'] = makeLogs();
  props['well'] = makeWell(); // replaces the messy crop
  props['bridge-h'] = rotate90(props['bridge']); // for rivers that flow east-west
  props['berry'] = makeBerry();
  props['smore'] = makeSmore();
  props['hat-party'] = makeHat('party');
  props['hat-crown'] = makeHat('crown');
  props['hat-wizard'] = makeHat('wizard');
  props['grass1-dark'] = applyColorFilter(cloneCanvas(props['grass1']), { bright: 0.78 });
  props['grass1-sunny'] = applyColorFilter(cloneCanvas(props['grass1']), { hue: -10, bright: 1.12 });
  props['grass2-autumn'] = applyColorFilter(cloneCanvas(props['grass2']), { hue: -30, sat: 1.05 });
  return { imgs, sprites, walk, menuBg, props };
}
