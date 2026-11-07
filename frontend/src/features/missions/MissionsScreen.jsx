import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BadgeEmblem } from '../../ui/BadgeEmblem.jsx';
import { MissionNode } from '../../ui/MissionNode.jsx';
import { BEYOND, CHAPTERS, COMING, DIFFICULTIES, S, TK, TRACKS, TRACK_LOCKS, bump, byId, clearedIn, difficultyLabel, missionPath, stateOf, toast, ui } from '../../api/game.js';

import { LabProgressMap } from './LabProgressMap.jsx';

const EMBLEM = { SH: 'tSH', VI: 'tVI', PY: 'tPY', GO: 'tGO', NET: 'tNET', LAB: 'tLAB', OPS: 'tOPS', BX: 'bx5' };
const CYCLE_MS = 2800;

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/* What's inside a category, one chapter at a time. It stops when you hover or focus on the card, and
   under reduced motion it just lists them. */
function ChapterCycle({ chapters, paused, delay }) {
  const [i, setI] = useState(0);
  const still = reducedMotion();
  useEffect(() => {
    if (still || paused || chapters.length < 2) return undefined;
    let timer;
    const start = setTimeout(() => {
      timer = setInterval(() => setI((n) => (n + 1) % chapters.length), CYCLE_MS);
    }, delay);
    return () => {
      clearTimeout(start);
      clearInterval(timer);
    };
  }, [still, paused, chapters.length, delay]);
  if (still) return <span className="cycle-static">{chapters.map((c) => c.name).join(' \u00b7 ')}</span>;
  const c = chapters[i];
  return (
    <span className="cycle" aria-hidden="true">
      <span key={c.name} className="cycle-item"><b>{c.name}</b> {c.count} mission{c.count === 1 ? '' : 's'}</span>
    </span>
  );
}

function chaptersOf(code) {
  const list = TK[code];
  return CHAPTERS[code].map(([name, start], i) => {
    const end = CHAPTERS[code][i + 1] ? CHAPTERS[code][i + 1][1] : list.length;
    const missions = list.slice(start, end);
    return { name, missions, count: missions.length, done: missions.filter((m) => m.state === 'cleared').length };
  });
}
const nextIn = (code) => TK[code].find((m) => stateOf(m) === 'rewind') || TK[code].find((m) => stateOf(m) === 'open');

