import { byId, difficultyLabel, missionPath, stateOf, toast, ui } from '../../api/game.js';

const STATE_WORD = { clear: 'cleared', open: 'next up', rewind: 'questions waiting', locked: 'locked' };
const MARK = { clear: '✓', open: '▶', rewind: '?' };

/* Every lab as a node on one long cable. It lights up as labs clear, and a newly opened one pops into place. */
export function LabProgressMap({ chapters, onOpen }) {
  const all = chapters.flatMap((c) => c.missions);
  const live = all.filter((m) => stateOf(m) === 'clear').length;
  return (
    <div className="lab-progress-map" id="labProgressMap">
      <p className="small">{live} of {all.length} labs live. Each one you clear lights up the next stretch of cable.</p>
      {chapters.map((c) => (
        <div className="lm-chapter" key={c.name}>
          <span className="lm-name">{c.name}</span>
          <div className="lm-nodes">
            {c.missions.map((m) => {
              const st = stateOf(byId(m.id) || m);
              const why = st === 'locked' ? m.lockedBecause || 'Clear the lab before this one first.' : '';
              return (
                <button
                  key={m.id}
                  type="button"
                  data-id={m.id}
                  className={`lm-node ${st}${ui.flash === m.id ? ' fresh' : ''}`}
                  title={`${m.title}. ${difficultyLabel(m.difficulty)}. ${why || STATE_WORD[st]}`}
                  aria-label={`${m.title}: ${STATE_WORD[st]}. ${why}`}
                  onClick={() => (st === 'locked' ? toast(why) : onOpen(missionPath(m)))}
                >
                  {MARK[st] || m.pos + 1}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
