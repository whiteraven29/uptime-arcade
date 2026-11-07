import { useEffect, useRef, useState } from 'react';
import { DeviceIcon } from './DeviceIcon.jsx';
import { ensureAudio, playPacketDelivered, playPacketLost, playPlugIn, playUnplug } from '../../../../sound/cues.js';

/* The map is drawn on a fixed grid and scales to whatever room it has. Labs with wiring need room for the ports. */
const W = 1000;
const HEIGHT = 420;
const HEIGHT_WIRED = 500;
const MARGIN_X = 60;
const MARGIN_Y = 50;
const SOCKETS_PER_ROW = 8;
const SOCKET_GAP = 23;
const SOCKET_BELOW = 72;
const NEGOTIATE_MS = 1300; // the amber moment before a link comes up
const STEP_EVERY = 420;
const HOP_MS = 340;
const EDGE_REACH = 44;
const EDGE_SLIDE = 26;

const prefersStill = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Every step of a trace, there and back, in order. */
export function traceSteps(trace) {
  if (!trace) return [];
  const there = (trace.there || []).map((h) => ({ ...h, phase: 'there' }));
  const back = (trace.back || []).map((h) => ({ ...h, phase: 'back' }));
  return [...there, ...back];
}

/* A new trace plays by itself unless motion is off. Stepping takes over from there. */
export function useSteps(trace) {
  const steps = traceSteps(trace);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!trace) return;
    if (prefersStill()) {
      setIndex(steps.length - 1);
      setPlaying(false);
    } else {
      setIndex(0);
      setPlaying(steps.length > 1);
    }
    // Only a new trace restarts it.
  }, [trace]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!playing) return undefined;
    const id = setInterval(() => {
      setIndex((i) => {
        if (i + 1 >= steps.length) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, STEP_EVERY);
    return () => clearInterval(id);
  }, [playing, steps.length]);
  const clamped = Math.min(index, Math.max(0, steps.length - 1));
  return {
    steps,
    index: clamped,
    current: steps[clamped] || null,
    playing,
    atEnd: clamped >= steps.length - 1,
    prev: () => { setPlaying(false); setIndex(Math.max(0, clamped - 1)); },
    next: () => { setPlaying(false); setIndex(Math.min(steps.length - 1, clamped + 1)); },
    replay: () => { setIndex(0); setPlaying(!prefersStill()); },
  };
}

/* ---------- geometry: where everything is, and how a cable hangs ---------- */
function layout(view, wiring) {
  const height = wiring ? HEIGHT_WIRED : HEIGHT;
  const spots = {};
  const sockets = {};
  for (const d of view.devices) {
    const at = { x: MARGIN_X + (d.x / 100) * (W - MARGIN_X * 2), y: MARGIN_Y + (d.y / 100) * (HEIGHT - MARGIN_Y - 60) };
    spots[d.name] = at;
    d.ports.forEach((port, i) => {
      const row = Math.floor(i / SOCKETS_PER_ROW);
      const inRow = Math.min(d.ports.length - row * SOCKETS_PER_ROW, SOCKETS_PER_ROW);
      sockets[`${d.name}|${port}`] = { dev: d.name, port, x: at.x + ((i % SOCKETS_PER_ROW) - (inRow - 1) / 2) * SOCKET_GAP, y: at.y + SOCKET_BELOW + row * SOCKET_GAP };
    });
  }
  return { height, spots, sockets };
}
/* A cable hangs a little under its own weight. */
const sagOf = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + Math.min(44, Math.hypot(a.x - b.x, a.y - b.y) * 0.16) });
const curve = (a, b) => {
  const c = sagOf(a, b);
  return `M${a.x} ${a.y}Q${c.x} ${c.y} ${b.x} ${b.y}`;
};
const along = (a, b, t) => {
  const c = sagOf(a, b);
  const u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
};

/* The packet runs along the cable between two devices, rather than cutting across the map. */
function usePacketPosition(current, ends, spots) {
  const [point, setPoint] = useState(null);
  const last = useRef(null);
  const name = current?.dev ?? null;
  useEffect(() => {
    if (!name || !spots[name]) {
      setPoint(null);
      last.current = null;
      return undefined;
    }
    const from = last.current;
    last.current = name;
    const to = spots[name];
    if (!from || from === name || !spots[from] || prefersStill()) {
      setPoint(to);
      return undefined;
    }
    const link = ends(from, name);
    const [a, b] = link || [spots[from], to];
    const started = performance.now();
    let frame = requestAnimationFrame(function move(now) {
      const t = Math.min(1, (now - started) / HOP_MS);
      setPoint(along(a, b, t));
      if (t < 1) frame = requestAnimationFrame(move);
    });
    return () => cancelAnimationFrame(frame);
    // Only moving to another device starts a new run.
  }, [name, current]); // eslint-disable-line react-hooks/exhaustive-deps
  return point;
}

