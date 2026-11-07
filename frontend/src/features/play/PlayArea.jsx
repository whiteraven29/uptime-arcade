import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { HudPanel } from '../../ui/HudPanel.jsx';
import { HINT_COST, S, VI, canPlay, labRun, leaveMission, mmss, openSession, runCommand, sessionOn, showHint, trackName } from '../../api/game.js';
import { TerminalWorkspace } from './workspaces/terminal/TerminalWorkspace.jsx';
import { ViWorkspace } from './workspaces/vi/ViWorkspace.jsx';
import { PythonWorkspace, ensurePython } from './workspaces/python/PythonWorkspace.jsx';
import { GoReader } from './workspaces/go/GoReader.jsx';
import { NetLabWorkspace } from './workspaces/netlab/NetLabWorkspace.jsx';
import { DifficultyTag } from '../../ui/DifficultyTag.jsx';

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

function SidePanel({ t }) {
  return (
    <HudPanel className="side" label={trackName(t.track)}>
      <h3>{t.title}</h3>
      {t.difficulty && <DifficultyTag code={t.difficulty} />}
      {t.revisit && <p className="revisit-note">A free replay. It uses no play time, hints are free, and it pays no XP.</p>}
      <p>{t.brief}</p>
      <p className="obj">{t.goal}</p>
      {t.hintsShown.map((h, i) => <p key={h} className="hint-line">Hint {i + 1}: {h}</p>)}
      <p className="label">Lesson</p>
      <p className="small">{t.learn[0]}</p>
      <pre>{t.learn[1]}</pre>
      <div className="row">
        {!t.revisit && <button className="btn" type="button" disabled={!sessionOn()} onClick={showHint}>Hint (-{HINT_COST} XP)</button>}
        <button className="btn" type="button" disabled={!canPlay()} onClick={() => (t.kind === 'net' ? labRun('help') : runCommand('help'))}>Help</button>
        <button className="btn" type="button" onClick={leaveMission}>Leave</button>
      </div>
    </HudPanel>
  );
}

/* The mission panel beside the right workspace. */
export function PlayArea({ t }) {
  const on = canPlay();
  const isPy = t.kind === 'py';
  useEffect(() => {
    if (isPy) ensurePython();
  }, [isPy]);
  const workspace = isPy ? 'python' : t.kind === 'net' ? 'netlab' : t.program ? 'go' : 'terminal';
  return (
    <div className="play">
      <SidePanel t={t} />
      <HudPanel className="work">
        <div className="work-bar">
          <span className="work-title"><i className={`led${on ? ' on' : ''}`} aria-hidden="true" />{workspace === 'python' ? 'Python' : workspace === 'netlab' ? 'NetLab' : workspace === 'go' ? 'Go reader' : 'Terminal'}</span>
          <span className="work-stats">
            {t.par_kind === 'commands' && <span>Commands <b>{S.cmds?.[t.id] || 0}</b> / par {t.par_value}</span>}
            {t.par_kind === 'keys' && <span>Keys par <b>{t.par_value}</b></span>}
            {sessionOn() && <span>Session <b>{mmss((S.sessionEndsAt - Date.now()) / 1000)}</b></span>}
            {on && !sessionOn() && <span>Free replay</span>}
          </span>
        </div>
        {workspace === 'python' && (t.ready ? <PythonWorkspace mission={t} /> : <div className="code-pane" />)}
        {workspace === 'go' && (t.ready ? <GoReader code={t.program} /> : <TerminalWorkspace />)}
        {workspace === 'terminal' && <TerminalWorkspace />}
        {workspace === 'netlab' && <NetLabWorkspace />}
        {!on && <Lock />}
        {VI.on && <ViWorkspace />}
      </HudPanel>
    </div>
  );
}
