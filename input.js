// Floating virtual joystick + keyboard fallback + tap detection.
const JOY_MAX = 56;      // px of thumb travel (screen space)
const JOY_DEAD = 8;      // deadzone before movement registers
const TAP_TIME = 300;    // ms
const TAP_DIST = 12;     // px

export const input = {
  joy: { active: false, ox: 0, oy: 0, x: 0, y: 0 }, // screen coords
  keys: new Set(),
  taps: [],           // {x, y} screen coords, consumed by the game
  anyPress: false,    // true for the frame after any pointerdown (audio unlock)
};

let joyPointerId = null;
let downInfo = null;

export function initInput(canvas) {
  canvas.addEventListener('pointerdown', e => {
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic pointers can't be captured */ }
    input.anyPress = true;
    downInfo = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
    if (joyPointerId === null) {
      joyPointerId = e.pointerId;
      input.joy.active = true;
      input.joy.ox = input.joy.x = e.clientX;
      input.joy.oy = input.joy.y = e.clientY;
    }
  });
  canvas.addEventListener('pointermove', e => {
    if (e.pointerId === joyPointerId) {
      const dx = e.clientX - input.joy.ox, dy = e.clientY - input.joy.oy;
      const d = Math.hypot(dx, dy);
      if (d > JOY_MAX) { // drag the anchor along so direction flips feel instant
        input.joy.ox = e.clientX - (dx / d) * JOY_MAX;
        input.joy.oy = e.clientY - (dy / d) * JOY_MAX;
      }
      input.joy.x = e.clientX;
      input.joy.y = e.clientY;
    }
  });
  const end = e => {
    if (e.pointerId === joyPointerId) {
      joyPointerId = null;
      input.joy.active = false;
    }
    if (downInfo && e.pointerId === downInfo.id) {
      const dt = performance.now() - downInfo.t;
      const dist = Math.hypot(e.clientX - downInfo.x, e.clientY - downInfo.y);
      if (dt < TAP_TIME && dist < TAP_DIST) input.taps.push({ x: e.clientX, y: e.clientY });
      downInfo = null;
    }
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  const KEYMAP = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    w: 'up', s: 'down', a: 'left', d: 'right',
    W: 'up', S: 'down', A: 'left', D: 'right',
  };
  window.addEventListener('keydown', e => {
    const k = KEYMAP[e.key];
    if (k) { input.keys.add(k); e.preventDefault(); }
    if (e.key === ' ' || e.key === 'Enter') { input.taps.push({ x: innerWidth / 2, y: innerHeight / 2 }); input.anyPress = true; }
  });
  window.addEventListener('keyup', e => {
    const k = KEYMAP[e.key];
    if (k) input.keys.delete(k);
  });
}

// Normalized movement vector {dx, dy} in [-1, 1], joystick first, keys as fallback.
export function getMove() {
  if (input.joy.active) {
    const dx = input.joy.x - input.joy.ox, dy = input.joy.y - input.joy.oy;
    const d = Math.hypot(dx, dy);
    if (d < JOY_DEAD) return { dx: 0, dy: 0 };
    const m = Math.min(1, d / JOY_MAX);
    return { dx: (dx / d) * m, dy: (dy / d) * m };
  }
  let dx = 0, dy = 0;
  if (input.keys.has('left')) dx -= 1;
  if (input.keys.has('right')) dx += 1;
  if (input.keys.has('up')) dy -= 1;
  if (input.keys.has('down')) dy += 1;
  if (dx && dy) { dx *= Math.SQRT1_2; dy *= Math.SQRT1_2; }
  return { dx, dy };
}

export function takeTap() {
  return input.taps.shift() || null;
}

export function clearFrameFlags() {
  input.anyPress = false;
}

// Draw the joystick overlay in screen space.
export function drawJoystick(ctx, dpr) {
  if (!input.joy.active) return;
  const { ox, oy, x, y } = input.joy;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#fff';
  ctx.beginPath(); ctx.arc(ox, oy, JOY_MAX, 0, Math.PI * 2); ctx.stroke();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = '#fff';
  const dx = x - ox, dy = y - oy, d = Math.hypot(dx, dy);
  const cx = d > JOY_MAX ? ox + (dx / d) * JOY_MAX : x;
  const cy = d > JOY_MAX ? oy + (dy / d) * JOY_MAX : y;
  ctx.beginPath(); ctx.arc(cx, cy, 24, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
