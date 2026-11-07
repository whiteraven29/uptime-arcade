import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { DeviceIcon } from '../play/workspaces/netlab/DeviceIcon.jsx';
import { Cables, LabConsole } from '../play/workspaces/netlab/NetLabWorkspace.jsx';
import { LabMap, Legend, TraceStepper, useSteps } from '../play/workspaces/netlab/LabMap.jsx';
import { S, enterSandbox, labPlug, labSelect, labUnplug, labView, leaveCurrent, sandboxAdd, sandboxBreak, sandboxMove, sandboxRemove, sandboxReset, sandboxRevealFaults, sandboxTest, ui } from '../../api/game.js';

const PALETTE = [['pc', 'PC'], ['laptop', 'Laptop'], ['server', 'Server'], ['switch', 'Switch'], ['l3switch', 'L3 switch'], ['router', 'Router'], ['firewall', 'Firewall'], ['ap', 'Access point']];

function Palette() {
  return (
    <div className="sandbox-palette" role="group" aria-label="Add a device">
      {PALETTE.map(([kind, label]) => (
        <button key={kind} type="button" className="sandbox-add" id={`add-${kind}`} onClick={() => sandboxAdd(kind)} title={`Add a ${label}`}>
          <svg viewBox="-40 -36 80 72" aria-hidden="true"><DeviceIcon kind={kind} /></svg>
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}

function Tests() {
  const lab = ui.lab;
  const results = lab.tests;
  return (
    <div className="lab-drill" id="sandboxTests">
      <p className="label">Test and break</p>
      <div className="row">
        <button className="btn go" type="button" id="testPings" onClick={sandboxTest}>Test every ping</button>
        <button className="btn" type="button" id="breakIt" onClick={sandboxBreak}>Break something</button>
        {lab.faults?.length > 0 && !lab.showFaults && <button className="btn" type="button" id="showBroken" onClick={sandboxRevealFaults}>Show what broke</button>}
      </div>
      {lab.message && <p className="small" role="status" id="sandboxMessage">{lab.message}</p>}
      {lab.showFaults && <ul className="lab-drill-list">{lab.faults.map((f) => <li key={f.explain}>{f.explain}</li>)}</ul>}
      {results && (
        <ol className="lab-goals" id="pingResults">
          {results.map((r) => (
            <li key={r.label} className={r.ok ? 'ok' : 'bad'}>
              <span className="lab-mark" aria-hidden="true">{r.ok ? '✓' : '✗'}</span>
              <span>{r.label}{!r.ok && r.why && <small>{r.why}</small>}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function SandboxScreen() {
  const [error, setError] = useState('');
  const [clearing, setClearing] = useState(false);
  const lab = ui.lab?.sandbox ? ui.lab : null;
  const walk = useSteps(lab?.trace);

  useEffect(() => {
    enterSandbox().catch((e) => setError(e.message));
    return leaveCurrent;
  }, []);

  if (S.focus || S.claim) {
    return <section className="screen" aria-label="Sandbox"><p className="lock">The sandbox waits until your focus block is over. <Link className="btn" to="/focus">Go to Focus</Link></p></section>;
  }
  if (error) {
    return <section className="screen" aria-label="Sandbox"><p className="lock" role="alert">{error} <Link className="btn" to="/missions">Back to missions</Link></p></section>;
  }
  if (!lab) return <section className="screen" aria-label="Sandbox"><p className="splash">Loading...</p></section>;

  const view = labView();
  return (
    <section className="screen flush" aria-label="Sandbox">
      <div className="sandbox">
        <div className="work-bar">
          <span className="work-title"><i className="led on" aria-hidden="true" />Sandbox</span>
          <span className="work-stats"><span>Free to use, and earns nothing</span></span>
        </div>
        <Palette />
        <div className="lab">
          <div className="lab-top">
            <div className="lab-canvas">
              {view.devices.length ? <LabMap view={view} selected={lab.device} walk={walk} wiring onSelect={labSelect} onMove={sandboxMove} onPlug={labPlug} onUnplug={labUnplug} /> : <p className="lab-empty small">Your network is empty. Add a device from the row above, then drag it where you want it.</p>}
              <Legend wifi wiring />
            </div>
            <div className="lab-side">
              <Tests />
              <TraceStepper trace={lab.trace} walk={walk} />
              <Cables view={view} />
              <div className="row">
                {lab.device && <button className="btn" type="button" id="removeDevice" onClick={() => sandboxRemove(lab.device)}>Remove {lab.device}</button>}
                {clearing ? (
                  <>
                    <button className="btn" type="button" id="clearYes" onClick={() => { sandboxReset(); setClearing(false); }}>Clear it all</button>
                    <button className="btn" type="button" onClick={() => setClearing(false)}>Keep it</button>
                  </>
                ) : <button className="btn" type="button" id="clearAll" onClick={() => setClearing(true)}>Clear everything</button>}
              </div>
            </div>
          </div>
          <LabConsole lab={lab} tabsFor={view.devices} />
        </div>
      </div>
    </section>
  );
}
