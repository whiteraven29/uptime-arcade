import { HudPanel } from '../../ui/HudPanel.jsx';
import { GoalMeters } from '../../ui/GoalMeters.jsx';
import { mmss, ui } from '../../api/game.js';
import { shortDay, weekdayName } from '../profile/history.js';

const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function daysText(days) {
  if (days.length === 7) return 'Every day';
  // Runs of three or more read better as a range.
  const parts = [];
  let run = [days[0]];
  for (const d of days.slice(1)) {
    if (d === run.at(-1) + 1) run.push(d);
    else {
      parts.push(run);
      run = [d];
    }
  }
  parts.push(run);
  return parts.map((r) => (r.length > 2 ? `${WEEK[r[0]]} to ${WEEK[r.at(-1)]}` : r.map((d) => WEEK[d]).join(', '))).join(', ');
}
const WEEKEND = [5, 6];
const timeText = (t) => `${t.start} to ${t.end} (${t.breaks} x ${t.block_minutes} min, ${t.rest_minutes} min breaks)`;
const scheduleText = (s) => s.windows.map(timeText).join(' and ');
export function planText(p) {
  if (!p.weekend) return `${daysText(p.days)}, ${scheduleText(p)}`;
  const week = p.days.filter((d) => !WEEKEND.includes(d));
  const end = p.days.filter((d) => WEEKEND.includes(d));
  return `${daysText(week)}, ${scheduleText(p)}. ${daysText(end)}, ${scheduleText(p.weekend)}`;
}

/** Today's turns of study and rest, as the server laid them out from the plan. */
function Slots({ slots }) {
  if (!slots?.length) return null;
  return (
    <ol className="plan-slots" id="planSlots" aria-label="Today's study and rest">
      {slots.map((s) => (
        <li key={`${s.kind}${s.start}`} data-kind={s.kind}>
          <b className="plan-slot-time">{s.start}</b> {s.kind === 'study' ? 'Study' : 'Rest and play'}, {s.minutes} min
        </li>
      ))}
    </ol>
  );
}

const nextText = (next, today) => (next ? `Next study time: ${next.date === today ? 'today' : `${weekdayName(next.date)} ${shortDay(next.date)}`} at ${next.start}.` : '');

export function todayText({ today }) {
  const next = nextText(today.next_window, today.date);
  if (!today.is_study_day) return `A day off in your plan. ${next}`;
  const done = `${today.minutes_earning} of ${today.minutes_planned} min today.`;
  return today.in_window ? `${done} Study time is open until ${today.window_ends}.` : `${done} ${next}`;
}

export function PlanPanel({ onChange }) {
  const { plan, pending, changes_open_on: opensOn, today, targets, limits } = ui.plan;
  return (
    <HudPanel className="focus-card stack plan-panel" label="Your study plan">
      <div>
        <b id="planSummary">{planText(plan)}</b>
        <p className="small" style={{ margin: '2px 0 0' }} id="planToday">{todayText({ today })}</p>
      </div>
      <Slots slots={today.slots} />
      {pending && <p className="small" style={{ margin: 0 }}>From {shortDay(pending.effective_from)}: {planText(pending)}.</p>}
      <GoalMeters targets={targets} />
      <p className="small" style={{ margin: 0 }}>
        Keep this tab open. Each block asks once if you're still there, and you have {mmss(limits.presence_window_seconds)} to answer. Then claim it within {limits.claim_window_seconds / 60} minutes of it ending.
      </p>
      <div className="row">
        <button className="btn" type="button" id="changePlan" disabled={!!opensOn} onClick={onChange}>Change plan</button>
        {opensOn && <span className="small" id="planLocked">You can change it on {shortDay(opensOn)}.</span>}
      </div>
    </HudPanel>
  );
}
