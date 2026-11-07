import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { HudPanel } from '../../ui/HudPanel.jsx';
import { DifficultyTag } from '../../ui/DifficultyTag.jsx';
import { S, afterRewindStep, answerRewind, byId, mmss, openSession, pickOrder, rewindHelp, sessionOn, startRewind, stateOf, ui, unpickOrder } from '../../api/game.js';

function FreeAnswer({ task }) {
  const [value, setValue] = useState('');
  const ref = useRef(null);
  useEffect(() => {
    setValue('');
    ref.current?.focus();
  }, [task]);
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) answerRewind(value);
      }}
    >
      <input id="rwInput" ref={ref} type="text" aria-label="Your answer" autoComplete="off" spellCheck="false" style={{ fontFamily: 'var(--font-mono)' }} value={value} onChange={(e) => setValue(e.target.value)} />
      <button className="btn go" type="submit">Check</button>
    </form>
  );
}

function Help() {
  const { hint, answer } = rewindHelp();
  if (!hint && !answer) return null;
  return (
    <div className="rw-help">
      {hint && <p><b>Hint:</b> {hint}</p>}
      {answer && (
        <>
          <p><b>The answer is:</b></p>
          <pre>{answer}</pre>
          <p className="small">Now you've seen it, answer it to move on.</p>
        </>
      )}
    </div>
  );
}

function Task({ t }) {
  const pick = ui.rw.pick;
  return (
    <>
      <div className="rw-head">
        <p className="label">{t.label}</p>
        <DifficultyTag code={t.level} />
      </div>
      {t.context && <p className="small">The mission was: {t.context}</p>}
      <h2 className="title" style={{ fontSize: 24, textTransform: 'none', letterSpacing: 0 }}>{t.q}</h2>
      {t.show && <pre>{t.show}</pre>}
      <Help />
      {t.type === 'mc' && t.options.map((o) => (
        <button key={o} type="button" className={`opt${t.code ? ' code' : ''}`} onClick={() => answerRewind(o)}>{o}</button>
      ))}
      {t.type === 'order' && (
        <>
          <div>
            {pick.map((o, i) => <button key={o} type="button" className="tok good" onClick={() => unpickOrder(i)}>{i + 1}. {o}</button>)}
          </div>
          {t.scrambled.filter((o) => !pick.includes(o)).map((o) => <button key={o} type="button" className="tok" onClick={() => pickOrder(o)}>{o}</button>)}
        </>
      )}
      {t.type === 'text' && <FreeAnswer task={t} />}
    </>
  );
}

export function RewindScreen() {
  const { slug } = useParams();
  const m = byId(slug);
  const st = m ? stateOf(m) : null;
  useEffect(() => {
    if (m && st === 'rewind') startRewind(m.id);
  }, [m, st]);
  if (!m) return <Navigate to="/missions" replace />;
  if (st !== 'rewind') return <Navigate to={st === 'clear' ? '/missions' : `/missions/${m.id}`} replace />;
  const rw = ui.rw;
  const canOpen = S.bank > 0 && !S.focus && !S.claim;
  const total = rw.total;
  return (
    <section className="screen" aria-label="Rewind">
      <div className="narrow">
        <HudPanel label={`Questions on: ${m.title}`}>
          <p className="small">Answer all {total} to earn {rw.xpOnClear || m.xp} XP and unlock the next mission. A wrong answer costs nothing and comes back later.</p>
          <div className="pips" role="img" aria-label={`${rw.correct} of ${total} correct`}>
            {Array.from({ length: total }, (_, i) => <i key={i} className={i < rw.correct ? 'on' : ''} />)}
          </div>
          {rw.fb ? (
            <>
              <h2 className={`title ${rw.fb.ok ? 'good' : 'bad'}`} style={{ fontSize: 26 }}>{rw.fb.ok ? 'Correct' : 'Not quite'}</h2>
              {!rw.fb.ok && <p className="small">{rw.fb.hintNext ? 'Try again. You get a hint this time.' : 'No problem. This one comes back after the others, with a hint if you still need it.'}</p>}
              <button className="btn go" type="button" id="rwNext" autoFocus onClick={afterRewindStep}>{rw.nextState?.state === 'cleared' ? 'Finish' : 'Next question'}</button>
            </>
          ) : !sessionOn() ? (
            <>
              <p>These questions need an open session.</p>
              <div className="row">
                {canOpen && <button className="btn go" type="button" onClick={openSession}>Open session ({mmss(S.bank)})</button>}
                <Link className="btn" to="/focus">Go to Focus</Link>
              </div>
            </>
          ) : rw.task && rw.id === m.id ? (
            <Task t={rw.task} />
          ) : (
            <p className="small">Loading...</p>
          )}
        </HudPanel>
      </div>
    </section>
  );
}
