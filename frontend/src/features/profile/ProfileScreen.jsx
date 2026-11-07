import { useEffect, useRef, useState } from 'react';
import { HudPanel } from '../../ui/HudPanel.jsx';
import { Avatar, SystemAvatar } from '../../ui/Avatar.jsx';
import { pad } from '../../../../engines/fs/index.js';
import { GoalMeters } from '../../ui/GoalMeters.jsx';
import { BADGES, S, chooseAvatar, level, loadHistory, removeAvatar, ui, uploadAvatar } from '../../api/game.js';
import { ColumnChart } from './ColumnChart.jsx';
import { FocusMap } from './FocusMap.jsx';
import { lastDays, longDay, shortDay } from './history.js';

const SYSTEM_AVATARS = 16;
const LONGEST_SIDE = 512;

/* Large phone photos are shrunk here first, so they upload quickly. The server still redoes it properly. */
async function shrink(file) {
  if (file.type === 'image/gif' || !window.createImageBitmap) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, LONGEST_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => { canvas.toBlob(resolve, 'image/png'); });
    return blob ? new File([blob], 'picture.png', { type: 'image/png' }) : file;
  } catch {
    return file; // the server decides whether it's really a picture
  }
}

const OUTCOMES = { done: 'Finished', not_done: 'Not finished', abandoned: 'Ended early', missed: 'Missed the check-in', expired: 'Not claimed', open: 'In progress' };
const KINDS = { plan: 'On plan', makeup: 'Make-up', free: 'Extra' };
const DAYS_CHARTED = 30;

function Recent({ blocks }) {
  if (!blocks.length) return <p className="small" style={{ margin: 0 }}>Nothing yet. What you finish will be written down here.</p>;
  return (
    <ul className="recent">
      {blocks.map((b) => (
        <li key={b.id}>
          <div className="wrap-any"><b>{b.goal}</b>{b.note && <span className="small"> {b.note}</span>}</div>
          <span className="small recent-meta">{b.minutes} min, {KINDS[b.kind]}, {OUTCOMES[b.outcome]}</span>
        </li>
      ))}
    </ul>
  );
}

function History() {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    loadHistory().then((d) => { if (live) setData(d); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, []);
  if (failed) return <HudPanel label="Your history"><p className="small" role="status">Your history couldn't load just now. Try again in a moment.</p></HudPanel>;
  if (!data) return <HudPanel label="Your history"><p className="small" role="status">Loading your history.</p></HudPanel>;
  const days = lastDays(data.today, data.days, DAYS_CHARTED).map((d) => ({ key: d.date, value: d.minutes, label: shortDay(d.date), detail: longDay(d.date) }));
  const weeks = data.weeks.map((w) => ({ key: w.start, value: w.xp, label: shortDay(w.start), detail: `Week of ${shortDay(w.start)}` }));
  return (
    <>
      <HudPanel label="Focus map" id="focusMap">
        <FocusMap today={data.today} days={data.days} />
      </HudPanel>
      {ui.plan?.targets && <HudPanel label="Goals from your plan"><GoalMeters targets={ui.plan.targets} /></HudPanel>}
      <div className="grid2 history-charts">
        <HudPanel label={`Focus minutes a day, last ${DAYS_CHARTED} days`} id="chartFocus">
          <ColumnChart title={`Focus minutes a day, last ${DAYS_CHARTED} days`} unit="min" data={days} tone="focus" fallback={60} tickUnit={10} labelEvery={7} firstColumn={2} />
        </HudPanel>
        <HudPanel label="XP a week, last 12 weeks" id="chartXp">
          <ColumnChart title="XP a week, last 12 weeks" unit="XP" data={weeks} tone="xp" fallback={100} tickUnit={10} labelEvery={3} firstColumn={0} />
        </HudPanel>
      </div>
      <HudPanel label="Recent blocks" id="recentBlocks">
        <Recent blocks={data.recent} />
      </HudPanel>
    </>
  );
}

export function ProfileScreen() {
  const file = useRef(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const { username, avatar } = ui.account;

  const attempt = async (fn, done) => {
    setBusy(true);
    setMessage('');
    try {
      await fn();
      setMessage(done);
    } catch (e) {
      setMessage(e.message);
    }
    setBusy(false);
  };
  const onFile = (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (f) attempt(async () => uploadAvatar(await shrink(f)), 'Picture updated.');
  };

  return (
    <section className="screen" aria-label="Profile">
      <div className="grid2">
        <HudPanel className="stack" label="Your picture">
          <div className="profile-head">
            <Avatar avatar={avatar} name={username} size={96} />
            <div>
              <h1 className="title metal" style={{ margin: 0 }}>{username}</h1>
              <p className="small" style={{ margin: 0 }}>{level()}, {S.xp} XP</p>
            </div>
          </div>
          <div className="row">
            <button className="btn go" type="button" id="uploadBtn" disabled={busy} onClick={() => file.current.click()}>Upload a picture</button>
            {avatar.kind === 'upload' && <button className="btn" type="button" disabled={busy} onClick={() => attempt(removeAvatar, 'Picture removed.')}>Remove picture</button>}
            <input ref={file} id="avatarFile" type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden aria-label="Picture file" onChange={onFile} />
          </div>
          <p className="small" role="status" style={{ margin: 0 }}>{message || 'PNG, JPEG, WebP or GIF. It gets cropped to a square, and hidden details like location are removed.'}</p>
          <p className="label" style={{ margin: '6px 0 0' }}>Or pick an operator</p>
          <div className="avatar-grid" role="radiogroup" aria-label="System avatars">
            {Array.from({ length: SYSTEM_AVATARS }, (_, i) => {
              const on = avatar.kind === 'system' && avatar.index === i;
              return (
                <button key={i} type="button" role="radio" aria-checked={on} aria-label={`Operator ${i + 1}`} className={`avatar-pick${on ? ' on' : ''}`} disabled={busy} onClick={() => attempt(() => chooseAvatar(i), 'Operator chosen.')}>
                  <SystemAvatar index={i} />
                </button>
              );
            })}
          </div>
        </HudPanel>
        <HudPanel className="stack" label="Your numbers">
          <div className="profile-stats">
            <div><b className="num">{S.xp}</b><span className="small">XP</span></div>
            <div><b className="num">{S.bestStreak}</b><span className="small">Best streak</span></div>
            <div><b className="num">{Math.floor(S.focusMin / 60)}h {pad(S.focusMin % 60)}m</b><span className="small">Focus</span></div>
            <div><b className="num">{S.blocks}</b><span className="small">Blocks</span></div>
            <div><b className="num">{Object.keys(S.badges || {}).length}/{BADGES.length}</b><span className="small">Badges</span></div>
          </div>
        </HudPanel>
      </div>
      <History />
    </section>
  );
}
