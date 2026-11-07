import { useRef, useState } from 'react';
import { HudPanel } from '../../ui/HudPanel.jsx';
import { S, TICKETS, closeSession, exportSave, importSave, newSeason, toggleMute } from '../../api/localGame.js';

export function SystemScreen() {
  const [msg, setMsg] = useState('');
  const [confirming, setConfirming] = useState(false);
  const file = useRef(null);

  const backUp = () => {
    const { filename, data } = exportSave();
    try {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setMsg('Saved as ' + filename);
    } catch {
      setMsg("Backup didn't finish. Try again.");
    }
  };
  const load = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      importSave(await f.text());
      setMsg('Save loaded.');
    } catch {
      setMsg("That file isn't an Uptime Arcade save.");
    }
    e.target.value = '';
  };

  return (
    <section className="screen" aria-label="System">
      <div className="grid2">
        <HudPanel className="stack" label="Your save">
          <p style={{ margin: 0 }}>Progress saves automatically in this browser. Back it up before you reinstall or change PC.</p>
          <div className="row">
            <button className="btn" type="button" onClick={backUp}>Back up save</button>
            <button className="btn" type="button" onClick={() => file.current.click()}>Load save</button>
            <input ref={file} type="file" accept=".json,application/json" hidden aria-label="Save file" onChange={load} />
          </div>
          <div className="small" role="status">{msg}</div>
        </HudPanel>
        <HudPanel className="stack" label="Sound">
          <p style={{ margin: 0 }} className="small">Chimes for the timer, unlocks and level-ups.</p>
          <div className="row"><button className="btn" type="button" aria-pressed={!S.muted} onClick={toggleMute}>{S.muted ? 'Sound off' : 'Sound on'}</button></div>
        </HudPanel>
        <HudPanel className="stack" label="Session">
          <div className="row"><button className="btn" type="button" onClick={() => closeSession()}>Close session and bank time</button></div>
          <p className="label" style={{ margin: '6px 0 0' }}>New season</p>
          <p style={{ margin: 0 }} className="small">Replay all {TICKETS.length} missions. Your level, XP, streak and badges stay.</p>
          <div className="row">
            <button className="btn" type="button" onClick={() => setConfirming(true)}>Start new season</button>
            {confirming && (
              <>
                <button className="btn warn" type="button" onClick={() => { setConfirming(false); newSeason(); }}>Yes, start it</button>
                <button className="btn" type="button" onClick={() => setConfirming(false)}>Cancel</button>
              </>
            )}
          </div>
        </HudPanel>
        <HudPanel label="About">
          <p style={{ margin: 0 }} className="small">Whiteraven is a fictional company. The terminal is simulated and stays on your PC.</p>
        </HudPanel>
      </div>
    </section>
  );
}
