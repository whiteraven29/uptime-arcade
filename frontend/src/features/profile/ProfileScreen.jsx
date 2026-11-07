import { useRef, useState } from 'react';
import { HudPanel } from '../../ui/HudPanel.jsx';
import { Avatar, SystemAvatar } from '../../ui/Avatar.jsx';
import { pad } from '../../../../engines/fs/index.js';
import { BADGES, S, chooseAvatar, level, removeAvatar, ui, uploadAvatar } from '../../api/game.js';

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
          <p className="small" style={{ margin: 0 }}>History charts arrive in milestone M11.</p>
        </HudPanel>
      </div>
    </section>
  );
}
