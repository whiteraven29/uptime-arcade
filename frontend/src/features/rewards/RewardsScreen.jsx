import { HudPanel } from '../../ui/HudPanel.jsx';
import { Badge } from '../../ui/Badge.jsx';
import { LadderRow } from '../../ui/LadderRow.jsx';
import { BADGES, LEVELS, S, STREAKS, levelIdx, mult } from '../../api/localGame.js';

export function RewardsScreen() {
  const next = STREAKS.find((s) => !S.claimed[s[0]]);
  const cur = levelIdx();
  return (
    <section className="screen" aria-label="Rewards">
      <div className="grid2">
        <HudPanel label="Day streak rewards">
          <p className="small">Finish one focus block a day to keep the streak. Best {S.bestStreak} days. Shields {S.shields}. XP bonus +{Math.round((mult() - 1) * 100)}%, up to +50%.</p>
          <div className="lad">
            {STREAKS.map(([n, m, x, sh]) => {
              const got = S.claimed[n];
              return <LadderRow key={n} state={got ? 'on' : next && next[0] === n ? 'next' : ''} cells={[`${n} days`, `+${m} min play, +${x} XP${sh ? ', +1 shield' : ''}`, got ? 'Claimed' : '']} />;
            })}
          </div>
        </HudPanel>
        <HudPanel label="Levels">
          <div className="lad">
            {LEVELS.map((v, i) => <LadderRow key={v[1]} state={i < cur ? 'on' : i === cur ? 'next' : ''} cells={[String(i + 1), v[1], `${v[0]} missions`]} />)}
          </div>
        </HudPanel>
        <HudPanel className="span-all" label={`Badges ${Object.keys(S.badges).length}/${BADGES.length}`}>
          <div className="badges">
            {BADGES.map(([id, name, desc]) => <Badge key={id} name={name} description={desc} earned={S.badges[id]} />)}
          </div>
        </HudPanel>
      </div>
    </section>
  );
}
