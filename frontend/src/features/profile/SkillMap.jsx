import { useRef, useState } from 'react';
import { ChartTip, useChartTip } from './ChartTip.jsx';
import { MAX_RATING, spoke } from './skills.js';

const SIZE = { w: 440, h: 360 };
const CENTRE = { x: SIZE.w / 2, y: SIZE.h / 2 + 4 };
const RADIUS = 122;
const RINGS = [2, 4, 6, 8, 10];
const LABEL_GAP = 16;

/* How a label sits against its spoke, so the text always reads away from the web. */
function anchorOf(x) {
  if (Math.abs(x - CENTRE.x) < 1) return 'middle';
  return x > CENTRE.x ? 'start' : 'end';
}

/* Each core skill on its own spoke, rated 1 to 10 by the share of its missions cleared: a web that fills out as
   you learn. One measure, so one colour and no legend. Every point has a tooltip and can be reached by keyboard,
   and the table underneath has every number for anyone who can't see or hover. */
export function SkillMap({ skills }) {
  const { box, tip, show, hide } = useChartTip();
  const [active, setActive] = useState(0);
  const points = useRef([]);
  const count = skills.length;
  if (!count) return null;
  const at = (i, value) => spoke(i, count, (RADIUS * value) / MAX_RATING, CENTRE.x, CENTRE.y);
  const ring = (value) => skills.map((_, i) => at(i, value).join(',')).join(' ');
  const shape = skills.map((s, i) => at(i, s.rating).join(',')).join(' ');
  const describe = (s) => `${s.rating} of ${MAX_RATING}`;
  const detail = (s) => `${s.name}: ${s.cleared} of ${s.total} missions (${s.percent}%)`;
  const showPoint = (i) => show(points.current[i], describe(skills[i]), detail(skills[i]));
  const move = (e) => {
    const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const to = (active + step + count) % count;
    setActive(to);
    points.current[to].focus();
  };

  return (
    <div className="stack">
      <div className="chart skill-map" ref={box}>
        <svg viewBox={`0 0 ${SIZE.w} ${SIZE.h}`} role="group" aria-label="Skill map: each skill rated 1 to 10 by the missions you've cleared" onKeyDown={move}>
          <g className="skill-grid" aria-hidden="true">
            {RINGS.map((v) => <polygon key={v} points={ring(v)} />)}
            {skills.map((s, i) => {
              const [x, y] = at(i, MAX_RATING);
              return <line key={s.code} x1={CENTRE.x} y1={CENTRE.y} x2={x} y2={y} />;
            })}
            {RINGS.map((v) => {
              // Halfway between the first two spokes, where no point or label can land.
              const [x, y] = at(0.5, v * Math.cos(Math.PI / count));
              return <text key={v} className="skill-tick" x={x} y={y + 4} textAnchor="middle">{v}</text>;
            })}
          </g>
          <polygon className="skill-shape" points={shape} aria-hidden="true" />
          {skills.map((s, i) => {
            const [x, y] = at(i, s.rating);
            const [lx, ly] = spoke(i, count, RADIUS + LABEL_GAP, CENTRE.x, CENTRE.y);
            const below = ly > CENTRE.y + 1;
            const above = ly < CENTRE.y - RADIUS + 1;
            const anchor = anchorOf(lx);
            return (
              <g key={s.code}>
                <text className="skill-label" x={lx} y={above ? ly - 16 : below ? ly + 12 : ly - 4} textAnchor={anchor} aria-hidden="true">
                  <tspan>{s.name}</tspan>
                  <tspan className="skill-score" x={lx} dy="16">{s.rating ? `${s.rating}/${MAX_RATING}` : 'Not started'}</tspan>
                </text>
                <circle className="skill-point" cx={x} cy={y} r={s.rating ? 5 : 3.5} aria-hidden="true" />
                <circle
                  ref={(el) => { points.current[i] = el; }}
                  className="skill-hit"
                  cx={x}
                  cy={y}
                  r={16}
                  tabIndex={i === active ? 0 : -1}
                  role="img"
                  aria-label={`${detail(s)}, rated ${describe(s)}`}
                  onPointerEnter={() => showPoint(i)}
                  onPointerLeave={hide}
                  onClick={() => showPoint(i)}
                  onFocus={() => { setActive(i); showPoint(i); }}
                  onBlur={hide}
                />
              </g>
            );
          })}
        </svg>
        <ChartTip tip={tip} />
      </div>
      <details className="chart-table">
        <summary>Show the numbers</summary>
        <div className="chart-table-scroll">
          <table>
            <thead><tr><th scope="col">Skill</th><th scope="col">Rating</th><th scope="col">Missions cleared</th><th scope="col">Share</th></tr></thead>
            <tbody>{skills.map((s) => <tr key={s.code}><td>{s.name}</td><td>{s.rating ? `${s.rating} of ${MAX_RATING}` : 'Not started'}</td><td>{s.cleared} of {s.total}</td><td>{s.percent}%</td></tr>)}</tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
