import { mmss } from '../api/game.js';

const NAMES = { week: 'This week', month: 'This month' };

/* Minutes that earned, against the goal your plan worked out. A meter because it's one ratio against a limit. */
function Goal({ goal }) {
  const { period, minutes, target_minutes: target, reached, reward_seconds: seconds, reward_xp: xp } = goal;
  const share = target ? Math.min(100, (minutes / target) * 100) : 0;
  return (
    <div className="goal" data-period={period}>
      <div className="goal-head">
        <b>{NAMES[period]}</b>
        <span className="small">{target ? `${minutes} of ${target} min` : 'No study days left'}</span>
      </div>
      {target > 0 && (
        <div className="goal-meter" role="meter" aria-label={`${NAMES[period]}: ${minutes} of ${target} minutes`} aria-valuemin={0} aria-valuemax={target} aria-valuenow={Math.min(minutes, target)}>
          <i style={{ width: `${share}%` }} />
        </div>
      )}
      {target > 0 && <span className="small">{reached ? 'Goal met. Reward paid.' : `Meet it for +${mmss(seconds)} play and +${xp} XP.`}</span>}
    </div>
  );
}

export function GoalMeters({ targets }) {
  if (!targets) return null;
  return (
    <div className="goals">
      <Goal goal={targets.week} />
      <Goal goal={targets.month} />
    </div>
  );
}
