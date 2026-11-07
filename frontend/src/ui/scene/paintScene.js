/* The Whiteraven landscape, painted in code: night sky, ringed planet limb, cloud banks, jagged
   ranges, a still lake and a basalt plain split by lava. Everything comes from a seeded RNG, so the
   same seed and size always give the same picture, and no image files ship with the game. */

function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeNoise(seed) {
  const r = rng(seed);
  const size = 256;
  const grid = new Float32Array(size * size);
  for (let i = 0; i < grid.length; i++) grid[i] = r();
  const smooth = (t) => t * t * (3 - 2 * t);
  const at = (x, y) => grid[((y & 255) << 8) | (x & 255)];
  const value = (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const u = smooth(x - xi);
    const v = smooth(y - yi);
    const a = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * u;
    const b = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * u;
    return a + (b - a) * v;
  };
  return (x, y, octaves = 5) => {
    let sum = 0;
    let amp = 0.5;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += value(x, y) * amp;
      norm += amp;
      amp *= 0.5;
      x = x * 2.03 + 17.1;
      y = y * 2.03 + 9.2;
    }
    return sum / norm;
  };
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const mix = (a, b, t) => a + (b - a) * t;
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

export const PALETTES = {
  night: {
    sky: ['#010409', '#030a16', '#061628', '#163a5a'],
    glow: [176, 214, 255],
    glowAlpha: 0.62,
    cloud: [18, 34, 58],
    cloudLit: [128, 164, 206],
    ridges: [[38, 66, 100], [20, 40, 66], [9, 20, 36], [5, 11, 20]],
    lit: [190, 222, 250],
    lake: [120, 168, 214],
  },
  dusk: {
    sky: ['#101a33', '#2a3355', '#7b5660', '#f0935a'],
    glow: [255, 196, 140],
    glowAlpha: 0.75,
    cloud: [62, 62, 92],
    cloudLit: [226, 156, 124],
    ridges: [[84, 84, 118], [50, 52, 84], [28, 30, 54], [12, 13, 26]],
    lit: [255, 190, 150],
    lake: [255, 190, 140],
  },
  frost: {
    sky: ['#04122a', '#0c2c58', '#1f5a94', '#6db1e2'],
    glow: [190, 228, 255],
    glowAlpha: 0.65,
    cloud: [70, 112, 164],
    cloudLit: [186, 222, 250],
    ridges: [[80, 128, 182], [40, 80, 132], [18, 44, 84], [7, 20, 42]],
    lit: [216, 240, 255],
    lake: [150, 212, 255],
  },
};

function layer(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return { canvas, ctx: canvas.getContext('2d') };
}

const smoothstep = (a, b, v) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

function paintSky(ctx, W, H, p, r) {
  const g = ctx.createLinearGradient(0, 0, 0, H * 0.64);
  p.sky.forEach((c, i) => g.addColorStop(i / (p.sky.length - 1), c));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const stars = Math.round((W * H) / 2600);
  for (let i = 0; i < stars; i++) {
    const y = Math.pow(r(), 1.3) * H * 0.5;
    const a = (1 - y / (H * 0.5)) * (r() < 0.05 ? 1 : 0.12 + r() * 0.5);
    ctx.fillStyle = `rgba(216,234,255,${a})`;
    const s = r() < 0.04 ? 1.8 : r() < 0.3 ? 1.1 : 0.7;
    ctx.fillRect(r() * W, y, s, s);
  }
}

