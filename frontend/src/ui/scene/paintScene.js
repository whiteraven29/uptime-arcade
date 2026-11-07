/* The Whiteraven data centre, painted in code: an aisle of server racks and holographic panels showing
   real network maps, code and terminal output, a network wall at the far end, and a glossy floor that
   reflects it all. Everything comes from a seeded RNG, so the same seed and size always give the same
   picture, and no image files ship with the game. It's drawn with a small one-point perspective, so
   the room stays correct at any window shape. All colours come from tokens.css. */

function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const canvas = (w, h) => {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
};

function readColours() {
  const css = getComputedStyle(document.documentElement);
  const v = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
  return {
    void: v('--void', '#05040c'),
    rack: v('--scene-rack', '#0c0a1a'),
    rackEdge: v('--scene-rack-edge', '#241f45'),
    floor: v('--scene-floor', '#07060f'),
    cyan: v('--holo', '#4fd8ff'),
    violet: v('--violet', '#a66bff'),
    magenta: v('--magenta', '#ff4fd8'),
    gold: v('--amber', '#ffc24d'),
    red: v('--danger', '#ff3d5a'),
    ok: v('--ok', '#5ef0b0'),
    text: v('--text', '#e4f1ff'),
  };
}

/* ---------- what the hologram panels show ---------- */
const MONO = 'ui-monospace, "IBM Plex Mono", Consolas, monospace';
const CODE = [
  ['func main() {', '  ln, err := net.Listen("tcp", ":443")', '  if err != nil {', '    log.Fatal(err)', '  }', '  defer ln.Close()', '  for {', '    conn, _ := ln.Accept()', '    go serve(conn)', '  }', '}'],
  ['def top_paths(lines):', '    counts = {}', '    for line in lines:', '        path = line.split()[3]', '        counts[path] = counts.get(path, 0) + 1', '    return sorted(counts,', '        key=counts.get,', '        reverse=True)[:5]'],
];
const TERMINAL = [
  ['$ ip route', 'default via 10.40.30.1 dev eth0', '10.40.30.0/24 dev eth0 scope link', '$ ping -c 2 1.1.1.1', '64 bytes: ttl=57 time=4.2 ms', '64 bytes: ttl=57 time=4.0 ms', '$ dig +short app.whiteraven', '10.40.10.80', '$ ss -tulpn | grep 443', 'LISTEN 0.0.0.0:443 nginx', '$ _'],
  ['$ tail -f api-access.log', 'GET /v1/orders 200 41ms', 'GET /health 200 2ms', 'POST /v1/upload 201 88ms', 'GET /v1/search 500 1203ms', 'GET /v1/users 200 37ms', '$ grep -c " 500 " api.log', '69', "$ awk '{s+=$6} END{print s}'", '402118', '$ _'],
];
const TABLE = [['VLAN', 'NAME', 'SUBNET'], ['10', 'servers', '10.40.10.0/24'], ['20', 'finance', '10.40.20.0/24'], ['30', 'eng', '10.40.30.0/24'], ['40', 'guest', '10.40.40.0/24'], ['', '', ''], ['ROUTE', 'NEXT HOP', 'DEV'], ['0.0.0.0/0', '10.40.0.1', 'eth0'], ['10.40.0.0/16', '10.40.0.2', 'eth1'], ['10.40.30.128/25', '10.40.0.4', 'eth3']];

function frameTexture(g, W, H, colour) {
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, `${colour}33`);
  bg.addColorStop(0.5, `${colour}1f`);
  bg.addColorStop(1, `${colour}3a`);
  g.fillStyle = '#06061a';
  g.fillRect(0, 0, W, H);
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  g.strokeStyle = `${colour}16`;
  g.lineWidth = 1;
  for (let y = 0; y < H; y += 12) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(W, y);
    g.stroke();
  }
}
function borderTexture(g, W, H, colour) {
  g.strokeStyle = colour;
  g.lineWidth = 5;
  g.strokeRect(3, 3, W - 6, H - 6);
}

