import { Link, useNavigate } from 'react-router-dom';
import { CoreRing } from '../../ui/CoreRing.jsx';
import { OperatorFigure } from '../../ui/OperatorFigure.jsx';
import { BadgeEmblem } from '../../ui/BadgeEmblem.jsx';
import { Meter } from '../../ui/Meter.jsx';
import { PlayIcon, TimerIcon } from '../../ui/icons.jsx';
import { pad } from '../../../../engines/fs/index.js';
import { BADGES, BEYOND, EARN, LEVELS, S, STREAKS, TK, TRACKS, beyondOpen, cleared, clearedIn, level, levelIdx, missionPath, mmss, mult, nextUp, sessionOn, stateOf, trackName, ui } from '../../api/game.js';

function nextAction() {
  if (S.focus) return { label: 'Back to Focus', to: '/focus', kicker: 'Focus block running', title: 'Stay on it', sub: 'Missions stay locked until it ends' };
  if (S.claim) return { label: 'Claim your block', to: '/focus', kicker: 'Block finished', title: 'Claim your time', sub: 'Claim the play time you earned' };
  if (S.bank <= 0 && !sessionOn()) return { label: 'Start a block', to: '/focus', kicker: 'No play time', title: 'Earn some', sub: 'Finish a focus block to play' };
  const m = nextUp();
  if (!m) return { label: 'View rewards', to: '/rewards', kicker: 'All clear', title: 'Every mission cleared', sub: 'New missions arrive with the next season' };
  const rewind = stateOf(m) === 'rewind';
  return { label: rewind ? 'Continue the questions' : 'Open briefing', to: missionPath(m), kicker: rewind ? 'Questions waiting' : 'Next mission', title: m.title, sub: `${trackName(m.track)}, mission ${m.pos + 1}. Worth ${m.xp} XP` };
}

/* A labelled tile, wired to the core by a short line. */
function Tile({ label, children, to, hot }) {
  const body = (
    <>
      <p className={`tile-label${hot ? ' hot' : ''}`}>{label}</p>
      <div className="tile-body">{children}</div>
    </>
  );
  return <div className="tile-wrap">{to ? <Link className="tile link" to={to}>{body}</Link> : <div className="tile">{body}</div>}</div>;
}

const EMBLEM = { SH: 'tSH', VI: 'tVI', PY: 'tPY', GO: 'tGO', NET: 'tNET', LAB: 'tLAB', OPS: 'tOPS', BX: 'bx5' };

function PathRow({ code, name, sub, locked }) {
  const total = TK[code].length;
  const done = clearedIn(code);
  return (
    <Link className={`path${locked ? ' locked' : ''}`} to="/missions" onClick={() => { ui.openTrack = code; }}>
      <BadgeEmblem id={EMBLEM[code]} />
      <span className="path-text">
        <b>{name}</b>
        <span className="small">{locked ? 'Reach Archmage to open' : sub}</span>
        <Meter value={`${done}/${total}`} fraction={done / total} />
      </span>
    </Link>
  );
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
  const running = sessionOn();
  const earned = BADGES.filter((b) => S.badges?.[b[0]]);
  // The latest ones earned, then what's next, so there's always something to reach for.
  const medals = [...earned.slice(-2), ...BADGES.filter((b) => !S.badges?.[b[0]])].slice(0, 4);

  return (
    <section className="screen flush" aria-label="Deck">
      <div className="deck">
        <div className="deck-left">
          <Tile label="Earn play time" to="/focus" hot>
            <span className="tile-row">
              <span className="card-icon"><TimerIcon /></span>
              <span className="small">{S.len} min earns {EARN[S.len]}:00 of play</span>
            </span>
          </Tile>
          <Tile label="Day streak">
            <span className="tile-stat"><b className="num amber">{S.streak}</b><span className="small">{nx ? `Next reward at ${nx[0]} days. ` : ''}XP +{Math.round((mult() - 1) * 100)}%. Shields {S.shields}.</span></span>
          </Tile>
          <Tile label="Today">
            <span className="tile-stat"><b className="num">{S.todayMin}m</b><span className="small">{S.todayDrifts} drifts logged</span></span>
          </Tile>
          <Tile label="Lifetime focus">
            <span className="tile-stat"><b className="num">{Math.floor(S.focusMin / 60)}h {pad(S.focusMin % 60)}m</b><span className="small">{S.blocks} block{S.blocks === 1 ? '' : 's'} finished</span></span>
          </Tile>
        </div>

        <div className="deck-hero">
          <div className="plaque">
            <span>Season {S.season}</span>
            <strong className="metal">Whiteraven operations</strong>
          </div>
          <CoreRing level={`Level ${i + 1}`} title={level()} sub={LEVELS[i + 1] ? `${hi - c} missions to ${LEVELS[i + 1][1]}` : 'Top of the order'} progress={progress}>
            <div className="core-clock">
              <span>{running ? 'Session left' : 'Play time banked'}</span>
              <b>{running ? mmss((S.sessionEndsAt - Date.now()) / 1000) : mmss(S.bank)}</b>
            </div>
          </CoreRing>
          <OperatorFigure />
        </div>

        <div className="deck-right">
          <p className="tile-label roster-label">Skill paths</p>
          <div className="roster">
            {TRACKS.map(([k, l, sub]) => <PathRow key={k} code={k} name={l} sub={sub} />)}
            <PathRow code={BEYOND[0]} name={BEYOND[1]} sub={BEYOND[2]} locked={!beyondOpen()} />
          </div>
        </div>

        <div className="deck-strip">
          <div className="strip-main">
            <span className="strip-icon"><PlayIcon /></span>
            <span>
              <span className="strip-kicker">{action.kicker}</span>
              <span className="strip-title">{action.title}</span>
              <span className="small">{action.sub}</span>
            </span>
            <button className="btn go" type="button" onClick={() => navigate(action.to)}><PlayIcon /> {action.label}</button>
          </div>
          <div className="strip-mid">
            <span className="strip-kicker gold">Level progress</span>
            <span className="strip-big">{Math.round(progress * 100)}%</span>
            <span className="tagline">Real work earns play. Play teaches skills.</span>
          </div>
          <Link className="strip-medals" to="/rewards" aria-label={`Badges: ${earned.length} of ${BADGES.length}. Open rewards`}>
            <span className="strip-kicker gold">Badges {earned.length}/{BADGES.length}</span>
            <span className="medals">
              {medals.map((b) => (
                <span key={b[0]} className={`medal${S.badges?.[b[0]] ? ' got' : ''}`} title={b[1]}>
                  <BadgeEmblem id={b[0]} />
                  <small>{b[1]}</small>
                </span>
              ))}
            </span>
          </Link>
        </div>
      </div>
    </section>
  );
}