function paintPlanet(ctx, W, H, p) {
  const R = Math.max(W, H) * 0.4;
  const cx = W * 1.02;
  const cy = -R * 0.72;
  ctx.save();
  // The night side blots out the stars behind it.
  const body = ctx.createRadialGradient(cx - R * 0.25, cy + R * 0.25, R * 0.72, cx, cy, R);
  body.addColorStop(0, 'rgba(2,6,14,.98)');
  body.addColorStop(0.9, 'rgba(6,16,32,.98)');
  body.addColorStop(1, rgba(p.glow, 0.09));
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();
  // Thin atmosphere and a crescent that fades towards both tips.
  ctx.globalCompositeOperation = 'lighter';
  const from = Math.PI * 0.52;
  const to = Math.PI * 0.98;
  const steps = 70;
  ctx.lineCap = 'round';
  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    const a0 = from + (to - from) * t;
    const a1 = from + (to - from) * (t + 1 / steps);
    const fade = Math.pow(Math.sin(Math.PI * t), 1.4);
    ctx.strokeStyle = rgba(p.glow, 0.07 * fade);
    ctx.lineWidth = Math.max(10, W / 90);
    ctx.beginPath();
    ctx.arc(cx, cy, R + W / 300, a0, a1);
    ctx.stroke();
    ctx.strokeStyle = rgba(p.glow, 0.92 * fade);
    ctx.lineWidth = Math.max(1, W / 900);
    ctx.beginPath();
    ctx.arc(cx, cy, R, a0, a1);
    ctx.stroke();
  }
  ctx.restore();
}

function paintHorizonGlow(ctx, W, H, p) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.translate(W / 2, H * 0.61);
  ctx.scale(1, 0.46);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, W * 0.44);
  g.addColorStop(0, rgba(p.glow, p.glowAlpha));
  g.addColorStop(0.3, rgba(p.glow, p.glowAlpha * 0.36));
  g.addColorStop(1, rgba(p.glow, 0));
  ctx.fillStyle = g;
  ctx.fillRect(-W, -H * 2, W * 2, H * 4);
  ctx.restore();
}

function paintClouds(ctx, W, H, p, noise) {
  const w = Math.ceil(W / 3);
  const h = Math.ceil((H * 0.6) / 3);
  const off = layer(w, h);
  const img = off.ctx.createImageData(w, h);
  const scale = 5.5 / Math.max(w, 300);
  for (let y = 0; y < h; y++) {
    const fy = y / h;
    for (let x = 0; x < w; x++) {
      const fx = x / w;
      // Banks build at both sides and low in the sky, which leaves the centre open for the hero.
      const side = smoothstep(0.16, 0.92, Math.abs(fx - 0.5) * 2);
      const band = Math.exp(-Math.pow((fy - 0.62) / 0.3, 2));
      const wx = x * scale + noise(x * scale * 0.6, y * scale * 0.6, 3) * 1.2;
      const wy = y * scale * 1.7 + noise(x * scale * 0.6 + 9, y * scale * 0.6 + 4, 3) * 1.2;
      const n = noise(wx, wy, 6);
      const d = smoothstep(0.56 - side * 0.14 * band, 0.68 - side * 0.1 * band, n) * (0.08 + band * side);
      // Light comes from the glow below and the moonlit limb above, so edges catch and hearts stay dark.
      const lit = smoothstep(-0.03, 0.08, noise(wx + 0.05, wy - 0.09, 5) - n);
      const i = (y * w + x) * 4;
      const under = Math.pow(fy, 2.2) * 0.4;
      img.data[i] = mix(p.cloud[0], p.cloudLit[0], clamp01(lit + under));
      img.data[i + 1] = mix(p.cloud[1], p.cloudLit[1], clamp01(lit + under));
      img.data[i + 2] = mix(p.cloud[2], p.cloudLit[2], clamp01(lit + under));
      img.data[i + 3] = clamp01(d * 1.5) * 245;
    }
  }
  off.ctx.putImageData(img, 0, 0);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(off.canvas, 0, 0, W, H * 0.6);
}

/* Build a range as a set of real peaks, so the skyline has shoulders and summits rather than noise. */
function makeRange(W, H, r, noise, { base, minH, maxH, count, valley, seedY }) {
  const peaks = [];
  for (let i = 0; i < count; i++) {
    const fx = (i + 0.15 + r() * 0.7) / count;
    const open = Math.pow(Math.abs(fx - 0.5) * 2, valley);
    const hgt = mix(minH, maxH, r()) * (0.22 + open * 0.95) * H;
    peaks.push({ x: fx * W, h: hgt, wl: hgt * (0.8 + r() * 0.9), wr: hgt * (0.8 + r() * 0.9) });
  }
  const scale = 0.024 * (1400 / W);
  const sky = (x) => {
    let top = 0;
    for (const k of peaks) {
      const dx = x - k.x;
      const w = dx < 0 ? k.wl : k.wr;
      const v = k.h * Math.pow(Math.max(0, 1 - Math.abs(dx) / w), 1.18);
      if (v > top) top = v;
    }
    const rough = (noise(x * scale, seedY, 5) - 0.5) * 0.3 + (noise(x * scale * 5, seedY + 3, 3) - 0.5) * 0.09;
    return base * H - Math.max(0, top * (1 + rough) + rough * H * 0.022);
  };
  return { peaks, sky };
}

