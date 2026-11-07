export function LadderRow({ state = '', cells }) {
  return cells.map((c, i) => <span key={i} className={state}>{c}</span>);
}
