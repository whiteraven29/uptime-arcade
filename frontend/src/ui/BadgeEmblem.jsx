import { useId } from 'react';

/* A medal for every badge, drawn in code so it stays sharp at any size: on the Rewards wall, in a
   toast, and later on a share card. Each family has its own metal and every glyph is original. */
const FAMILY = {
  firstblock: 'ember', clean10: 'ember', hours10: 'ember', hours100: 'ember',
  week: 'jade', month: 'jade', centurion: 'jade',
  first: 'holo', par50: 'holo', nohints: 'holo', night: 'violet',
  tSH: 'violet', tVI: 'violet', tPY: 'violet', tGO: 'violet', tNET: 'violet', tLAB: 'violet',
  arch: 'gold',
  lv2: 'rank', lv3: 'rank', lv4: 'rank', lv5: 'rank', lv6: 'rank', lv7: 'rank', lv8: 'rank', lv9: 'rank',
  bx1: 'jade', bx2: 'holo', bx3: 'ember', bx4: 'gold', bx5: 'blood',
};
const HEX = '60,6 107,33 107,87 60,114 13,87 13,33';
const INNER = '60,16 98,38 98,82 60,104 22,82 22,38';

const Big = ({ children, y = 67, size = 26, font = 'var(--font-ui)' }) => (
  <text x="60" y={y} textAnchor="middle" fontFamily={font} fontWeight="800" fontSize={size} fill="currentColor">{children}</text>
);
const Flame = ({ scale = 1, y = 0 }) => (
  <path transform={`translate(60 ${60 + y}) scale(${scale}) translate(-60 -60)`} fill="currentColor" fillOpacity="0.2" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" d="M60 28c3 11 16 17 16 34a16 16 0 0 1-32 0c0-8 4-12 7-17 1 5 3 7 5 8 2-8 1-16 4-25Z" />
);
const Clock = ({ cy = 60, r = 24 }) => (
  <g fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <circle cx="60" cy={cy} r={r} />
    {[0, 90, 180, 270].map((a) => <path key={a} transform={`rotate(${a} 60 ${cy})`} d={`M60 ${cy - r + 3}v4`} />)}
  </g>
);

/* A rank: one chevron for every level climbed, stacked from the bottom. */
const Rank = ({ level }) => {
  const n = level - 1;
  const gap = n > 5 ? 7 : 9;
  const top = 60 - ((n - 1) * gap) / 2;
  return (
    <g fill="none" stroke="currentColor" strokeWidth={n > 5 ? 3 : 3.5} strokeLinecap="round" strokeLinejoin="round">
      {Array.from({ length: n }, (_, i) => <path key={i} d={`M42 ${top + i * gap + 5} 60 ${top + i * gap - 5} 78 ${top + i * gap + 5}`} />)}
    </g>
  );
};
/* A Beyond tier: one more star each time. */
const Stars = ({ n }) => {
  const star = 'M0 -9 2.6 -2.8 9 -2.8 3.9 1.2 5.6 7.6 0 3.9 -5.6 7.6 -3.9 1.2 -9 -2.8 -2.6 -2.8Z';
  const spots = { 1: [[60, 60]], 2: [[48, 60], [72, 60]], 3: [[60, 46], [46, 70], [74, 70]], 4: [[46, 46], [74, 46], [46, 74], [74, 74]] }[n];
  return <g fill="currentColor">{spots.map(([x, y]) => <path key={`${x}${y}`} d={star} transform={`translate(${x} ${y}) scale(${n === 1 ? 1.9 : 1.15})`} />)}</g>;
};

