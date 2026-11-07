import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { HudPanel } from '../../ui/HudPanel.jsx';
import { HINT_COST, S, VI, leaveMission, mmss, openSession, runCommand, sessionOn, showHint, trackName, ui } from '../../api/localGame.js';
import { TerminalWorkspace } from './workspaces/terminal/TerminalWorkspace.jsx';
import { ViWorkspace } from './workspaces/vi/ViWorkspace.jsx';
import { PythonWorkspace, ensurePython } from './workspaces/python/PythonWorkspace.jsx';
import { GoReader } from './workspaces/go/GoReader.jsx';

function Lock() {
  const canOpen = S.bank > 0 && !S.focus && !S.claim;
  const msg = S.focus ? 'Locked while your focus block runs.' : S.claim ? 'Answer the question on the Focus screen.' : S.bank > 0 ? 'Session closed.' : 'No play time left. Finish a focus block to earn more.';
  return (
    <div className="lock">
      <span>{msg}</span>
      {canOpen && <button className="btn go" type="button" id="openSession" onClick={openSession}>Open session ({mmss(S.bank)})</button>}
      <Link className="btn" to="/focus">Go to Focus</Link>
    </div>
  );
}

function SidePanel({ t, pyFallback }) {
  return (
    <HudPanel className="side" label={t.oc ? `On-call ${S.ocShift + 1} of 5` : trackName(t.track)}>
      <h3>{t.title}</h3>
      <p>{pyFallback ? `The Python runner couldn't start, so read this code and work out what ${t.tests[0][0]} returns.` : t.brief}</p>
      {pyFallback ? <pre>{t.sol}</pre> : t.code && t.track !== 'GO' ? <pre>{t.code}</pre> : null}
      <p className="obj">{pyFallback ? 'Run: submit <the value, written as Python>' : t.goal}</p>
      {Array.from({ length: S.hints[t.id] || 0 }, (_, i) => <p key={i} className="hint-line">Hint {i + 1}: {t.hints[i]}</p>)}
      {t.learn && (
        <>
          <p className="label">Lesson</p>
          <p className="small">{t.learn[0]}</p>
          <pre>{t.learn[1]}</pre>
        </>
      )}
      <div className="row">
        <button className="btn" type="button" disabled={!sessionOn()} onClick={showHint}>Hint (-{HINT_COST} XP)</button>
        <button className="btn" type="button" disabled={!sessionOn()} onClick={() => runCommand('help')}>Help</button>
        {!t.oc && <button className="btn" type="button" onClick={leaveMission}>Leave</button>}
      </div>
    </HudPanel>
  );
}

/* Shared by mission Play and On-call: the mission panel beside the right workspace. */
export function PlayArea({ t }) {
  const on = sessionOn();
  const isPy = t.kind === 'py';
  useEffect(() => {
    if (isPy) ensurePython();
  }, [isPy]);
  const pyFallback = isPy && ui.py.state === 'failed';
  const workspace = isPy && !pyFallback ? 'python' : t.track === 'GO' && t.code ? 'go' : 'terminal';
  return (
    <div className="play">
      <SidePanel t={t} pyFallback={pyFallback} />
      <HudPanel className="work">
        <div className="work-bar"><span>{workspace === 'python' ? 'Python' : workspace === 'go' ? 'Go reader' : 'Terminal'}</span><b>wr-dev01</b></div>
        {workspace === 'python' && <PythonWorkspace mission={t} />}
        {workspace === 'go' && <GoReader code={t.code} />}
        {workspace === 'terminal' && <TerminalWorkspace />}
        {!on && <Lock />}
        {VI.on && <ViWorkspace />}
      </HudPanel>
    </div>
  );
}
