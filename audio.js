// WebAudio chiptune: two looped themes + synth SFX + the kids' pop.wav.
let ctx = null;
let master = null;
let popBuffer = null;
let muted = localStorage.getItem('pq-mute') === '1';
let theme = null;          // 'camp' | 'adventure' | null
let step = 0;
let nextStepTime = 0;
let timer = null;

const NOTE = n => 440 * Math.pow(2, (n - 69) / 12); // MIDI -> Hz
// note numbers: C4=60, rests are null
const THEMES = {
  camp: {
    stepDur: 0.30,
    melody: [60, null, 64, null, 67, null, 64, null, 65, null, 69, null, 67, null, 64, null],
    melodyWave: 'triangle', melodyGain: 0.16,
    bass: [48, null, null, null, 53, null, null, null, 48, null, null, null, 55, null, null, null],
    bassWave: 'triangle', bassGain: 0.20,
  },
  adventure: {
    stepDur: 0.17,
    melody: [69, 69, 72, 69, 76, null, 74, 72, 71, null, 67, 71, 69, null, 64, 67],
    melodyWave: 'square', melodyGain: 0.07,
    bass: [45, 45, 57, 45, 41, 41, 53, 41, 43, 43, 55, 43, 40, 40, 52, 40],
    bassWave: 'triangle', bassGain: 0.22,
  },
  cave: {
    stepDur: 0.27,
    melody: [57, null, 60, null, 64, null, 60, null, 55, null, 58, null, 62, null, 63, null],
    melodyWave: 'triangle', melodyGain: 0.13,
    bass: [33, null, null, null, 36, null, null, null, 31, null, null, null, 35, null, null, null],
    bassWave: 'triangle', bassGain: 0.26,
  },
};

export function isMuted() { return muted; }

export function toggleMute() {
  muted = !muted;
  localStorage.setItem('pq-mute', muted ? '1' : '0');
  if (master) master.gain.value = muted ? 0 : 1;
}

// Must be called from a user gesture (iOS requirement).
export function unlock() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 1;
    master.connect(ctx.destination);
    fetch('assets/pop.wav')
      .then(r => r.arrayBuffer())
      .then(b => ctx.decodeAudioData(b))
      .then(buf => { popBuffer = buf; })
      .catch(() => {});
    timer = setInterval(schedule, 50);
  }
  if (ctx.state === 'suspended') ctx.resume();
}

function blip(freq, dur, when, wave = 'square', gain = 0.12, slideTo = null) {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = wave;
  osc.frequency.setValueAtTime(freq, when);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), when + dur);
  g.gain.setValueAtTime(gain, when);
  g.gain.exponentialRampToValueAtTime(0.001, when + dur);
  osc.connect(g).connect(master);
  osc.start(when);
  osc.stop(when + dur + 0.02);
}

// ---- music ----

export function setTheme(name) {
  if (theme === name) return;
  theme = name;
  step = 0;
  if (ctx) nextStepTime = ctx.currentTime + 0.08;
}

function schedule() {
  if (!ctx || !theme || ctx.state !== 'running') return;
  const t = THEMES[theme];
  while (nextStepTime < ctx.currentTime + 0.15) {
    const m = t.melody[step % t.melody.length];
    const b = t.bass[step % t.bass.length];
    if (m !== null) blip(NOTE(m), t.stepDur * 0.9, nextStepTime, t.melodyWave, t.melodyGain);
    if (b !== null) blip(NOTE(b), t.stepDur * 0.85, nextStepTime, t.bassWave, t.bassGain);
    nextStepTime += t.stepDur;
    step++;
  }
}

// ---- sfx ----

export const sfx = {
  pickup() {
    if (!ctx) return;
    if (popBuffer) {
      const src = ctx.createBufferSource();
      src.buffer = popBuffer;
      const g = ctx.createGain();
      g.gain.value = 0.9;
      src.connect(g).connect(master);
      src.start();
    } else {
      blip(660, 0.09, ctx.currentTime, 'square', 0.12, 990);
    }
  },
  hurt() {
    if (!ctx) return;
    blip(220, 0.18, ctx.currentTime, 'square', 0.15, 70);
  },
  whoosh() {
    if (!ctx) return;
    blip(280, 0.22, ctx.currentTime, 'triangle', 0.1, 620);
  },
  win() {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    [72, 76, 79, 84].forEach((n, i) => blip(NOTE(n), i === 3 ? 0.6 : 0.18, t0 + i * 0.16, 'square', 0.12));
    [48, 52, 55, 60].forEach((n, i) => blip(NOTE(n), i === 3 ? 0.6 : 0.18, t0 + i * 0.16, 'triangle', 0.18));
  },
  die() {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    [57, 53, 50, 45].forEach((n, i) => blip(NOTE(n), 0.28, t0 + i * 0.24, 'triangle', 0.2));
  },
  heal() {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    blip(660, 0.1, t0, 'triangle', 0.16);
    blip(990, 0.16, t0 + 0.09, 'triangle', 0.16);
  },
  rest() {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    [72, 67, 64, 60].forEach((n, i) => blip(NOTE(n), 0.3, t0 + i * 0.18, 'triangle', 0.14));
  },
  clink() {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    blip(1320, 0.06, t0, 'square', 0.08);
    blip(1760, 0.09, t0 + 0.07, 'square', 0.08);
  },
  drop() {
    if (!ctx) return;
    blip(330, 0.2, ctx.currentTime, 'square', 0.12, 140);
  },
  bonk() {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    blip(150, 0.09, t0, 'square', 0.2, 70);
    blip(900, 0.05, t0, 'square', 0.06, 500);
  },
  bossHit() {
    if (!ctx) return;
    blip(220, 0.22, ctx.currentTime, 'square', 0.2, 60);
  },
  bossDown() {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    [64, 67, 71, 76, 79].forEach((n, i) => blip(NOTE(n), i === 4 ? 0.5 : 0.14, t0 + i * 0.12, 'square', 0.12));
  },
  buff() {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    [72, 76, 79, 84].forEach((n, i) => blip(NOTE(n), 0.09, t0 + i * 0.07, 'square', 0.09));
  },
  buzz() {
    if (!ctx) return;
    blip(120, 0.22, ctx.currentTime, 'square', 0.14, 90);
  },
};