function paintRange(ctx, W, H, p, r, range, { base, color, haze, lit }) {
  const baseY = base * H;
  const { peaks, sky } = range;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(-2, H);
  for (let x = -2; x <= W + 3; x += 2) ctx.lineTo(x, sky(x));
  ctx.lineTo(W + 2, H);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, baseY - H * 0.26, 0, baseY + H * 0.02);
  g.addColorStop(0, rgba(color, 1));
  g.addColorStop(1, rgba(haze, 1));
  ctx.fillStyle = g;
  ctx.fill();
  ctx.clip();

  // Every peak gets a jagged spine: the side facing the valley glow is lit, the far side falls away.
  for (const k of [...peaks].sort((a, b) => a.h - b.h)) {
    if (k.h < H * 0.012) continue;
    const apex = sky(k.x);
    const dir = k.x < W / 2 ? 1 : -1;
    const reach = dir > 0 ? k.wr : k.wl;
    const spine = [];
    let sx = k.x;
    const segs = 7;
    for (let i = 1; i <= segs; i++) {
      sx += (r() - 0.5 + dir * 0.12) * k.h * 0.17;
      spine.push([sx, apex + ((baseY - apex) * i) / segs]);
    }
    ctx.beginPath();
    ctx.moveTo(k.x, apex);
    spine.forEach((q) => ctx.lineTo(q[0], q[1]));
    ctx.lineTo(k.x + dir * reach, baseY);
    ctx.lineTo(k.x + dir * reach * 0.5, apex + (baseY - apex) * 0.3);
    ctx.closePath();
    const f = ctx.createLinearGradient(0, apex, 0, baseY);
    f.addColorStop(0, rgba(p.lit, lit));
    f.addColorStop(0.55, rgba(p.lit, lit * 0.28));
    f.addColorStop(1, rgba(p.lit, 0));
    ctx.fillStyle = f;
    ctx.fill();

    // Gullies: dark wedges running down the lit face give the rock its structure.
    const gullies = 3 + Math.floor(r() * 4);
    for (let i = 0; i < gullies; i++) {
      const t = 0.14 + r() * 0.5;
      const gx = k.x + dir * reach * t * (0.3 + r() * 0.6);
      const gy = apex + (baseY - apex) * t * 0.9;
      const len = (baseY - apex) * (0.2 + r() * 0.4);
      ctx.beginPath();
      ctx.moveTo(gx, gy);
      ctx.lineTo(gx + dir * len * 0.34 + (r() - 0.5) * 4, gy + len);
      ctx.lineTo(gx + dir * len * (0.05 + r() * 0.16), gy + len * 0.92);
      ctx.closePath();
      ctx.fillStyle = 'rgba(2,6,14,.34)';
      ctx.fill();
    }
  }
  ctx.restore();
}

function paintLake(ctx, W, H, p, r, top, bottom) {
  // Mirror what stands above the shoreline, squashed and dimmed, then lay light across the water.
  const band = bottom - top;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, top, W, band);
  ctx.clip();
  ctx.fillStyle = '#060f1c';
  ctx.fillRect(0, top, W, band);
  ctx.globalAlpha = 0.72;
  ctx.translate(0, top);
  ctx.scale(1, -0.42);
  ctx.drawImage(ctx.canvas, 0, 0, W, top, 0, 0, W, top);
  ctx.restore();

  ctx.save();
  const fade = ctx.createLinearGradient(0, top, 0, bottom);
  fade.addColorStop(0, rgba(p.lake, 0.2));
  fade.addColorStop(1, 'rgba(4,10,20,.5)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, top, W, band);
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 90; i++) {
    const y = top + r() * band;
    const span = W * (0.012 + r() * 0.07);
    const x = W / 2 + (r() - 0.5) * W * 0.7;
    const near = 1 - Math.abs(x - W / 2) / (W * 0.4);
    ctx.fillStyle = rgba(p.lake, clamp01(near) * (0.05 + r() * 0.2));
    ctx.fillRect(x - span / 2, y, span, 1);
  }
  ctx.restore();
}

