import { useState } from 'react';
import { Terminal } from '../../../../ui/Terminal.jsx';
import { LabMap, Legend, TraceStepper, useSteps } from './LabMap.jsx';
import { T, canPlay, labCheck, labClear, labComplete, labPlug, labReset, labRevealDrill, labRun, labSelect, labStartDrill, labUnplug, labView, ui } from '../../../../api/game.js';

function Goals() {
  const lab = ui.lab;
  const results = lab.results;
  const passing = results ? results.filter((r) => r.ok).length : 0;
  return (
    <>
    <div className="lab-progress" id="labProgress" role="meter" aria-label="Goals passing" aria-valuemin={0} aria-valuemax={lab.goals.length} aria-valuenow={passing}>
      <i style={{ width: `${(passing / lab.goals.length) * 100}%` }} />
      <span>{results ? `${passing} of ${lab.goals.length} goals` : `${lab.goals.length} goals to go`}</span>
    </div>
    <ol className="lab-goals" id="labGoals" key={lab.checks}>
      {lab.goals.map((label, i) => {
        const r = results?.[i];
        const state = !r ? 'unknown' : r.ok ? 'ok' : 'bad';
        return (
          <li key={label} className={state} style={{ '--i': i }}>
            <span className="lab-mark" aria-hidden="true">{state === 'ok' ? '✓' : state === 'bad' ? '✗' : '•'}</span>
            <span>
              <span className="sr-only">{state === 'ok' ? 'Passing: ' : state === 'bad' ? 'Failing: ' : 'Not checked yet: '}</span>
              {label}
              {r && !r.ok && r.why && <small>{r.why}</small>}
            </span>
          </li>
        );
      })}
    </ol>
    </>
  );
}

export function Cables({ view }) {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [error, setError] = useState('');
  const wired = view.cables.filter((c) => !c.wifi);
  const used = new Set(wired.flatMap((c) => [`${c.a}|${c.pa}`, `${c.b}|${c.pb}`]));
  const ports = view.devices.flatMap((d) => d.ports.map((p) => `${d.name}|${p}`)).filter((k) => !used.has(k));
  const connect = () => {
    const [da, pa] = a.split('|');
    const [db, pb] = b.split('|');
    setError(labPlug(da, pa, db, pb));
    setA('');
    setB('');
  };
  return (
    <div className="lab-cables" id="labCables">
      <p className="label">Cables</p>
      <p className="small">Drag on the map, or choose both ends here.</p>
      <div className="row">
        <label className="sr-only" htmlFor="cableA">One end</label>
        <select id="cableA" value={a} onChange={(e) => setA(e.target.value)}>
          <option value="">One end</option>
          {ports.map((k) => <option key={k} value={k}>{k.replace('|', ' ')}</option>)}
        </select>
        <label className="sr-only" htmlFor="cableB">Other end</label>
        <select id="cableB" value={b} onChange={(e) => setB(e.target.value)}>
          <option value="">Other end</option>
          {ports.filter((k) => k !== a).map((k) => <option key={k} value={k}>{k.replace('|', ' ')}</option>)}
        </select>
        <button className="btn" type="button" id="cableConnect" disabled={!a || !b} onClick={connect}>Connect</button>
      </div>
      {error && <p className="small plan-error" role="alert">{error}</p>}
      {wired.map((c) => (
        <div className="row lab-cable-row" key={`${c.a}${c.pa}`}>
          <span className="small">{c.a} {c.pa} to {c.b} {c.pb}</span>
          <button className="btn" type="button" onClick={() => labUnplug(c.a, c.pa)}>Unplug</button>
        </div>
      ))}
    </div>
  );
}

