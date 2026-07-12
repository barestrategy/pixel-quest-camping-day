// Asset loading, sprite trimming, and zone-background remixing.
export const W = 960, H = 720;

const IMAGE_NAMES = [
  'pixely-up', 'pixely-down', 'pixely-left', 'pixely-right',
  'emily-up', 'emily-down', 'emily-left', 'emily-right',
  'queen-ant', 'coin', 'gem', 'mushroom',
  'bg-campsite', 'bg-battlefield',
  'screen-title', 'screen-died', 'screen-win', 'hero-select',
];

const SPRITE_NAMES = [
  'pixely-up', 'pixely-down', 'pixely-left', 'pixely-right',
  'emily-up', 'emily-down', 'emily-left', 'emily-right',
  'queen-ant', 'coin', 'gem', 'mushroom',
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

function buildZone(imgs, recipe) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  if (recipe.mirror) {
    ctx.translate(W, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(imgs[recipe.src], 0, 0, W, H);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return applyColorFilter(c, recipe);
}

export async function loadAssets() {
  const imgs = {};
  await Promise.all(IMAGE_NAMES.map(async n => { imgs[n] = await loadImage('assets/' + n + '.png'); }));
  const sprites = {};
  for (const n of SPRITE_NAMES) sprites[n] = trim(imgs[n]);
  const zones = {};
  for (const [key, recipe] of Object.entries(ZONE_RECIPES)) zones[key] = buildZone(imgs, recipe);
  return { imgs, sprites, zones };
}
