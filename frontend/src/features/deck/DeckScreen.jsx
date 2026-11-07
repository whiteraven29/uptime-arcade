import { Link, useNavigate } from 'react-router-dom';
import { HudPanel } from '../../ui/HudPanel.jsx';
import { CoreRing } from '../../ui/CoreRing.jsx';
import { OperatorFigure } from '../../ui/OperatorFigure.jsx';
import { StatTile } from '../../ui/StatTile.jsx';
import { Meter } from '../../ui/Meter.jsx';
import { PlayIcon, TimerIcon } from '../../ui/icons.jsx';
import { pad } from '../../../../engines/fs/index.js';
import { EARN, LEVELS, S, STREAKS, TK, TRACKS, cleared, level, levelIdx, missionPath, mmss, mult, nextUp, sessionOn, stateOf, trackName } from '../../api/localGame.js';

function nextAction() {
  if (S.focus) return { label: 'Back to Focus', to: '/focus', title: 'A focus block is running', sub: 'Missions stay locked until it ends' };
  if (S.claim) return { label: 'Claim your block', to: '/focus', title: 'Your block is finished', sub: 'Claim the play time you earned' };
  if (S.bank <= 0 && !sessionOn()) return { label: 'Start a block', to: '/focus', title: 'No play time banked', sub: 'Finish a focus block to earn some' };
  const m = nextUp();
  if (!m) return { label: 'View rewards', to: '/rewards', title: 'All paths cleared', sub: 'On-call shifts are open' };
  const rewind = stateOf(m) === 'rewind';
  return { label: rewind ? 'Continue rewind' : 'Open briefing', to: missionPath(m), title: m.title, sub: `${trackName(m.track)}, mission ${m.pos + 1}` };
}

export function DeckScreen() {
  const navigate = useNavigate();
  const i = levelIdx();
  const c = Math.max(cleared(), S.peak);
  const lo = LEVELS[i][0];
  const hi = (LEVELS[i + 1] || [c])[0];
  const progress = hi === lo ? 1 : (c - lo) / (hi - lo);
  const nx = STREAKS.find((s) => !S.claimed[s[0]]);
  const action = nextAction();

  return (
    <section className="screen flush" aria-label="Deck">
      <div className="deck">
        <div className="deck-col">
          <Link className="hud card" to="/focus">
            <div className="card-body">
              <span className="card-icon"><TimerIcon /></span>
              <span>
                <span className="card-title">Earn play time</span><br />
                <span className="card-sub">{S.len} min earns {EARN[S.len]}:00. Banked {mmss(S.bank)}</span>
              </span>
            </div>
          </Link>
          <StatTile label="Day streak" value={S.streak} amber sub={`${nx ? `Next reward at ${nx[0]} days. ` : ''}XP +${Math.round((mult() - 1) * 100)}%. Shields ${S.shields}.`} />
          <StatTile label="Today" value={`${S.todayMin}m`} sub={`${S.todayDrifts} drifts logged`} />
          <StatTile label="Lifetime focus" value={`${Math.floor(S.focusMin / 60)}h ${pad(S.focusMin % 60)}m`} sub={`${S.blocks} block${S.blocks === 1 ? '' : 's'} finished`} />
        </div>

        <div className="deck-hero">
          <p className="eyebrow">Whiteraven operations · Season {S.season}</p>
          <CoreRing
            level={`Level ${i + 1}`}
            title={level()}
            sub={LEVELS[i + 1] ? `${hi - c} missions to ${LEVELS[i + 1][1]}` : 'Top of the order'}
            progress={progress}
          />
          <OperatorFigure />
          <div className="hero-actions">
            <button className="btn go" type="button" onClick={() => navigate(action.to)}>
              <PlayIcon /> {action.label}
            </button>
            <p className="tagline">Finish real work<i>·</i>Earn play time<i>·</i>Learn real skills</p>
          </div>
        </div>

        <div className="deck-col right">
          <Link className="hud card" to={action.to}>
            <div className="card-body">
              <span className="card-icon"><PlayIcon /></span>
              <span>
                <span className="card-title">{action.title}</span><br />
                <span className="card-sub">Next objective: {action.sub}</span>
              </span>
            </div>
          </Link>
          <HudPanel label="Skill paths">
            {TRACKS.map(([k, l]) => {
              const d = TK[k].filter((x) => S.rewDone[x.id]).length;
              return <Meter key={k} label={l} value={`${d}/${TK[k].length}`} fraction={d / TK[k].length} />;
            })}
          </HudPanel>
        </div>
      </div>
    </section>
  );
}
