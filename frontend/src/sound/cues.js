/* Sound is generated with Web Audio, so no files are needed (section 4.4).
   It stays silent until the first click, and the mute toggle lives on System. */
let audio = null;
let muted = false;

export const setMuted = (m) => {
  muted = !!m;
};

export function ensureAudio() {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    audio.resume();
  } catch { /* no audio available: every cue below becomes a no-op */ }
}

function notes(freqs, step, length, gain = 0.08) {
  if (!audio || muted) return;
  try {
    freqs.forEach((f, i) => {
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.frequency.value = f;
      g.gain.value = gain;
      o.connect(g).connect(audio.destination);
      const t = audio.currentTime + i * step;
      o.start(t);
      o.stop(t + length);
    });
  } catch { /* a dropped chime should never interrupt play */ }
}

export const playTimerEnd = () => notes([660, 880], 0.22, 0.18);
export const playUnlock = () => notes([523, 659, 784], 0.09, 0.12, 0.06);
export const playLevelUp = () => notes([523, 659, 784], 0, 0.7, 0.05);