function topologyTexture(W, H, colour, c, seed) {
  const tex = canvas(W, H);
  const g = tex.getContext('2d');
  const r = rng(seed);
  frameTexture(g, W, H, colour);
  // Core at the top, a distribution layer, then access switches and hosts: a real campus shape.
  const layers = [1, 2, 4, 7];
  const nodes = layers.map((n, i) => Array.from({ length: n }, (_, k) => ({ x: (W * (k + 0.5)) / n, y: H * (0.13 + i * 0.2) + (r() - 0.5) * 6, i })));
  g.lineWidth = 1.6;
  for (let i = 0; i < layers.length - 1; i++) {
    for (const a of nodes[i]) {
      for (const b of nodes[i + 1]) {
        if (Math.abs(a.x - b.x) > W * 0.42 / (i + 0.6)) continue;
        g.strokeStyle = r() < 0.12 ? c.gold : `${colour}aa`;
        g.beginPath();
        g.moveTo(a.x, a.y);
        g.lineTo(b.x, b.y);
        g.stroke();
      }
    }
  }
  g.font = `bold 16px ${MONO}`;
  g.textAlign = 'center';
  for (const row of nodes) {
    for (const n of row) {
      const size = 19 - n.i * 3;
      g.fillStyle = '#04040f';
      g.strokeStyle = n.i === 0 ? c.gold : c.text;
      g.lineWidth = 2;
      g.beginPath();
      if (n.i < 2) g.rect(n.x - size, n.y - size * 0.7, size * 2, size * 1.4);
      else g.arc(n.x, n.y, size, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
  }
  g.fillStyle = c.text;
  g.fillText('10.40.0.1', W / 2, H * 0.13 - 18);
  g.fillText('core-sw1', W / 2, H * 0.84);
  g.textAlign = 'left';
  g.fillStyle = colour;
  for (let i = 0; i < 3; i++) g.fillText(`vlan ${10 + i * 10}  up  ${(r() * 900 + 40).toFixed(0)} Mb/s`, 16, H * 0.89 + i * 20);
  borderTexture(g, W, H, colour);
  return tex;
}
function textTexture(W, H, colour, c, lines, highlight) {
  const tex = canvas(W, H);
  const g = tex.getContext('2d');
  frameTexture(g, W, H, colour);
  g.font = `bold 21px ${MONO}`;
  const step = Math.min(44, (H - 60) / lines.length);
  lines.forEach((line, i) => {
    g.fillStyle = highlight(line) || c.text;
    g.fillText(line.slice(0, 30), 18, 44 + i * step);
  });
  borderTexture(g, W, H, colour);
  return tex;
}
function tableTexture(W, H, colour, c) {
  const tex = canvas(W, H);
  const g = tex.getContext('2d');
  frameTexture(g, W, H, colour);
  g.font = `bold 19px ${MONO}`;
  TABLE.forEach((row, i) => {
    const y = 44 + i * ((H - 70) / TABLE.length);
    const head = row[0] === 'VLAN' || row[0] === 'ROUTE';
    g.fillStyle = head ? c.gold : c.text;
    g.fillText(row[0], 14, y);
    g.fillStyle = head ? c.gold : colour;
    g.fillText(row[1], W * 0.34, y);
    g.fillStyle = head ? c.gold : c.text;
    g.fillText(row[2].slice(0, 15), W * 0.6, y);
  });
  borderTexture(g, W, H, colour);
  return tex;
}
function trafficTexture(W, H, colour, c, seed) {
  const tex = canvas(W, H);
  const g = tex.getContext('2d');
  const r = rng(seed);
  frameTexture(g, W, H, colour);
  g.font = `bold 20px ${MONO}`;
  g.fillStyle = c.text;
  g.fillText('eth0 throughput', 18, 38);
  for (let row = 0; row < 3; row++) {
    const base = H * (0.3 + row * 0.26);
    g.strokeStyle = [colour, c.gold, c.magenta][row];
    g.lineWidth = 2.2;
    g.beginPath();
    let y = base;
    for (let x = 10; x < W - 8; x += 7) {
      y = base + Math.sin(x * 0.05 + row) * 18 + (r() - 0.5) * 22;
      if (x === 10) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
  borderTexture(g, W, H, colour);
  return tex;
}

function buildPanels(c, seed) {
  const W = 420;
  const H = 672;
  const code = (line) => (/^\s*(func|def|for|if|return|defer|go)\b/.test(line) ? c.magenta : /["']/.test(line) ? c.gold : null);
  const term = (line) => (line.startsWith('$') ? c.ok : / 500 /.test(line) ? c.red : null);
  return [
    topologyTexture(W, H, c.cyan, c, seed + 1),
    textTexture(W, H, c.violet, c, CODE[0], code),
    tableTexture(W, H, c.cyan, c),
    textTexture(W, H, c.magenta, c, TERMINAL[0], term),
    topologyTexture(W, H, c.magenta, c, seed + 2),
    trafficTexture(W, H, c.cyan, c, seed + 3),
    textTexture(W, H, c.cyan, c, CODE[1], code),
    textTexture(W, H, c.violet, c, TERMINAL[1], term),
  ];
}

/* ---------- the room ---------- */
const AISLE = 1; // half the width of the aisle
const FLOOR = 0.86; // floor below the eye
const CEILING = 1.3; // ceiling above the eye
const FAR = 6.6; // the back wall
const BAY = 0.62;

function makeRoom(W, H, mirror) {
  const portrait = H > W;
  const vx = W / 2;
  const vy = H * (portrait ? 0.45 : 0.5);
  const f = Math.max(W * 0.6, H * (portrait ? 0.42 : 0.8));
  const at = (x, y, z) => ({ x: vx + (x / z) * f, y: vy + ((mirror ? 2 * FLOOR - y : y) / z) * f });
  return { W, H, vx, vy, f, at };
}
function quad(g, a, b, c, d, fill) {
  g.beginPath();
  g.moveTo(a.x, a.y);
  g.lineTo(b.x, b.y);
  g.lineTo(c.x, c.y);
  g.lineTo(d.x, d.y);
  g.closePath();
  if (fill) {
    g.fillStyle = fill;
    g.fill();
  }
}

function paintRack(g, room, side, z0, z1, r, c, emit) {
  const x = side * AISLE;
  const { at } = room;
  const fog = Math.min(1, (z0 - 1) / (FAR - 1));
  quad(g, at(x, -CEILING, z1), at(x, -CEILING, z0), at(x, FLOOR, z0), at(x, FLOOR, z1), c.rack);
  // The gap between one cabinet and the next.
  g.strokeStyle = c.rackEdge;
  g.lineWidth = Math.max(1, 2.4 / z0);
  g.beginPath();
  const edgeA = at(x, -CEILING, z0);
  const edgeB = at(x, FLOOR, z0);
  g.moveTo(edgeA.x, edgeA.y);
  g.lineTo(edgeB.x, edgeB.y);
  g.stroke();
  // Rack units, each a shelf of a server with status lights.
  const units = 15;
  const span = FLOOR + CEILING * 0.86;
  for (let u = 0; u < units; u++) {
    const y0 = -CEILING * 0.86 + (span * u) / units;
    const y1 = y0 + (span / units) * 0.82;
    const a = at(x, y0, z1 - (z1 - z0) * 0.05);
    const b = at(x, y0, z0 + (z1 - z0) * 0.05);
    const d = at(x, y1, z1 - (z1 - z0) * 0.05);
    const e = at(x, y1, z0 + (z1 - z0) * 0.05);
    quad(g, a, b, e, d, u % 5 === 2 ? '#1a1740' : '#15122e');
    const lights = 4 + Math.floor(r() * 5);
    for (let l = 0; l < lights; l++) {
      const roll = r();
      if (roll < 0.28) continue;
      const colour = roll < 0.62 ? c.cyan : roll < 0.82 ? c.ok : roll < 0.95 ? c.violet : c.red;
      const zl = z0 + (z1 - z0) * (0.12 + (l / lights) * 0.34);
      const p = at(x, (y0 + y1) / 2, zl);
      const s = Math.max(0.8, 3.4 / zl);
      g.fillStyle = colour;
      g.fillRect(p.x - s / 2, p.y - s / 2, s, s);
      if (emit) {
        emit.fillStyle = colour;
        emit.fillRect(p.x / 4 - 0.6, p.y / 4 - 0.6, 1.2, 1.2);
      }
    }
    // Drive bays: darker slots along the rest of the unit.
    g.fillStyle = '#05040d';
    for (let s = 0; s < 4; s++) {
      const zs = z0 + (z1 - z0) * (0.52 + s * 0.1);
      const p = at(x, (y0 + y1) / 2, zs);
      const w = Math.max(1, 5 / zs);
      g.fillRect(p.x - w / 2, p.y - Math.max(1, 1.6 / zs), w, Math.max(1.2, 3.2 / zs));
    }
  }
  // Distance sinks into a violet haze.
  quad(g, at(x, -CEILING, z1), at(x, -CEILING, z0), at(x, FLOOR, z0), at(x, FLOOR, z1), `rgba(40, 20, 90, ${fog * 0.3})`);
}

/* Verticals stay vertical on these walls, so slicing a picture into strips warps it exactly. */
function paintPanel(g, room, side, z0, z1, tex, emit) {
  const x = side * AISLE * 0.985;
  const top = -CEILING * 0.72;
  const bottom = FLOOR * 0.66;
  const { at } = room;
  const a = at(x, top, z0);
  const b = at(x, top, z1);
  const strips = Math.max(8, Math.min(260, Math.ceil(Math.abs(a.x - b.x)))); // one a pixel, so the edges don't step
  for (let i = 0; i < strips; i++) {
    const t0 = i / strips;
    const t1 = (i + 1) / strips;
    // Equal steps in 1/z are equal steps on the screen.
    const zAt = (t) => 1 / (1 / z0 + (1 / z1 - 1 / z0) * t);
    const z = zAt(t0);
    const z2 = zAt(t1);
    const p0 = at(x, top, z);
    const p1 = at(x, top, z2);
    const q0 = at(x, bottom, z);
    const sx0 = ((z - z0) / (z1 - z0)) * tex.width;
    const sx1 = ((z2 - z0) / (z1 - z0)) * tex.width;
    const u0 = side < 0 ? sx0 : tex.width - sx1;
    const dx = Math.min(p0.x, p1.x);
    const dw = Math.abs(p1.x - p0.x) + 0.8;
    const dy = Math.min(p0.y, q0.y);
    const dh = Math.abs(q0.y - p0.y);
    g.drawImage(tex, u0, 0, Math.max(1, sx1 - sx0), tex.height, dx, dy, dw, dh);
    if (emit && i % 3 === 0) emit.drawImage(tex, u0, 0, Math.max(1, sx1 - sx0) * 3, tex.height, dx / 4, dy / 4, (dw * 3) / 4, dh / 4);
  }
}

function paintBackWall(g, room, c, r, emit) {
  const { at } = room;
  const tl = at(-AISLE, -CEILING, FAR);
  const br = at(AISLE, FLOOR, FAR);
  const w = br.x - tl.x;
  const h = br.y - tl.y;
  g.fillStyle = '#0a0726';
  g.fillRect(tl.x, tl.y, w, h);
  // A whole network, drawn as a map: routers joined across the wall, with one link glowing gold.
  const nodes = Array.from({ length: 22 }, () => ({ x: tl.x + w * (0.08 + r() * 0.84), y: tl.y + h * (0.1 + r() * 0.72) }));
  const lines = (target, scale = 1) => {
    target.lineWidth = Math.max(0.6, w / 500) / scale;
    nodes.forEach((n, i) => {
      const near = nodes.map((m, k) => [Math.hypot(m.x - n.x, m.y - n.y), k]).filter(([, k]) => k !== i).sort((p, q) => p[0] - q[0]).slice(0, 3);
      for (const [, k] of near) {
        target.strokeStyle = i % 7 === 0 ? c.gold : i % 3 === 0 ? c.magenta : c.cyan;
        target.beginPath();
        target.moveTo(n.x / scale, n.y / scale);
        target.lineTo(nodes[k].x / scale, nodes[k].y / scale);
        target.stroke();
      }
    });
    for (const n of nodes) {
      target.fillStyle = c.text;
      target.beginPath();
      target.arc(n.x / scale, n.y / scale, Math.max(0.8, w / 200) / scale, 0, Math.PI * 2);
      target.fill();
    }
  };
  lines(g);
  if (emit) lines(emit, 4);
  g.globalAlpha = 0.3;
  g.strokeStyle = c.cyan;
  g.lineWidth = 1;
  g.strokeRect(tl.x, tl.y, w, h);
  g.globalAlpha = 1;
}

function paintShell(g, room, c) {
  const { at, W, H } = room;
  // Ceiling, and the two walls' far ends, so nothing shows through.
  g.fillStyle = '#06051a';
  g.fillRect(0, 0, W, H);
  quad(g, at(-AISLE, -CEILING, FAR), at(AISLE, -CEILING, FAR), at(AISLE, -CEILING, 0.6), at(-AISLE, -CEILING, 0.6), '#090726');
  // Cable trays and light strips run the length of the ceiling.
  for (const [x, colour] of [[-0.62, c.cyan], [0.62, c.cyan]]) {
    const a = at(x, -CEILING * 0.995, FAR);
    const b = at(x, -CEILING * 0.995, 1.5); // stops short of the top of the screen, where the nav sits
    g.strokeStyle = colour;
    g.globalAlpha = 0.28;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(a.x, a.y);
    g.lineTo(b.x, b.y);
    g.stroke();
    g.globalAlpha = 1;
  }
}

function paintWalls(g, room, c, seed, panels, emit) {
  for (const side of [-1, 1]) {
    const r = rng(seed + side * 13);
    const bays = [];
    for (let z = 0.8; z < FAR; z += BAY) bays.push(z);
    // The pattern is fixed from near to far, whatever the window size, then drawn far to near.
    const plan = bays.map((z, i) => ({ z, panel: i % 3 === (side < 0 ? 1 : 2) ? panels[(i + (side < 0 ? 0 : 3)) % panels.length] : null }));
    for (const bay of plan.reverse()) {
      const z1 = Math.min(FAR, bay.z + BAY);
      paintRack(g, room, side, bay.z, z1, r, c, emit);
      if (bay.panel) paintPanel(g, room, side, bay.z + 0.03, z1 - 0.03, bay.panel, emit);
    }
  }
}

function paintFloor(g, room, c, seed, panels, r) {
  const { at, W, H } = room;
  const cornerL = at(-AISLE, FLOOR, FAR);
  const cornerR = at(AISLE, FLOOR, FAR);
  const nearL = at(-AISLE, FLOOR, 0.3);
  const nearR = at(AISLE, FLOOR, 0.3);
  g.save();
  g.beginPath();
  g.moveTo(cornerL.x, cornerL.y);
  g.lineTo(cornerR.x, cornerR.y);
  g.lineTo(nearR.x, nearR.y);
  g.lineTo(nearL.x, nearL.y);
  g.closePath();
  g.clip();
  g.fillStyle = c.floor;
  g.fillRect(0, 0, W, H);

  // The reflection: the same room mirrored in the floor, drawn small so it comes back soft.
  const SCALE = 3;
  const small = canvas(W / SCALE, H / SCALE);
  const sg = small.getContext('2d');
  sg.scale(1 / SCALE, 1 / SCALE);
  const mirror = makeRoom(W, H, true);
  paintBackWall(sg, mirror, c, rng(seed + 5), null);
  paintWalls(sg, mirror, c, seed, panels, null);
  g.globalAlpha = 0.8;
  g.imageSmoothingQuality = 'high';
  g.drawImage(small, 0, 0, W, H);
  g.globalAlpha = 1;

  // It fades as the floor comes towards you, as a polished floor does.
  const fade = g.createLinearGradient(0, cornerL.y, 0, H);
  fade.addColorStop(0, 'rgba(5, 4, 12, 0)');
  fade.addColorStop(0.6, 'rgba(5, 4, 12, 0.48)');
  fade.addColorStop(1, 'rgba(5, 4, 12, 0.86)');
  g.fillStyle = fade;
  g.fillRect(0, 0, W, H);

  // Floor tiles, in perspective.
  g.strokeStyle = 'rgba(120, 110, 220, 0.14)';
  g.lineWidth = 1;
  for (let x = -AISLE; x <= AISLE + 0.01; x += AISLE / 3) {
    const a = at(x, FLOOR, FAR);
    const b = at(x, FLOOR, 0.3);
    g.beginPath();
    g.moveTo(a.x, a.y);
    g.lineTo(b.x, b.y);
    g.stroke();
  }
  for (let z = 0.45; z < FAR; z *= 1.22) {
    const a = at(-AISLE, FLOOR, z);
    const b = at(AISLE, FLOOR, z);
    g.beginPath();
    g.moveTo(a.x, a.y);
    g.lineTo(b.x, b.y);
    g.stroke();
  }
  g.restore();

  // Packets on the floor rails, so the room feels live.
  for (let i = 0; i < 26; i++) {
    const side = r() < 0.5 ? -1 : 1;
    const z = 0.6 + r() * 5.8;
    const p = at(side * AISLE * 0.93, FLOOR, z);
    const q = at(side * AISLE * 0.93, FLOOR, z + 0.09);
    g.strokeStyle = r() < 0.2 ? c.gold : c.cyan;
    g.lineWidth = Math.max(1, 3.5 / z);
    g.beginPath();
    g.moveTo(p.x, p.y);
    g.lineTo(q.x, q.y);
    g.stroke();
  }
}

/* Red and cyan light raking across the floor, and the rails it comes from. */
function paintLight(g, room, c) {
  const { at, W, H, vy } = room;
  g.save();
  g.globalCompositeOperation = 'lighter';
  const beam = (fromX, toX, colour, alpha) => {
    const a = at(fromX, FLOOR, FAR);
    const b = at(toX - 0.1, FLOOR, 0.4);
    const d = at(toX + 0.1, FLOOR, 0.4);
    const grad = g.createLinearGradient(a.x, a.y, (b.x + d.x) / 2, (b.y + d.y) / 2);
    grad.addColorStop(0, `${colour}00`);
    grad.addColorStop(0.25, `${colour}${alpha}`);
    grad.addColorStop(1, `${colour}00`);
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(a.x, a.y);
    g.lineTo(b.x, b.y);
    g.lineTo(d.x, d.y);
    g.closePath();
    g.fill();
  };
  beam(-0.2, -0.86, c.red, '66');
  beam(0.2, 0.86, c.cyan, '55');
  beam(-0.06, -0.3, c.magenta, '33');
  beam(0.06, 0.3, c.violet, '33');
  for (const [x, colour] of [[-AISLE * 0.97, c.cyan], [AISLE * 0.97, c.magenta]]) {
    const a = at(x, FLOOR, FAR);
    const b = at(x, FLOOR, 0.45);
    g.strokeStyle = colour;
    g.globalAlpha = 0.85;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(a.x, a.y);
    g.lineTo(b.x, b.y);
    g.stroke();
    g.globalAlpha = 1;
  }
  g.restore();

  // A haze of light at the far end, and dark corners so the HUD has somewhere to sit.
  const glow = g.createRadialGradient(W / 2, vy, 0, W / 2, vy, Math.max(W, H) * 0.42);
  glow.addColorStop(0, 'rgba(110, 70, 255, 0.22)');
  glow.addColorStop(0.5, 'rgba(60, 40, 170, 0.07)');
  glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, W, H);
  const vignette = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
  vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
  vignette.addColorStop(1, 'rgba(2, 1, 8, 0.62)');
  g.fillStyle = vignette;
  g.fillRect(0, 0, W, H);
}

/** Paints the room on ctx. What glows goes on glowCtx, which is what breathes on screen. */
export function paintScene(ctx, glowCtx, W, H, { seed = 2031 } = {}) {
  const c = readColours();
  const r = rng(seed);
  const room = makeRoom(W, H, false);
  const panels = buildPanels(c, seed);
  const emit = canvas(W / 4, H / 4).getContext('2d');

  paintShell(ctx, room, c);
  paintBackWall(ctx, room, c, rng(seed + 5), emit);
  paintWalls(ctx, room, c, seed, panels, emit);
  paintFloor(ctx, room, c, seed, panels, r);
  paintLight(ctx, room, c);

  if (glowCtx) {
    glowCtx.clearRect(0, 0, W, H);
    glowCtx.save();
    glowCtx.globalCompositeOperation = 'lighter';
    glowCtx.imageSmoothingQuality = 'high';
    glowCtx.globalAlpha = 0.22; // low, or it smears the sharp picture underneath
    glowCtx.drawImage(emit.canvas, 0, 0, W, H);
    // Drawn smaller and stretched back, it spreads into a soft bloom.
    const bloom = canvas(W / 16, H / 16).getContext('2d');
    bloom.imageSmoothingQuality = 'high';
    bloom.drawImage(emit.canvas, 0, 0, bloom.canvas.width, bloom.canvas.height);
    glowCtx.globalAlpha = 0.7;
    glowCtx.drawImage(bloom.canvas, 0, 0, W, H);
    glowCtx.restore();
  }
}