function paintGround(ctx, W, H, noise, top) {
  const w = Math.ceil(W / 2);
  const h = Math.ceil((H - top) / 2);
  const off = layer(w, h);
  const img = off.ctx.createImageData(w, h);
  const unit = Math.max(w, 320);
  let py = 11;
  for (let y = 0; y < h; y++) {
    const fy = y / h;
    // Perspective: rock near the viewer is drawn larger than rock at the shore. Rows are summed
    // rather than multiplied, so the texture coordinate can never fold back on itself.
    const depth = 0.1 + fy * 1.1;
    const sx = 13 / (unit * depth);
    py += 13 / (unit * depth * 0.34);
    for (let x = 0; x < w; x++) {
      const px = (x - w / 2) * sx + 40;
      const n = noise(px, py, 6);
      const big = noise(px * 0.28 + 7, py * 0.28 + 3, 3);
      const facet = clamp01((n - noise(px + 0.06, py + 0.07, 5)) * 15 + 0.5);
      const v = (2 + n * 8 + facet * facet * 19) * (0.42 + big * 0.9);
      const i = (y * w + x) * 4;
      img.data[i] = v * 0.9;
      img.data[i + 1] = v * 1.0;
      img.data[i + 2] = v * 1.26;
      img.data[i + 3] = 255;
    }
  }
  off.ctx.putImageData(img, 0, 0);
  // A broken shoreline that dips at the centre, so the water opens up behind the operator.
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, H);
  ctx.lineTo(0, top);
  for (let x = 0; x <= W; x += 6) {
    const dip = Math.pow(1 - Math.abs(x / W - 0.5) * 2, 1.4) * H * 0.04;
    ctx.lineTo(x, top + dip + (noise(x * 0.016 * (1400 / W), 3.3, 4) - 0.5) * H * 0.026);
  }
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.clip();
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(off.canvas, 0, top, W, H - top);
  ctx.restore();
}

/* Lava is a channel network that gets wider towards the viewer, with a noise crust punched out of it
   so it breaks into molten patches instead of clean lines. */
function lavaPath(start, angle, length, r, H, horizon, wander) {
  const pts = [start];
  let [x, y] = start;
  let a = angle;
  for (let travelled = 0; travelled < length;) {
    const depth = clamp01((y - horizon) / (H - horizon));
    const step = 4 + depth * 20;
    a += (r() - 0.5) * wander;
    x += Math.cos(a) * step;
    y += Math.sin(a) * step * (0.2 + depth * 0.42);
    if (y < horizon + 2) {
      y = horizon + 2;
      a = -a;
    }
    pts.push([x, y]);
    travelled += step;
  }
  return pts;
}

function strokeChannel(ctx, pts, width, H, horizon, noise, id) {
  for (let i = 1; i < pts.length; i++) {
    const depth = clamp01((pts[i][1] - horizon) / (H - horizon));
    const taper = 0.35 + (1 - i / pts.length) * 0.75;
    const swell = 0.35 + noise(i * 0.16, id * 3.1, 3) * 1.5;
    ctx.lineWidth = Math.max(0.6, width * (0.14 + depth * 1.35) * taper * swell);
    ctx.beginPath();
    ctx.moveTo(pts[i - 1][0], pts[i - 1][1]);
    ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
  }
}