const BUBBLES = { nat: 'NAT', acl: 'Allowed', firewall: 'Firewall', encrypt: 'Encrypted', decrypt: 'Decrypted', encap: 'Wrapped', decap: 'Unwrapped', drop: 'Dropped', deliver: 'Delivered' };

export function LabMap({ view, selected, walk, won, wiring, onSelect, onMove, onPlug, onUnplug }) {
  const svg = useRef(null);
  const drag = useRef(null);
  const [wire, setWire] = useState(null);
  const [fresh, setFresh] = useState({});
  const { height, spots, sockets } = layout(view, wiring);
  const current = walk?.current ?? null;

  const cableAt = (key) => view.cables.find((c) => !c.wifi && (`${c.a}|${c.pa}` === key || `${c.b}|${c.pb}` === key));
  const taken = new Set(view.cables.filter((c) => !c.wifi).flatMap((c) => [`${c.a}|${c.pa}`, `${c.b}|${c.pb}`]));
  const endsOf = (c) => {
    if (c.wifi || !wiring) return [spots[c.a], spots[c.b]];
    return [sockets[`${c.a}|${c.pa}`] || spots[c.a], sockets[`${c.b}|${c.pb}`] || spots[c.b]];
  };
  const linkBetween = (x, y) => view.cables.find((c) => (c.a === x && c.b === y) || (c.a === y && c.b === x));
  const packetEnds = (from, to) => {
    const c = linkBetween(from, to);
    if (!c) return null;
    const [a, b] = endsOf(c);
    return c.a === from ? [a, b] : [b, a];
  };
  const packet = usePacketPosition(current, packetEnds, spots);

  // The last moment of a trace gets its own small sound. Muting silences it with everything else.
  const stepKey = walk ? `${walk.steps.length}-${walk.index}-${current?.dev}` : '';
  useEffect(() => {
    if (!current || prefersStill()) return;
    if (current.action === 'drop') playPacketLost();
    else if (walk.atEnd && current.action === 'deliver') playPacketDelivered();
  }, [stepKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- pointers ---------- */
  const toMap = (e) => {
    const m = svg.current.getScreenCTM();
    const point = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: point.x, y: point.y, scale: m.a };
  };
  const toPercent = (p) => ({
    x: Math.round(Math.max(0, Math.min(100, ((p.x - MARGIN_X) / (W - MARGIN_X * 2)) * 100))),
    y: Math.round(Math.max(0, Math.min(100, ((p.y - MARGIN_Y) / (HEIGHT - MARGIN_Y - 60)) * 100))),
  });
  /* On a phone the map is small, so the reach of a finger is measured in screen pixels. */
  const nearestSocket = (p, reach, wanted) => {
    let best = null;
    let bestDistance = Math.max(reach, (reach * 1.4) / p.scale);
    for (const [key, s] of Object.entries(sockets)) {
      if (!wanted(key, s)) continue;
      const d = Math.hypot(s.x - p.x, s.y - p.y);
      if (d < bestDistance) {
        best = s;
        bestDistance = d;
      }
    }
    return best;
  };
  const dropTarget = (p, from) => {
    const free = (key, s) => s.dev !== from.dev && !taken.has(key);
    const close = nearestSocket(p, 24, free);
    if (close) return close;
    // Letting go on the device itself takes its first free port, which is kinder on a small screen.
    const device = view.devices.find((d) => d.name !== from.dev && Math.hypot(spots[d.name].x - p.x, spots[d.name].y - p.y) < 44);
    return device ? Object.values(sockets).find((s) => s.dev === device.name && !taken.has(`${s.dev}|${s.port}`)) || null : null;
  };

  const onPointerDownCapture = (e) => {
    if (!wiring) return;
    const p = toMap(e);
    const grabbed = nearestSocket(p, 16, () => true);
    if (!grabbed) return;
    e.stopPropagation();
    e.preventDefault();
    ensureAudio();
    const key = `${grabbed.dev}|${grabbed.port}`;
    const plugged = cableAt(key);
    let from = grabbed;
    if (plugged) {
      // Pulling a plugged cable takes this end out, and the other end stays where it is.
      const far = plugged.a === grabbed.dev && plugged.pa === grabbed.port ? `${plugged.b}|${plugged.pb}` : `${plugged.a}|${plugged.pa}`;
      from = sockets[far];
      onUnplug(grabbed.dev, grabbed.port);
      playUnplug();
    }
    svg.current.setPointerCapture?.(e.pointerId);
    setWire({ from, x: p.x, y: p.y, target: null });
  };
  const onPointerMove = (e) => {
    if (wire) {
      // On a phone the far device may be off to one side, so the map slides along with your hand.
      const scroller = svg.current.parentElement;
      const box = scroller.getBoundingClientRect();
      if (e.clientX > box.right - EDGE_REACH) scroller.scrollLeft += EDGE_SLIDE;
      else if (e.clientX < box.left + EDGE_REACH) scroller.scrollLeft -= EDGE_SLIDE;
      const p = toMap(e);
      setWire({ ...wire, x: p.x, y: p.y, target: dropTarget(p, wire.from) });
      return;
    }
    if (!onMove || !drag.current) return;
    if (Math.hypot(e.clientX - drag.current.x, e.clientY - drag.current.y) > 4) drag.current.moved = true;
    if (drag.current.moved) {
      const p = toPercent(toMap(e));
      onMove(drag.current.name, p.x, p.y);
    }
  };
  const onPointerUp = () => {
    drag.current = null;
    if (!wire) return;
    const { from, target } = wire;
    setWire(null);
    if (!target) return;
    const err = onPlug(from.dev, from.port, target.dev, target.port);
    if (err) return;
    playPlugIn();
    if (prefersStill()) return;
    const key = `${from.dev}|${from.port}`;
    setFresh((f) => ({ ...f, [key]: true }));
    setTimeout(() => setFresh((f) => {
      const next = { ...f };
      delete next[key];
      return next;
    }), NEGOTIATE_MS);
  };

  const socketState = (key) => {
    const c = cableAt(key);
    if (!c) return 'free';
    if (fresh[`${c.a}|${c.pa}`] || fresh[`${c.b}|${c.pb}`]) return 'negotiating';
    return c.blocked ? 'blocked' : c.up ? 'up' : 'down';
  };
  const hotLink = (() => {
    if (!walk || walk.index === 0) return null;
    const before = walk.steps[walk.index - 1]?.dev;
    return before && before !== current?.dev ? linkBetween(before, current?.dev) : null;
  })();
  const packetKind = !current ? '' : current.action === 'drop' ? ' lost' : current.pkt && (current.pkt.proto === 'esp' || current.pkt.proto === 'gre') ? ' sealed' : current.phase === 'back' ? ' answer' : '';

  return (
    <svg
      ref={svg}
      className={`lab-map${won ? ' won' : ''}${wire ? ' wiring' : ''}`}
      viewBox={`0 0 ${W} ${height}`}
      role="group"
      aria-label="Network map. Choose a device to open its console."
      onPointerDownCapture={onPointerDownCapture}
      onPointerMove={wire || onMove ? onPointerMove : undefined}
      onPointerUp={onPointerUp}
      onPointerCancel={() => { setWire(null); drag.current = null; }}
    >
      {view.cables.map((c) => {
        const [a, b] = endsOf(c);
        const negotiating = fresh[`${c.a}|${c.pa}`] || fresh[`${c.b}|${c.pb}`];
        const state = c.wifi ? 'wifi' : negotiating ? 'negotiating' : c.blocked ? 'blocked' : c.up ? 'up' : 'down';
        const hot = hotLink === c;
        const middle = along(a, b, 0.5);
        const near = (p, q) => ({ x: p.x + (q.x - p.x) * 0.2, y: p.y + (q.y - p.y) * 0.2 - 6 });
        const [na, nb] = [near(a, b), near(b, a)];
        return (
          <g key={`${c.a}${c.pa}`} className={`lab-cable ${state}${hot ? ' hot' : ''}`} data-link={`${c.a}-${c.b}`}>
            <path d={curve(a, b)} />
            {won && !c.wifi && <path className="lab-surge" d={curve(a, b)} />}
            {!wiring && !c.wifi && <text x={na.x} y={na.y} textAnchor="middle">{c.pa}</text>}
            {!wiring && !c.wifi && <text x={nb.x} y={nb.y} textAnchor="middle">{c.pb}</text>}
            {c.wifi && <text x={middle.x} y={middle.y - 6} textAnchor="middle">{c.pb}</text>}
          </g>
        );
      })}
      {wire && (
        <g className={`lab-wire${wire.target ? ' ready' : ''}`} id="labWire">
          <path d={curve(wire.from, wire.target || wire)} />
          <circle cx={(wire.target || wire).x} cy={(wire.target || wire).y} r="7" />
        </g>
      )}
      {view.devices.map((d) => {
        const p = spots[d.name];
        const open = !d.locked;
        return (
          <g
            key={d.name}
            className={`lab-device${selected === d.name ? ' on' : ''}${d.locked ? ' locked' : ''}${onMove ? ' draggable' : ''}${current?.dev === d.name ? ' busy' : ''}`}
            data-device={d.name}
            transform={`translate(${p.x} ${p.y})`}
            role={open ? 'button' : 'img'}
            tabIndex={open ? 0 : undefined}
            aria-label={open ? `Open the console of ${d.name}` : `${d.name}, which isn't yours to configure`}
            onPointerDown={onMove ? (e) => { drag.current = { name: d.name, x: e.clientX, y: e.clientY, moved: false }; } : undefined}
            onClick={open ? () => { if (!drag.current?.moved) onSelect(d.name); } : undefined}
            onKeyDown={open ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(d.name); } } : undefined}
          >
            <circle className="lab-hit" r="38" />
            <DeviceIcon kind={d.kind} />
            <text y="50" textAnchor="middle">{d.hostname}</text>
            {d.locked && <text className="lab-lock" y="-36" textAnchor="middle">not yours</text>}
          </g>
        );
      })}
      {wiring && Object.entries(sockets).map(([key, s]) => {
        const state = socketState(key);
        const isTarget = wire?.target && wire.target.dev === s.dev && wire.target.port === s.port;
        return (
          <g key={key} className={`lab-socket ${state}${isTarget ? ' target' : ''}`} data-port={key} transform={`translate(${s.x} ${s.y})`}>
            <title>{`${s.dev} ${s.port}`}</title>
            <rect className="lab-socket-grip" x="-14" y="-14" width="28" height="28" />
            <rect x="-9" y="-9" width="18" height="18" rx="3" />
            <circle r="4.5" />
          </g>
        );
      })}
      {/* While a cable is in your hand, the port names appear, because that's when they matter. */}
      {wire && Object.values(sockets).filter((s) => s.dev !== wire.from.dev).filter((s) => wire.target?.dev === s.dev).map((s) => (
        <text key={`${s.dev}${s.port}`} className={`lab-port-name${wire.target?.port === s.port ? ' target' : ''}`} x={s.x} y={s.y + 25} textAnchor="middle">{s.port.replace('Gi0/', '')}</text>
      ))}
      {packet && <circle className={`lab-packet${packetKind}`} r="9" cx={packet.x} cy={packet.y} />}
      {current?.action === 'drop' && spots[current.dev] && <circle key={stepKey} className="lab-burst" r="12" cx={spots[current.dev].x} cy={spots[current.dev].y} />}
      {current && BUBBLES[current.action] && spots[current.dev] && (
        <text key={`b${stepKey}`} className={`lab-bubble ${current.action}`} x={spots[current.dev].x} y={spots[current.dev].y - 42} textAnchor="middle">{BUBBLES[current.action]}</text>
      )}
    </svg>
  );
}