function ChapterRow({ code, chapter, startOpen }) {
  const [open, setOpen] = useState(startOpen);
  const navigate = useNavigate();
  const levels = [...new Set(chapter.missions.map((m) => m.difficulty))];
  return (
    <div className={`chapter${open ? ' open' : ''}`}>
      <button type="button" className="chapter-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="chevron" aria-hidden="true" />
        <span className="chapter-name">{chapter.name}</span>
        <span className="chapter-levels">{levels.map((d) => <i key={d} className={`diff-dot diff-${d}`} title={difficultyLabel(d)} />)}</span>
        <span className="chapter-count">{chapter.done}/{chapter.count}</span>
      </button>
      {open && (
        <div className="chapter-body">
          {chapter.missions.map((m) => {
            const st = stateOf(m);
            return (
              <MissionNode
                key={m.id}
                id={m.id}
                state={st}
                title={m.title}
                flash={ui.flash === m.id}
                difficulty={m.difficulty}
                difficultyLabel={difficultyLabel(m.difficulty)}
                sub={st === 'rewind' ? `Questions ${m.answered}/5` : st === 'locked' && m.lockedBecause ? m.lockedBecause : null}
                onClick={() => (st === 'locked' ? toast(TRACK_LOCKS[code] || m.lockedBecause || 'Clear the mission before this one first') : navigate(missionPath(m)))}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function TrackCard({ code, name, sub, index }) {
  const navigate = useNavigate();
  const list = TK[code];
  const chapters = chaptersOf(code);
  const done = clearedIn(code);
  const open = ui.openTrack === code;
  const lock = TRACK_LOCKS[code];
  const next = nextIn(code);
  const nextChapter = next?.chapter ?? chapters[0]?.name;
  const [hover, setHover] = useState(false);
  const card = useRef(null);
  const counts = DIFFICULTIES.map((d) => [d, list.filter((m) => m.difficulty === d.code).length]).filter(([, n]) => n);

  useEffect(() => {
    if (open) card.current?.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
  }, [open]);

  return (
    <article ref={card} data-track={code} className={`tcard${open ? ' open' : ''}${lock ? ' locked' : ''}`} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <button
        type="button"
        className="tcard-head"
        aria-expanded={open}
        onClick={() => {
          ui.openTrack = open ? null : code;
          bump();
        }}
      >
        <BadgeEmblem id={EMBLEM[code]} />
        <span className="tcard-text">
          <span className="tcard-title"><b className="metal">{name}</b><span className="tcard-count">{done}/{list.length}</span></span>
          <span className="small">{sub}</span>
          <span className="meter"><i style={{ width: `${(done / list.length) * 100}%` }} /></span>
          <ChapterCycle chapters={chapters} paused={hover || open} delay={index * 420} />
          <span className="tcard-levels">
            {counts.map(([d, n]) => <span key={d.code}><i className={`diff-dot diff-${d.code}`} />{n} {d.label}</span>)}
          </span>
        </span>
        <span className="chevron big" aria-hidden="true" />
      </button>
      {lock ? (
        <p className="tcard-lock">{lock}</p>
      ) : next ? (
        <Link className="btn go tcard-go" to={missionPath(next)}>{stateOf(next) === 'rewind' ? 'Finish the questions' : 'Continue'}: {next.title}</Link>
      ) : (
        <p className="tcard-lock good">Path cleared. Open it to replay any mission, free.</p>
      )}
      {code === 'LAB' && (byId('lab-05')?.state === 'cleared'
        ? <Link className="btn tcard-go" id="openSandbox" to="/sandbox">Open the sandbox: build your own network, free</Link>
        : <p className="tcard-lock" id="sandboxLocked">The free sandbox opens after Make it stick (LAB-05).</p>)}
      {open && (
        <div className="tcard-body">
          {code === 'LAB' && <LabProgressMap chapters={chapters} onOpen={navigate} />}
          {chapters.map((c) => <ChapterRow key={c.name} code={code} chapter={c} startOpen={c.name === nextChapter} />)}
        </div>
      )}
    </article>
  );
}

/* A track on the way. Its gate already works, so it opens for whoever has earned it the day it arrives. */
function ComingCard({ track }) {
  const needed = track.requires && byId(track.requires);
  const ready = !track.lockedBecause;
  const list = needed ? TK[needed.track] : [];
  const done = needed ? list.slice(0, needed.pos + 1).filter((m) => m.state === 'cleared').length : 0;
  const total = needed ? needed.pos + 1 : 1;
  return (
    <article data-track={track.code} className="tcard coming">
      <div className="tcard-head">
        <BadgeEmblem id="tNET" />
        <span className="tcard-text">
          <span className="tcard-title"><b className="metal">{track.name}</b><span className="tcard-count">Arrives later</span></span>
          <span className="small">{track.subtitle}</span>
          {needed && <span className="meter"><i style={{ width: `${(done / total) * 100}%` }} /></span>}
        </span>
      </div>
      <p className={`tcard-lock${ready ? ' good' : ''}`}>{ready ? "You're ready. It opens as soon as it arrives." : `${track.lockedBecause} ${done} of ${total} done.`}</p>
    </article>
  );
}

export function MissionsScreen() {
  return (
    <section className="screen missions" aria-label="Missions">
      <header className="missions-head">
        <p className="tile-label">Season {S.season}</p>
        <div className="diff-legend" aria-label="Difficulty levels">
          {DIFFICULTIES.map((d) => <span key={d.code}><i className={`diff-dot diff-${d.code}`} />{d.label}</span>)}
        </div>
      </header>
      <div className="tracks">
        {[...TRACKS, BEYOND].map(([k, l, sub], i) => <TrackCard key={k} code={k} name={l} sub={sub} index={i} />)}
        {COMING.map((t) => <ComingCard key={t.code} track={t} />)}
      </div>
    </section>
  );
}
