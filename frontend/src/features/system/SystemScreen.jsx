import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Avatar } from '../../ui/Avatar.jsx';
import { HudPanel } from '../../ui/HudPanel.jsx';
import { PasswordField } from '../../ui/PasswordField.jsx';
import { S, changePassword, closeSession, deleteAccount, level, logout, setTimeZone, toggleMute, ui } from '../../api/game.js';
import { longDay } from '../profile/history.js';

const PASSWORD_MIN = 10;

/* Your other devices are logged out, and this one stays in. */
function ChangePassword() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const close = () => {
    setOpen(false);
    setCurrent('');
    setPassword('');
    setConfirm('');
    setError('');
  };
  if (!open) {
    return (
      <div className="stack">
        <div className="row"><button className="btn" type="button" id="changePasswordBtn" onClick={() => { setMessage(''); setOpen(true); }}>Change password</button></div>
        {message && <p className="small" role="status" id="passwordChanged" style={{ margin: 0 }}>{message}</p>}
      </div>
    );
  }
  return (
    <form
      className="stack"
      id="changePasswordForm"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
          await changePassword(current, password, confirm);
          close();
          setMessage('Password changed. Your other devices have been logged out.');
        } catch (x) {
          setError(x.message);
          setCurrent('');
        }
        setBusy(false);
      }}
    >
      <PasswordField id="currentPassword" label="Current password" autoComplete="current-password" value={current} onChange={setCurrent} />
      <PasswordField id="newPassword" label="New password" autoComplete="new-password" minLength={PASSWORD_MIN} value={password} onChange={setPassword} />
      <PasswordField id="confirmNewPassword" label="New password again" autoComplete="new-password" minLength={PASSWORD_MIN} value={confirm} onChange={setConfirm} />
      {error && <p className="bad" role="alert" style={{ margin: 0 }}>{error}</p>}
      <div className="row">
        <button className="btn go" type="submit" id="savePassword" disabled={busy}>Save new password</button>
        <button className="btn" type="button" onClick={close}>Cancel</button>
      </div>
    </form>
  );
}

/* Who you are here, at a glance. The email stays off screen: it's private, and nothing here needs it. */
function AccountCard({ account }) {
  return (
    <div className="stack" id="accountCard">
      <div className="profile-head">
        <Avatar avatar={account.avatar} name={account.username} size={64} />
        <div>
          <b className="wrap-any">{account.username}</b>
          <p className="small" style={{ margin: 0 }}>{level()}, {S.xp} XP</p>
          {account.joined && <p className="small" style={{ margin: 0 }}>Joined {longDay(account.joined)}</p>}
        </div>
      </div>
      <div className="row"><Link className="btn" to="/profile" id="viewProfile">View profile</Link></div>
    </div>
  );
}

function DeleteAccount() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  if (!open) return <div className="row"><button className="btn" type="button" onClick={() => setOpen(true)}>Delete my account</button></div>;
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await deleteAccount(password);
        } catch (x) {
          setError(x.message);
          setPassword('');
        }
      }}
    >
      <p className="bad" style={{ margin: 0 }}>This wipes your progress, XP, badges and focus history for good.</p>
      <div>
        <PasswordField id="deletePassword" label="Your password" autoComplete="current-password" value={password} onChange={setPassword} />
      </div>
      {error && <p className="bad" role="alert" style={{ margin: 0 }}>{error}</p>}
      <div className="row">
        <button className="btn warn" type="submit">Delete everything</button>
        <button className="btn" type="button" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}

export function SystemScreen() {
  const here = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const account = ui.account;
  return (
    <section className="screen" aria-label="System">
      <div className="grid2">
        <HudPanel className="stack" label="Your account">
          <AccountCard account={account} />
          <p style={{ margin: 0 }} className="small">Your day runs on {account.time_zone}, which decides when your streak rolls over. You can change it once a day.</p>
          {here !== account.time_zone && <div className="row"><button className="btn" type="button" onClick={() => setTimeZone(here)}>Use {here}</button></div>}
          <div className="row"><button className="btn" type="button" id="logoutBtn" onClick={logout}>Log out</button></div>
          <DeleteAccount />
        </HudPanel>
        <HudPanel className="stack" label="Password">
          <p style={{ margin: 0 }} className="small">Change it here while you're logged in. Forgot it? Log out and use Forgot password on the login page.</p>
          <ChangePassword />
        </HudPanel>
        <HudPanel className="stack" label="Sound">
          <p style={{ margin: 0 }} className="small">Chimes for the timer, unlocks and level-ups.</p>
          <div className="row"><button className="btn" type="button" aria-pressed={!S.muted} onClick={toggleMute}>{S.muted ? 'Sound off' : 'Sound on'}</button></div>
        </HudPanel>
        <HudPanel className="stack" label="Session">
          <div className="row"><button className="btn" type="button" onClick={() => closeSession()}>Close session and bank time</button></div>
          <p className="label" style={{ margin: '6px 0 0' }}>Seasons</p>
          <p style={{ margin: 0 }} className="small">You're in season {S.season}. New seasons bring new missions. Everything you've cleared stays cleared, and you can revisit any of it from Missions.</p>
        </HudPanel>
        <HudPanel label="About">
          <p style={{ margin: 0 }} className="small">Whiteraven is a fictional company. The terminal is simulated, and its files stay on this device. Your progress is kept on the server.</p>
        </HudPanel>
      </div>
    </section>
  );
}
