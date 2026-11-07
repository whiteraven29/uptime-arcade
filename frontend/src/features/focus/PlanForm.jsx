import { useState } from 'react';
import { HudPanel } from '../../ui/HudPanel.jsx';
import { savePlan, ui } from '../../api/game.js';

const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const LENGTHS = [15, 25, 45];
const START = { days: [0, 1, 2, 3, 4], blocks_per_day: 2, block_minutes: 25, windows: [{ start: '18:00', end: '20:00' }] };

/* Every rule here is the server's, and what it refuses it explains. This only collects what you intend. */
export function PlanForm({ onDone }) {
  const { plan, pending, limits } = ui.plan;
  const from = pending || plan || START;
  const [days, setDays] = useState(from.days);
  const [blocks, setBlocks] = useState(from.blocks_per_day);
  const [minutes, setMinutes] = useState(from.block_minutes);
  const [windows, setWindows] = useState(from.windows.map((w) => ({ ...w })));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const toggleDay = (d) => setDays(days.includes(d) ? days.filter((x) => x !== d) : [...days, d]);
  const setWindow = (i, field, value) => setWindows(windows.map((w, n) => (n === i ? { ...w, [field]: value } : w)));
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await savePlan({ days, blocks_per_day: blocks, block_minutes: minutes, windows });
      onDone?.();
    } catch (x) {
      setError(x.message);
    }
    setBusy(false);
  };

  return (
    <HudPanel as="form" id="planForm" className="focus-card stack" label={plan ? 'Change your study plan' : 'Your study plan'} onSubmit={save}>
      <h1 className="title metal">{plan ? 'A new plan starts tomorrow' : 'When will you study?'}</h1>
      <p className="small" style={{ margin: 0 }}>
        Blocks earn play time when you keep this plan, so set one you can really keep.
        {plan ? ` You can change it once every ${limits.change_days} days.` : ` Once you start your first block, you can change it once every ${limits.change_days} days.`}
      </p>
      <div>
        <span className="label plan-label">Days</span>
        <div className="row" role="group" aria-label="Study days">
          {WEEK.map((name, d) => <button key={d} type="button" className="btn plan-day" aria-pressed={days.includes(d)} onClick={() => toggleDay(d)}>{name}</button>)}
        </div>
      </div>
      <div className="plan-amount">
        <div>
          <label className="label plan-label" htmlFor="planBlocks">Blocks a day</label>
          <input id="planBlocks" type="number" min={1} max={limits.max_blocks_per_day} value={blocks} onChange={(e) => setBlocks(Number(e.target.value))} />
        </div>
        <div>
          <span className="label plan-label">Each block</span>
          <div className="row" role="group" aria-label="Block length">
            {LENGTHS.map((n) => <button key={n} type="button" className="btn" aria-pressed={minutes === n} onClick={() => setMinutes(n)}>{n} min</button>)}
          </div>
        </div>
      </div>
      <p className="small" style={{ margin: 0 }} id="planTotal">That's {blocks * minutes} minutes a day.</p>
      <div className="stack">
        <span className="label plan-label">Study times, in {ui.plan.time_zone}</span>
        {windows.map((w, i) => (
          <div className="row plan-window" key={i}>
            <label className="sr-only" htmlFor={`planStart${i}`}>Study time {i + 1} starts</label>
            <input id={`planStart${i}`} type="time" required value={w.start} onChange={(e) => setWindow(i, 'start', e.target.value)} />
            <span className="small">to</span>
            <label className="sr-only" htmlFor={`planEnd${i}`}>Study time {i + 1} ends</label>
            <input id={`planEnd${i}`} type="time" required value={w.end} onChange={(e) => setWindow(i, 'end', e.target.value)} />
            {windows.length > 1 && <button type="button" className="btn" onClick={() => setWindows(windows.filter((_, n) => n !== i))}>Remove</button>}
          </div>
        ))}
        {windows.length < limits.max_windows && (
          <div><button type="button" className="btn" id="addWindow" onClick={() => setWindows([...windows, { start: '06:00', end: '07:00' }])}>Add a study time</button></div>
        )}
      </div>
      {error && <p className="small plan-error" role="alert" style={{ margin: 0 }}>{error}</p>}
      <div className="row">
        <button className="btn go" type="submit" id="savePlan" disabled={busy}>{plan ? 'Save for tomorrow' : 'Save my plan'}</button>
        {onDone && <button className="btn" type="button" onClick={onDone}>Keep my plan</button>}
      </div>
    </HudPanel>
  );
}