/* On a lab you've cleared: break it and fix it again, for free, as often as you like. */
function Drill() {
  const { drill } = ui.lab;
  return (
    <div className="lab-drill" id="labDrill">
      <p className="label">Fault drill</p>
      {!drill && <p className="small">Start from the finished lab with something broken, and find it. It costs nothing and earns nothing.</p>}
      {drill && (
        <p className="small" role="status" id="drillStatus">
          {drill.fixed ? 'Fixed. Every goal passes again.' : `${drill.count === 1 ? 'Something has' : `${drill.count} things have`} been broken. Find ${drill.count === 1 ? 'it' : 'them'} and make every goal pass.`}
        </p>
      )}
      {drill?.faults && (
        <ul className="lab-drill-list" id="drillFaults">
          {drill.faults.map((f) => <li key={f.explain}>{f.explain}</li>)}
        </ul>
      )}
      <div className="row">
        <button className="btn" type="button" id="drillOne" onClick={() => labStartDrill(1)}>Break one thing</button>
        <button className="btn" type="button" id="drillThree" onClick={() => labStartDrill(3)}>Break three</button>
        {drill && !drill.faults && <button className="btn" type="button" id="drillReveal" onClick={labRevealDrill}>Show what broke</button>}
      </div>
    </div>
  );
}

export function LabConsole({ lab, tabsFor }) {
  return (
    <>
      <div className="lab-tabs" role="tablist" aria-label="Device consoles">
        {tabsFor.map((d) => (
          <button key={d.name} type="button" role="tab" id={`tab-${d.name}`} aria-selected={lab.device === d.name} className={lab.device === d.name ? 'on' : ''} onClick={() => labSelect(d.name)}>{d.hostname}</button>
        ))}
      </div>
      <div className="lab-console">
        {lab.device ? (
          <Terminal
            key={lab.device}
            spans={lab.consoles[lab.device]}
            version={lab.version}
            prompt={lab.lab.promptOf(lab.device)}
            enabled={canPlay()}
            focusKey={lab.device}
            history={lab.histories[lab.device]}
            onRun={labRun}
            onComplete={labComplete}
            onClear={labClear}
            onInterrupt={() => {}}
            assist={() => ({ kind: 'idle', text: 'Enter runs. Tab completes. ? shows what fits next. Up and Down recall history. Click a device on the map to switch.' })}
            suggest={() => ''}
          />
        ) : <p className="small lab-empty">Add a device to open its console.</p>}
      </div>
    </>
  );
}

export function NetLabWorkspace() {
  const lab = ui.lab;
  const [resetting, setResetting] = useState(false);
  const walk = useSteps(lab?.trace);
  if (!lab) return <div className="code-pane" />;
  const view = labView();
  const openDevices = view.devices.filter((d) => !d.locked);
  const replay = !!T()?.revisit;
  return (
    <div className="lab">
      <div className="lab-top">
        <div className="lab-canvas">
          <LabMap view={view} selected={lab.device} walk={walk} won={lab.won} wiring={lab.cabling} onSelect={labSelect} onPlug={labPlug} onUnplug={labUnplug} />
          <Legend wifi={view.devices.some((d) => d.kind === 'ap')} wiring={lab.cabling} />
        </div>
        <div className="lab-side">
          <p className="label">Goals</p>
          <Goals />
          <div className="row">
            <button className="btn go" type="button" id="labCheck" disabled={lab.checking || !canPlay()} onClick={labCheck}>{lab.won ? 'Network up' : lab.checking ? 'Checking...' : 'Check my work'}</button>
            {resetting ? (
              <>
                <button className="btn" type="button" id="labResetYes" onClick={() => { labReset(); setResetting(false); }}>Start over</button>
                <button className="btn" type="button" onClick={() => setResetting(false)}>Keep it</button>
              </>
            ) : <button className="btn" type="button" id="labReset" disabled={!canPlay()} onClick={() => setResetting(true)}>Reset lab</button>}
          </div>
          {replay && <Drill />}
          <TraceStepper trace={lab.trace} walk={walk} />
          {lab.cabling && <Cables view={view} />}
        </div>
      </div>
      <LabConsole lab={lab} tabsFor={openDevices} />
    </div>
  );
}
