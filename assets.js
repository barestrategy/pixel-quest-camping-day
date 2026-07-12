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

// How each of the 9 zones is built from the kids' two backdrops.
// hue in degrees, bright/sat as multipliers; mirror flips horizontally.
export const ZONE_RECIPES = {
  '0,0': { src: 'bg-battlefield', mirror: true,  hue: -20, name: 'Rocky Grove' },
  '1,0': { src: 'bg-battlefield',                          name: "Queen's Clearing" },
  '2,0': { src: 'bg-campsite',    mirror: true,  hue: 25,  bright: 0.82, name: 'Deep Woods' },
  '0,1': { src: 'bg-campsite',    mirror: true,  hue: 12,  name: 'Willow Bend' },
  '1,1': { src: 'bg-campsite',                             name: 'The Campsite' },
  '2,1': { src: 'bg-campsite',                   hue: -25, bright: 1.08, name: 'Sunny Meadow' },
  '0,2': { src: 'bg-battlefield',                hue: 35,  bright: 0.85, name: 'Mossy Hollow' },
  '1,2': { src: 'bg-campsite',    mirror: true,  hue: -45, sat: 1.1, name: 'Fern Trail' },
  '2,2': { src: 'bg-battlefield', mirror: true,  hue: 15,  bright: 0.8, name: 'Shadow Pines' },
};

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
function applyColorFilter(canvas, { hue = 0, bright = 1, sat = 1 }) {
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

// Cover-draw: fill the whole W x H canvas, cropping source overflow.
function buildZone(imgs, recipe) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const img = imgs[recipe.src];
  const s = Math.max(W / img.naturalWidth, H / img.naturalHeight);
  const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
  if (recipe.mirror) {
    ctx.translate(W, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return applyColorFilter(c, recipe);
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

export function rebuildZones(assets) {
  for (const [key, recipe] of Object.entries(ZONE_RECIPES)) assets.zones[key] = buildZone(assets.imgs, recipe);
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
  const assets = { imgs, sprites, walk, menuBg, zones: {} };
  rebuildZones(assets);
  return assets;
}
