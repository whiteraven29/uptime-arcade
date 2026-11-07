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
export const planText = (p) => `${daysText(p.days)}, ${p.blocks_per_day} x ${p.block_minutes} min, at ${p.windows.map((w) => `${w.start} to ${w.end}`).join(' and ')}`;

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