const GLYPH = {
  ...Object.fromEntries([2, 3, 4, 5, 6, 7, 8, 9].map((l) => [`lv${l}`, <Rank key={l} level={l} />])),
  bx1: <Stars n={1} />,
  bx2: <Stars n={2} />,
  bx3: <Stars n={3} />,
  bx4: <Stars n={4} />,
  bx5: (
    <g>
      <path fill="currentColor" fillOpacity="0.18" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" d="M60 30C45 30 36 41 36 54 36 63 40 69 46 73V84H74V73C80 69 84 63 84 54 84 41 75 30 60 30Z" />
      <circle cx="50" cy="56" r="6.5" fill="currentColor" />
      <circle cx="70" cy="56" r="6.5" fill="currentColor" />
      <path fill="currentColor" d="M60 63 55.5 71H64.5Z" />
      <path stroke="currentColor" strokeWidth="2.5" d="M53 76V84M60 76V84M67 76V84" />
    </g>
  ),
  firstblock: (
    <g stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round">
      <path fill="currentColor" fillOpacity="0.5" d="M60 32 84 45 60 58 36 45Z" />
      <path fill="currentColor" fillOpacity="0.22" d="M36 45 60 58V86L36 73Z" />
      <path fill="currentColor" fillOpacity="0.08" d="M84 45 60 58V86L84 73Z" />
    </g>
  ),
  clean10: (
    <g>
      <path fill="currentColor" fillOpacity="0.14" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" d="M60 30 84 39V60C84 74 74 84 60 90 46 84 36 74 36 60V39Z" />
      <Big y={69} size={25}>10</Big>
    </g>
  ),
  hours10: (
    <g>
      <Clock />
      <path fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" d="M60 60V45M60 60 49 66" />
      <circle cx="60" cy="60" r="2.5" fill="currentColor" />
    </g>
  ),
  hours100: (
    <g fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M44 30H76M44 90H76" strokeWidth="3.5" />
      <path d="M48 30C48 46 56 52 60 60 64 52 72 46 72 30M48 90C48 74 56 68 60 60 64 68 72 74 72 90" />
      <path fill="currentColor" stroke="none" fillOpacity="0.7" d="M52 88C53 79 57 74 60 70 63 74 67 79 68 88ZM53 40H67C66 45 62 50 60 54 58 50 54 45 53 40Z" />
    </g>
  ),
  week: <g><Flame scale={1.2} y={-2} /><Big y={75} size={22}>7</Big></g>,
  month: <g><Flame scale={1.25} y={-2} /><Big y={74} size={18}>30</Big><path stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" d="M42 90H78" /></g>,
  centurion: (
    <g>
      <g fill="currentColor" fillOpacity="0.8">
        {[[34, 72, -20], [31, 60, 0], [33, 48, 20], [39, 37, 42]].map(([x, y, r]) => <ellipse key={`l${y}`} rx="3" ry="6.5" transform={`translate(${x} ${y}) rotate(${r})`} />)}
        {[[86, 72, 20], [89, 60, 0], [87, 48, -20], [81, 37, -42]].map(([x, y, r]) => <ellipse key={`r${y}`} rx="3" ry="6.5" transform={`translate(${x} ${y}) rotate(${r})`} />)}
      </g>
      <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M42 84Q60 92 78 84" />
      <Big y={66} size={17}>100</Big>
    </g>
  ),
  first: (
    <g stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round">
      <path fill="currentColor" fillOpacity="0.18" d="M30 86 52 54 62 66 72 50 92 86Z" />
      <path fill="none" d="M62 66V30" />
      <path fill="currentColor" fillOpacity="0.8" d="M62 30 82 37 62 44Z" />
    </g>
  ),
  tSH: <g><path fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" d="M36 44 52 60 36 76" /><path stroke="currentColor" strokeWidth="5" strokeLinecap="round" d="M60 78H84" /></g>,
  tVI: <Big y={70} size={30} font="var(--font-mono)">:wq</Big>,
  tPY: <Big y={70} size={30} font="var(--font-mono)">&gt;&gt;&gt;</Big>,
  tGO: <g><Big y={72} size={36} font="var(--font-mono)">:=</Big><path stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" d="M34 44H52M30 52H44" /></g>,
  tNET: (
    <g stroke="currentColor" strokeWidth="2.5">
      <path fill="none" d="M60 36 38 76H82ZM60 36V58M38 76 60 58 82 76" />
      {[[60, 36], [38, 76], [82, 76], [60, 58]].map(([x, y]) => <circle key={`${x}${y}`} cx={x} cy={y} r={x === 60 && y === 58 ? 4 : 6} fill="currentColor" />)}
    </g>
  ),
  tLAB: (
    <g stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <rect x="32" y="34" width="56" height="16" rx="3" fill="currentColor" fillOpacity="0.18" />
      <rect x="32" y="70" width="56" height="16" rx="3" fill="currentColor" fillOpacity="0.18" />
      <path fill="none" d="M60 50V70M42 42H48M42 78H48M72 42H78M72 78H78" />
    </g>
  ),
  par50: (
    <g fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <circle cx="56" cy="64" r="24" />
      <circle cx="56" cy="64" r="14" />
      <circle cx="56" cy="64" r="4" fill="currentColor" />
      <path strokeWidth="3" d="M56 64 86 34M78 34H86V42" />
    </g>
  ),
  nohints: (
    <g fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path fill="currentColor" fillOpacity="0.14" d="M60 30C48 30 40 39 40 50 40 58 45 62 48 68V74H72V68C75 62 80 58 80 50 80 39 72 30 60 30Z" />
      <path d="M50 82H70M54 89H66" />
      <path strokeWidth="4" d="M34 90 86 30" />
    </g>
  ),
  night: (
    <g>
      <path fill="currentColor" fillOpacity="0.3" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" d="M72 32A30 30 0 1 0 88 74 25 25 0 0 1 72 32Z" />
      <path fill="currentColor" d="M74 46 76.5 52 83 54 76.5 56 74 62 71.5 56 65 54 71.5 52Z" />
    </g>
  ),
  arch: (
    <g stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round">
      <path fill="currentColor" fillOpacity="0.28" d="M34 78 30 42 47 56 60 32 73 56 90 42 86 78Z" />
      <path fill="none" strokeLinecap="round" strokeWidth="3.5" d="M36 88H84" />
      <circle cx="60" cy="64" r="5" fill="currentColor" />
    </g>
  ),
};