function paintLava(out, W, H, r, noise, point, horizon, amount) {
  const [fx, fy] = point;
  const scale = Math.max(W / 1400, 0.25);
  const channels = [];
  const add = (start, a, len, width, wander) => channels.push({ pts: lavaPath(start, a, len * scale, r, H, horizon, wander), width: width * scale });
  const jitter = (v) => (r() - 0.5) * v * scale;
  const dirs = [
    [-0.06, 640, 13], [Math.PI + 0.06, 640, 13],
    [-0.3, 330, 8], [Math.PI + 0.3, 330, 8],
    [0.3, 400, 11], [Math.PI - 0.3, 400, 11],
    [0.82, 170, 9], [Math.PI - 0.82, 170, 9],
    [-1.1, 80, 5], [Math.PI + 1.1, 80, 5],
  ];
  for (const [a, len, width] of dirs) {
    add([fx + jitter(26), fy + jitter(8)], a, len, width, 0.62);
    const main = channels[channels.length - 1].pts;
    for (let i = 5; i < main.length - 3; i += 3 + Math.floor(r() * 6)) {
      if (r() < 0.42) add(main[i], a + (r() < 0.5 ? -1 : 1) * (0.35 + r() * 0.5), 30 + r() * 110, width * 0.36, 0.9);
    }
  }
  const veins = Math.round(30 + 22 * scale);
  for (let i = 0; i < veins; i++) {
    const side = r() < 0.5 ? r() * 0.36 : 0.64 + r() * 0.36;
    const y = horizon + 5 + Math.pow(r(), 1.2) * (H - horizon) * 0.95;
    add([side * W, y], (r() < 0.5 ? 0 : Math.PI) + (r() - 0.5) * 0.9, 18 + r() * 110, 2 + r() * 4, 1);
  }

  const L = layer(W, H);
  const c = L.ctx;
  c.lineCap = 'round';
  c.lineJoin = 'round';

  // The pool at the operator's feet, wider than it is deep.
  const pool = (color, k) => {
    c.save();
    c.translate(fx, fy);
    c.scale(1, 0.24);
    c.fillStyle = color;
    c.beginPath();
    c.arc(0, 0, 76 * scale * k, 0, Math.PI * 2);
    c.fill();
    c.restore();
  };
  const draw = (color, factor) => {
    c.strokeStyle = color;
    channels.forEach((ch, i) => strokeChannel(c, ch.pts, ch.width * factor, H, horizon, noise, i));
  };
  pool('#c4300a', 1.25);
  draw('#c4300a', 1.7);
  pool('#ff6f1a', 1);
  draw('#ff6f1a', 1);
  pool('#ffc76a', 0.62);
  draw('#ffd98a', 0.4);

  // The crust: noise-shaped rock floating on the lava.
  const m = layer(Math.ceil(W / 2), Math.ceil(H / 2));
  const img = m.ctx.createImageData(m.canvas.width, m.canvas.height);
  const unit = Math.max(m.canvas.width, 320);
  const my = horizon / 2;
  let cy = 21;
  for (let y = Math.floor(my); y < m.canvas.height; y++) {
    const depth = 0.16 + clamp01((y - my) / (m.canvas.height - my)) * 1.2;
    const sx = 42 / (unit * depth);
    cy += 42 / (unit * depth * 0.4);
    for (let x = 0; x < m.canvas.width; x++) {
      const n = noise((x - m.canvas.width / 2) * sx + 3, cy, 4);
      img.data[(y * m.canvas.width + x) * 4 + 3] = smoothstep(0.54, 0.6, n) * 255;
    }
  }
  m.ctx.putImageData(img, 0, 0);
  c.globalCompositeOperation = 'destination-out';
  c.imageSmoothingEnabled = true;
  c.drawImage(m.canvas, 0, 0, W, H);

  // Soft light on the surrounding rock comes from small copies stretched back up.
  const blurred = (div) => {
    const b = layer(Math.max(1, Math.ceil(W / div)), Math.max(1, Math.ceil(H / div)));
    b.ctx.imageSmoothingQuality = 'high';
    b.ctx.drawImage(L.canvas, 0, 0, b.canvas.width, b.canvas.height);
    return b.canvas;
  };
  out.save();
  out.globalCompositeOperation = 'lighter';
  out.imageSmoothingQuality = 'high';
  out.globalAlpha = 0.5 * amount;
  out.drawImage(blurred(26), 0, 0, W, H);
  out.globalAlpha = 0.62 * amount;
  out.drawImage(blurred(7), 0, 0, W, H);
  out.globalAlpha = 1 * amount;
  out.drawImage(L.canvas, 0, 0);
  out.restore();
}

