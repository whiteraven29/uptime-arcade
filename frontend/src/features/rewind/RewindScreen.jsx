import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { HudPanel } from '../../ui/HudPanel.jsx';
import { S, afterRewindStep, answerRewind, byId, mmss, openSession, pickOrder, sessionOn, startRewind, stateOf, ui, unpickOrder } from '../../api/localGame.js';

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

function Task({ m, t }) {
  const pick = ui.rw.pick;
  return (
    <>
      <p className="label">{t.kicker}</p>
      {t.brief && <p className="small">{t.brief}</p>}
      <h2 className="title" style={{ fontSize: 24, textTransform: 'none', letterSpacing: 0 }}>{t.q}</h2>
      {t.show && <pre>{t.show}</pre>}
      {t.type === 'mc' && t.options.map((o) => {
        const code = m.track !== 'NET' && t.kicker === 'Which one fits?';
        return <button key={o} type="button" className={`opt${code ? ' code' : ''}`} onClick={() => answerRewind(o)}>{o}</button>;
      })}
      {t.type === 'order' && (
        <>
          <p className="small">Click the lines in the right order.</p>
          <div>
            {pick.map((o, i) => <button key={o} type="button" className="tok good" onClick={() => unpickOrder(i)}>{i + 1}. {o}</button>)}
          </div>
          {t.scrambled.filter((o) => !pick.includes(o)).map((o) => <button key={o} type="button" className="tok" onClick={() => pickOrder(o)}>{o}</button>)}
        </>
      )}
      {(t.type === 'fill' || t.type === 'memory') && (
        <>
          {t.type === 'memory' && <p className="small">Starts with: {t.start}</p>}
          <FreeAnswer task={t} />
        </>
      )}
    </>
  );
}

export function RewindScreen() {
  const { slug } = useParams();
  const m = byId(slug);
  const st = m ? stateOf(m) : null;
  if (!m) return <Navigate to="/missions" replace />;
  // Finishing a rewind lands here for a moment while the route change is still in flight.
  // Showing the finished state avoids a blank flash between the last task and the Missions screen.
  if (st === 'clear') {
    return (
      <section className="screen" aria-label="Rewind">
        <Navigate to="/missions" replace />
        <div className="narrow">
          <HudPanel label={`Rewind: ${m.title}`}>
            <div className="pips">{[0, 1, 2, 3, 4].map((i) => <i key={i} className="on" />)}</div>
            <h2 className="title good" style={{ fontSize: 26 }}>Rewind cleared</h2>
          </HudPanel>
        </div>
      </section>
    );
  }
  if (st !== 'rewind') return <Navigate to={`/missions/${m.id}`} replace />;
  startRewind(m.id);
  const state = S.rew[m.id];
  const fb = ui.rw.fb;
  const canOpen = S.bank > 0 && !S.focus && !S.claim;
  return (
    <section className="screen" aria-label="Rewind">
      <div className="narrow">
        <HudPanel label={`Rewind: ${m.title}`}>
          <div className="pips" role="img" aria-label={`${state.ok} of 5 correct`}>
            {[0, 1, 2, 3, 4].map((i) => <i key={i} className={i < state.ok ? 'on' : ''} />)}
          </div>
          {fb ? (
            <>
              <h2 className={`title ${fb.ok ? 'good' : 'bad'}`} style={{ fontSize: 26 }}>{fb.ok ? `Correct. +${fb.x} XP` : 'Not quite'}</h2>
              {!fb.ok && (
                <>
                  <p>The answer was:</p>
                  <pre>{fb.answer}</pre>
                  <p className="small">This task comes back at the end, so you can get it right.</p>
                </>
              )}
              <button className="btn go" type="button" id="rwNext" autoFocus onClick={afterRewindStep}>{state.q.length ? 'Next task' : 'Finish rewind'}</button>
            </>
          ) : !sessionOn() ? (
            <>
              <p>Rewind needs an open session.</p>
              <div className="row">
                {canOpen && <button className="btn go" type="button" onClick={openSession}>Open session ({mmss(S.bank)})</button>}
                <Link className="btn" to="/focus">Go to Focus</Link>
              </div>
            </>
          ) : (
            <Task m={m} t={ui.rw.tasks[state.q[0]]} />
          )}
        </HudPanel>
      </div>
    </section>
  );
}