export function BadgeEmblem({ id }) {
  const uid = useId().replace(/:/g, '');
  const fam = FAMILY[id] || 'holo';
  return (
    <svg className={`emblem emblem-${fam}`} viewBox="0 0 120 120" aria-hidden="true">
      <defs>
        <linearGradient id={`${uid}m`} x1="0.1" y1="0" x2="0.9" y2="1">
          <stop offset="0" style={{ stopColor: `var(--${fam}-hi)` }} />
          <stop offset="0.5" style={{ stopColor: `var(--${fam}-lo)` }} />
          <stop offset="0.72" style={{ stopColor: `var(--${fam}-hi)` }} />
          <stop offset="1" style={{ stopColor: `var(--${fam}-lo)` }} />
        </linearGradient>
        <radialGradient id={`${uid}g`} cx="0.5" cy="0.32" r="0.8">
          <stop offset="0" style={{ stopColor: `var(--${fam}-lo)`, stopOpacity: 0.55 }} />
          <stop offset="1" style={{ stopColor: 'var(--emblem-core)', stopOpacity: 1 }} />
        </radialGradient>
      </defs>
      <polygon points={HEX} fill="var(--emblem-core)" stroke={`url(#${uid}m)`} strokeWidth="4" strokeLinejoin="round" />
      <polygon points={INNER} fill={`url(#${uid}g)`} stroke={`url(#${uid}m)`} strokeWidth="1" strokeOpacity="0.6" strokeLinejoin="round" />
      <path d="M22 38 60 16 98 38" fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.5" strokeLinejoin="round" />
      <g className="emblem-glyph">{GLYPH[id]}</g>
    </svg>
  );
}