export function Legend({ wifi, wiring }) {
  return (
    <div className="lab-legend" aria-hidden="true">
      <span><i className="up" />Up</span>
      <span><i className="negotiating" />Coming up</span>
      <span><i className="down" />Down</span>
      <span><i className="blocked" />Blocked by spanning tree</span>
      {wifi && <span><i className="wifi" />Wi-Fi</span>}
      {wiring && <b>Drag from one port to another to plug in. Pull a cable out to unplug it.</b>}
    </div>
  );
}

const packetText = (p) => {
  if (!p) return '';
  const ports = p.proto === 'tcp' || p.proto === 'udp' ? ` ports ${p.sport} to ${p.dport}` : '';
  const inner = p.inner ? ` carrying ${p.inner.src || '?'} to ${p.inner.dst} (${p.inner.proto})` : '';
  return `${p.src || 'this device'} to ${p.dst}, ${p.proto}${ports}, TTL ${p.ttl}${inner}`;
};

/* The last packet, one decision at a time, like a debugger for the network. */
export function TraceStepper({ trace, walk }) {
  if (!trace) return null;
  const { steps, index, current, prev, next, replay } = walk;
  return (
    <div className={`lab-trace${trace.ok ? ' ok' : ' bad'}`} role="status" id="labTrace">
      <b>{trace.ok ? '✓ Got there and back' : trace.status === 'refused' ? '✗ Refused' : '✗ Dropped'}{trace.encrypted ? ', encrypted' : ''}</b>
      {trace.why && <small>{trace.why}</small>}
      {current && (
        <div className="lab-step" id="labStep">
          <div className="lab-step-head">
            <span>Step {index + 1} of {steps.length}{current.phase === 'back' ? ', the answer' : ''}</span>
            <b>{current.dev}</b>
          </div>
          <span>{current.detail}</span>
          {current.pkt && <code>{packetText(current.pkt)}</code>}
        </div>
      )}
      <div className="row lab-step-buttons">
        <button className="btn" type="button" id="stepPrev" disabled={index === 0} onClick={prev}>Back</button>
        <button className="btn" type="button" id="stepNext" disabled={index >= steps.length - 1} onClick={next}>Next</button>
        <button className="btn" type="button" id="stepReplay" onClick={replay}>Replay</button>
      </div>
    </div>
  );
}
