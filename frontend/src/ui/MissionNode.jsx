/* A diamond on a track path. Locked is dim, open glows cyan, rewind is amber, cleared is green. */
export function MissionNode({ state, title, sub, flash, onClick, id, difficulty, difficultyLabel }) {
  return (
    <button type="button" className={`node ${state}${flash ? ' flash' : ''}`} onClick={onClick} data-id={id} aria-disabled={state === 'locked' || undefined}>
      <span className="dot" />
      <span>
        <span className="t">{title}{difficulty && <i className={`diff-dot diff-${difficulty}`} title={difficultyLabel}><span className="sr-only">, {difficultyLabel}</span></i>}</span>
        {sub && <small>{sub}</small>}
      </span>
    </button>
  );
}
