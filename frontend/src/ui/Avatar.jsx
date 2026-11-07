/* A system avatar: one of sixteen small operators drawn in code, or the picture someone uploaded.
   Each index picks a head, a visor and a colour, so they're easy to tell apart at a glance. */
const COLOURS = [['--holo', '--holo-lo'], ['--violet', '--violet-lo'], ['--amber', '--gold-lo'], ['--magenta', '--violet-lo'], ['--ok', '--jade-lo'], ['--danger', '--blood-lo'], ['--holo-soft', '--holo-lo'], ['--lava', '--ember-lo']];

const HEADS = [
  <rect key="square" x="16" y="13" width="32" height="30" rx="8" />,
  <path key="helmet" d="M32 9 49 18V36L32 46 15 36V18Z" />,
  <path key="hood" d="M32 8C20 8 13 18 13 30V46H51V30C51 18 44 8 32 8Z" />,
  <circle key="round" cx="32" cy="28" r="18" />,
];
const VISORS = [
  <rect key="band" x="20" y="23" width="24" height="7" rx="3.5" />,
  <g key="eyes"><circle cx="25" cy="27" r="4" /><circle cx="39" cy="27" r="4" /></g>,
  <circle key="eye" cx="32" cy="27" r="6" />,
  <g key="slits"><rect x="20" y="23" width="9" height="3.5" rx="1.5" /><rect x="35" y="23" width="9" height="3.5" rx="1.5" /><rect x="24" y="31" width="16" height="3" rx="1.5" /></g>,
];

export function SystemAvatar({ index }) {
  const [hi, lo] = COLOURS[index % COLOURS.length];
  return (
    <svg className="avatar-art" viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" style={{ fill: `var(${lo})`, opacity: 0.32 }} />
      <path d="M8 64C8 52 18 47 32 47S56 52 56 64Z" style={{ fill: `var(${lo})` }} />
      <g style={{ fill: 'var(--tile)', stroke: `var(${hi})` }} strokeWidth="2.5" strokeLinejoin="round">{HEADS[index % 4]}</g>
      {index % 4 === 3 && <path d="M32 10V4" style={{ stroke: `var(${hi})` }} strokeWidth="2.5" strokeLinecap="round" />}
      <g style={{ fill: `var(${hi})` }}>{VISORS[Math.floor(index / 4) % 4]}</g>
    </svg>
  );
}

export function Avatar({ avatar, name, size = 34 }) {
  return (
    <span className="avatar" style={{ width: size, height: size }}>
      {avatar?.kind === 'upload' ? <img src={avatar.url} alt="" width={size} height={size} /> : <SystemAvatar index={avatar?.index ?? 0} />}
      <span className="sr-only">{name ? `${name}'s picture` : 'Picture'}</span>
    </span>
  );
}