function paintForeground(ctx, W, H, r) {
  // Black boulders at the bottom corners frame the plain, as a photographer would.
  const rock = (cx, cy, rx, ry) => {
    ctx.beginPath();
    const n = 18;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const k = 0.78 + r() * 0.34;
      const x = cx + Math.cos(a) * rx * k;
      const y = cy + Math.sin(a) * ry * k;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    const g = ctx.createLinearGradient(cx, cy - ry, cx, cy + ry);
    g.addColorStop(0, 'rgba(26,28,36,1)');
    g.addColorStop(0.35, 'rgba(6,8,13,1)');
    g.addColorStop(1, 'rgba(2,3,6,1)');
    ctx.fillStyle = g;
    ctx.fill();
  };
  for (let i = 0; i < 9; i++) {
    const k = i / 8;
    rock(-W * 0.02 + k * W * 0.24, H * (1.02 - (1 - k) * 0.1), W * (0.13 - k * 0.07), H * (0.11 - k * 0.05));
    rock(W * 1.02 - k * W * 0.24, H * (1.02 - (1 - k) * 0.08), W * (0.13 - k * 0.07), H * (0.1 - k * 0.05));
  }
}

function paintVignette(ctx, W, H) {
  const g = ctx.createRadialGradient(W / 2, H * 0.52, H * 0.38, W / 2, H * 0.52, Math.max(W, H) * 0.78);
  g.addColorStop(0, 'rgba(1,4,9,0)');
  g.addColorStop(1, 'rgba(1,4,9,.74)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

/** Paint the landscape. `lavaCtx` may be null, which bakes the lava into `ctx`. */
export function paintScene(ctx, lavaCtx, W, H, { seed = 2031, palette = 'night', focus, lava = 1 } = {}) {
  // On a tall screen the Deck stacks and the operator stands higher, so the pool follows them,
  // and peak heights are capped so the range doesn't turn into spires.
  const portrait = W < H;
  const at = focus || (portrait ? [0.5, 0.75] : [0.5, 0.87]);
  const tall = clamp01(Math.max(0.55, (W / H) * 1.2));
  const p = PALETTES[palette];
  const r = rng(seed);
  const noise = makeNoise(seed ^ 0x5bd1);
  const shore = H * 0.645;

  paintSky(ctx, W, H, p, r);
  paintPlanet(ctx, W, H, p);
  paintClouds(ctx, W, H, p, noise);
  paintHorizonGlow(ctx, W, H, p);

  const haze = (i) => p.ridges[i].map((v, k) => Math.round(mix(v, p.glow[k], 0.1)));
  const far = { base: 0.625, minH: 0.14 * tall, maxH: 0.3 * tall, count: 15, valley: 0.72, seedY: 1.3 };
  const mid = { base: 0.64, minH: 0.1 * tall, maxH: 0.27 * tall, count: 11, valley: 1.05, seedY: 5.7 };
  const near = { base: 0.655, minH: 0.07 * tall, maxH: 0.25 * tall, count: 8, valley: 1.5, seedY: 9.1 };
  paintRange(ctx, W, H, p, r, makeRange(W, H, r, noise, far), { base: far.base, color: p.ridges[0], haze: haze(0), lit: 0.3 });
  paintRange(ctx, W, H, p, r, makeRange(W, H, r, noise, mid), { base: mid.base, color: p.ridges[1], haze: haze(1), lit: 0.25 });
  paintRange(ctx, W, H, p, r, makeRange(W, H, r, noise, near), { base: near.base, color: p.ridges[2], haze: haze(2), lit: 0.15 });

  paintLake(ctx, W, H, p, r, shore, H * 0.7);
  paintGround(ctx, W, H, noise, H * 0.635);

  const point = [at[0] * W, at[1] * H];
  if (lava > 0) paintLava(lavaCtx || ctx, W, H, r, noise, point, H * 0.665, lava);
  paintForeground(ctx, W, H, r);
  paintVignette(ctx, W, H);
}
