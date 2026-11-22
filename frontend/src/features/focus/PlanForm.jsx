import { useState } from 'react';
import { HudPanel } from '../../ui/HudPanel.jsx';
import { savePlan, ui } from '../../api/game.js';

const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
// 04:00 to 06:00 with 30 minutes of rest in two breaks: 45 study, 15 play, 45 study, 15 play.
const FIRST = { start: '04:00', end: '06:00', breaks: 2, rest_minutes: 15 };
const ANOTHER = { start: '21:00', end: '23:00', breaks: 2, rest_minutes: 15 };

const toMinutes = (t) => (/^\d\d:\d\d$/.test(t) ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) : NaN);
const copy = (times) => times.map(({ start, end, breaks, rest_minutes: rest }) => ({ start, end, breaks, rest_minutes: rest }));

/** The study a time leaves between its breaks. The server works it out the same way and has the last word. */
function studyText(t) {
  const span = toMinutes(t.end) - toMinutes(t.start);
  const block = Math.floor((span - t.breaks * t.rest_minutes) / t.breaks);
  if (!(span > 0) || !(t.breaks > 0) || !(block > 0)) return 'Set a start, an end and at least one break.';
  const rest = t.breaks * t.rest_minutes;
  return `${t.breaks === 1 ? `${block} min of study` : `${t.breaks} x ${block} min of study`}, each followed by a ${t.rest_minutes} min break to play. ${rest} min of play in all.`;
}

/** A day's study times, each on your own terms. `id` keeps the weekday and weekend copies apart. */
function StudyTimes({ id, value, onChange, limits }) {
  const set = (i, field, v) => onChange(value.map((t, n) => (n === i ? { ...t, [field]: v } : t)));
  return (
    <div className="stack">
      {value.map((t, i) => (
        <fieldset className="plan-time stack" key={i}>
          <legend className="label plan-label">Study time {i + 1}</legend>
          <div className="row plan-window">
            <label className="sr-only" htmlFor={`${id}Start${i}`}>Study time {i + 1} starts</label>
            <input id={`${id}Start${i}`} type="time" required value={t.start} onChange={(e) => set(i, 'start', e.target.value)} />
            <span className="small">to</span>
            <label className="sr-only" htmlFor={`${id}End${i}`}>Study time {i + 1} ends</label>
            <input id={`${id}End${i}`} type="time" required value={t.end} onChange={(e) => set(i, 'end', e.target.value)} />
          </div>
          <div className="plan-amount">
            <div>
              <label className="small" htmlFor={`${id}Breaks${i}`}>Rest breaks</label>
              <input id={`${id}Breaks${i}`} type="number" min={1} max={limits.max_breaks} required value={t.breaks} onChange={(e) => set(i, 'breaks', Number(e.target.value))} />
            </div>
            <div>
              <label className="small" htmlFor={`${id}Rest${i}`}>Minutes each</label>
              <input id={`${id}Rest${i}`} type="number" min={limits.rest_min_minutes} max={limits.rest_max_minutes} required value={t.rest_minutes} onChange={(e) => set(i, 'rest_minutes', Number(e.target.value))} />
            </div>
          </div>
          <p className="small" style={{ margin: 0 }} id={`${id}Study${i}`}>{studyText(t)}</p>
          {value.length > 1 && <div><button type="button" className="btn" onClick={() => onChange(value.filter((_, n) => n !== i))}>Remove this study time</button></div>}
        </fieldset>
      ))}
      {value.length < limits.max_windows && (
        <div><button type="button" className="btn" id={id === 'plan' ? 'addWindow' : `${id}AddWindow`} onClick={() => onChange([...value, { ...ANOTHER }])}>Add a study time</button></div>
      )}
    </div>
  );
}

/* Every rule here is the server's, and what it refuses it explains. This only collects what you intend. */
export function PlanForm({ onDone }) {
  const { plan, pending, limits } = ui.plan;
  const from = pending || plan;
  const [days, setDays] = useState(from ? from.days : [0, 1, 2, 3, 4]);
  const [times, setTimes] = useState(copy(from ? from.windows : [FIRST]));
  const [ownWeekend, setOwnWeekend] = useState(!!from?.weekend);
  const [weekend, setWeekend] = useState(copy(from?.weekend?.windows || [ANOTHER]));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Splitting only means something with weekdays and a weekend day both in the plan.
  const canSplit = days.some((d) => limits.weekend.includes(d)) && days.some((d) => !limits.weekend.includes(d));
  const splitWeek = canSplit && ownWeekend;
  const toggleDay = (d) => setDays(days.includes(d) ? days.filter((x) => x !== d) : [...days, d]);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await savePlan({ days, windows: times, weekend: splitWeek ? weekend : null });
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
        Set each study time on your own terms: when it runs, and how many breaks to play in. Study and rest take turns, and only these times earn play time.
        {plan ? ` You can change it once every ${limits.change_days} days.` : ` Once you start your first block, you can change it once every ${limits.change_days} days.`}
      </p>
      <p className="small" style={{ margin: 0 }}>Times are in {ui.plan.time_zone}.</p>
      <div>
        <span className="label plan-label">Days</span>
        <div className="row" role="group" aria-label="Study days">
          {WEEK.map((name, d) => <button key={d} type="button" className="btn plan-day" aria-pressed={days.includes(d)} onClick={() => toggleDay(d)}>{name}</button>)}
        </div>
      </div>
      {canSplit && (
        <label className="check"><input type="checkbox" id="planOwnWeekend" checked={ownWeekend} onChange={(e) => setOwnWeekend(e.target.checked)} /><span>Different times at the weekend</span></label>
      )}
      {splitWeek && <h2 className="label plan-part">Monday to Friday</h2>}
      <StudyTimes id="plan" value={times} onChange={setTimes} limits={limits} />
      {splitWeek && (
        <>
          <h2 className="label plan-part">Saturday and Sunday</h2>
          <StudyTimes id="weekend" value={weekend} onChange={setWeekend} limits={limits} />
        </>
      )}
      {error && <p className="small plan-error" role="alert" style={{ margin: 0 }}>{error}</p>}
      <div className="row">
        <button className="btn go" type="submit" id="savePlan" disabled={busy}>{plan ? 'Save for tomorrow' : 'Save my plan'}</button>
        {onDone && <button className="btn" type="button" onClick={onDone}>Keep my plan</button>}
      </div>
    </HudPanel>
  );
}
