/* The player: a hooded operator seen from behind, lit by the hologram above and the lava below.
   An original silhouette for Whiteraven. */
export function OperatorFigure() {
  return (
    <div className="operator" aria-hidden="true">
      <div className="beam" />
      <div className="plate">
        <svg viewBox="0 0 200 200">
          <g className="spin" style={{ transformOrigin: '100px 100px' }}>
            <circle cx="100" cy="100" r="96" fill="none" stroke="#62dcff" strokeOpacity=".8" strokeWidth="2" strokeDasharray="30 12 6 12" />
          </g>
          <circle cx="100" cy="100" r="74" fill="none" stroke="#a9ecff" strokeOpacity=".5" strokeWidth="1.2" />
          <circle cx="100" cy="100" r="50" fill="#62dcff" fillOpacity=".12" stroke="#62dcff" strokeOpacity=".7" strokeWidth="1.2" />
        </svg>
      </div>
      <svg className="figure" viewBox="0 0 64 160">
        <defs>
          <linearGradient id="coat" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#5a8fb4" />
            <stop offset=".1" stopColor="#1f3a54" />
            <stop offset=".46" stopColor="#0a1420" />
            <stop offset=".76" stopColor="#1a1110" />
            <stop offset="1" stopColor="#a9441a" />
          </linearGradient>
          <linearGradient id="rim" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#c6f1ff" />
            <stop offset=".42" stopColor="#62dcff" stopOpacity=".4" />
            <stop offset=".72" stopColor="#ff8a3a" stopOpacity=".3" />
            <stop offset="1" stopColor="#ffb066" />
          </linearGradient>
        </defs>
        <g fill="url(#coat)" stroke="url(#rim)" strokeWidth=".9" strokeLinejoin="round">
          <path d="M20.5 114 L19 149 L16.5 156.5 L28.5 156.5 L29.5 149 L30.5 114 Z" />
          <path d="M33.5 114 L34.5 149 L35.5 156.5 L47.5 156.5 L45 149 L43.5 114 Z" />
          <path d="M32 4 C25 4 20.5 9 20 16 C19.6 20 20.5 24 22 27 C17 29 12 31 10 36 C7.5 44 7 58 7.5 72 C7.6 78 8 84 9 88 L13 88 L15 70 L13 116 C20 119.5 44 119.5 51 116 L49 70 L51 88 L55 88 C56 84 56.4 78 56.5 72 C57 58 56.5 44 54 36 C52 31 47 29 42 27 C43.5 24 44.4 20 44 16 C43.5 9 39 4 32 4 Z" />
        </g>
        <path d="M32 30 L32 117" stroke="#62dcff" strokeOpacity=".22" strokeWidth=".8" />
        <path d="M23 26.5 C27 29.5 37 29.5 41 26.5" fill="none" stroke="#a9ecff" strokeOpacity=".55" strokeWidth=".8" />
      </svg>
    </div>
  );
}
