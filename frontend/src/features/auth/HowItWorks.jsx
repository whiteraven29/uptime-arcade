/* What the game is, for someone who hasn't played it: one loop, drawn and then said in words. A dot walks the loop
   and each step lights as it passes. With reduced motion, everything simply stays lit. */
const R = 112;
const C = 160;

const STEPS = [
  { name: 'Focus', text: 'Plan your week, then finish a real study block away from the game.' },
  { name: 'Earn', text: 'Every block you keep pays play time into your bank.' },
  { name: 'Play', text: 'Spend it on hands-on missions in a terminal, a code editor and a network lab.' },
  { name: 'Level up', text: 'Clear a mission and its questions to earn XP, badges and your next level.' },
];
const TRACKS = ['Shell', 'vi', 'Python', 'Go', 'Networking', 'NetLab'];

const ICONS = [
  <><circle r="13" /><path d="M0-8V0l6 4" /></>,
  <><path d="M-9-13H9M-9 13H9M-7-13c0 8 14 8 14 13S-7 5-7 13M7-13c0 8-14 8-14 13" /></>,
  <><path d="M-13-10H13V10H-13z" /><path d="M-8-4l5 4-5 4M1 5H8" /></>,
  <><path d="M0-14 12-8V2C12 8 6 12 0 14-6 12-12 8-12 2V-8z" /><path d="M-5 0l4 4 6-7" /></>,
];
const spot = (i) => {
  const angle = (i * Math.PI) / 2 - Math.PI / 2;
  return [C + R * Math.cos(angle), C + R * Math.sin(angle)];
};

function Loop() {
  return (
    <svg className="hiw-loop" viewBox="0 0 320 320" aria-hidden="true">
      <circle className="hiw-ring" cx={C} cy={C} r={R} />
      <g className="hiw-orbit"><circle className="hiw-dot" cx={C} cy={C - R} r="6" /></g>
      {STEPS.map((step, i) => {
        const [x, y] = spot(i);
        return (
          <g key={step.name} transform={`translate(${x} ${y})`}>
            <g className="hiw-node" style={{ '--i': i }}>
              <circle className="hiw-disc" r="31" />
              <g className="hiw-icon">{ICONS[i]}</g>
            </g>
          </g>
        );
      })}
      <text className="hiw-centre" x={C} y={C - 4} textAnchor="middle">Focus earns</text>
      <text className="hiw-centre" x={C} y={C + 18} textAnchor="middle">play time</text>
    </svg>
  );
}

export function HowItWorks() {
  return (
    <aside className="hiw" id="howItWorks" aria-label="How Uptime Arcade works">
      <h2>Real focus earns play time. Play time teaches real skills.</h2>
      <div className="hiw-body">
        <Loop />
        <ol className="hiw-steps">
          {STEPS.map((step, i) => (
            <li key={step.name} style={{ '--i': i }}><b>{step.name}</b><span>{step.text}</span></li>
          ))}
        </ol>
      </div>
      <p className="hiw-tracks"><span>Start from zero in</span> {TRACKS.map((t) => <i key={t}>{t}</i>)}</p>
    </aside>
  );
}
