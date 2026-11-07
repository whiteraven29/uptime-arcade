const C = 2 * Math.PI * 150;

/* The reactor: counter-rotating rings, a pulsing glow, and an amber arc of progress to the next level. */
export function CoreRing({ level, title, sub, progress }) {
  return (
    <div className="core">
      <svg viewBox="0 0 400 400" aria-hidden="true">
        <defs>
          <radialGradient id="coreGlow">
            <stop offset="0" stopColor="#04101e" stopOpacity=".9" />
            <stop offset=".62" stopColor="#0a2c44" stopOpacity=".55" />
            <stop offset=".8" stopColor="#62dcff" stopOpacity=".2" />
            <stop offset="1" stopColor="#62dcff" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="coreIris" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#62dcff" />
            <stop offset=".45" stopColor="#a39bff" />
            <stop offset=".75" stopColor="#ff9dc8" />
            <stop offset="1" stopColor="#62dcff" />
          </linearGradient>
        </defs>
        <circle cx="200" cy="200" r="188" fill="url(#coreGlow)" className="pulse" />
        <g className="spin"><circle cx="200" cy="200" r="192" fill="none" stroke="#a9ecff" strokeOpacity=".62" strokeWidth="1" strokeDasharray="2 9" /></g>
        <g className="spin rev"><circle cx="200" cy="200" r="174" fill="none" stroke="url(#coreIris)" strokeOpacity=".82" strokeWidth="4" strokeDasharray="46 22 8 22" /></g>
        <circle cx="200" cy="200" r="150" fill="none" stroke="#62dcff" strokeOpacity=".2" strokeWidth="9" />
        <circle cx="200" cy="200" r="150" fill="none" stroke="#ffb340" strokeWidth="9" strokeLinecap="round" transform="rotate(-90 200 200)" strokeDasharray={`${C * Math.min(1, progress)} ${C}`} style={{ filter: 'drop-shadow(0 0 7px #ff8a30)' }} />
        <g className="spin"><circle cx="200" cy="200" r="130" fill="none" stroke="#a9ecff" strokeOpacity=".5" strokeWidth="1" strokeDasharray="70 18" /></g>
      </svg>
      <div className="core-text">
        <div className="lv">{level}</div>
        <div className="name metal">{title}</div>
        <div className="sub">{sub}</div>
      </div>
    </div>
  );
}
