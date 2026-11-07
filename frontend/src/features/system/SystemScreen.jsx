import { useState } from 'react';
import { HudPanel } from '../../ui/HudPanel.jsx';
import { S, TICKETS, closeSession, deleteAccount, logout, newSeason, setTimeZone, toggleMute, ui } from '../../api/game.js';

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
        <label className="small" htmlFor="deletePassword">Your password</label>
        <input type="password" id="deletePassword" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
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
  const [confirming, setConfirming] = useState(false);
  const here = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const account = ui.account;
  return (
    <section className="screen" aria-label="System">
      <div className="grid2">
        <HudPanel className="stack" label="Your account">
          <p style={{ margin: 0 }}>Logged in as <b>{account.username}</b>. Your email is private: {account.email}</p>
          <p style={{ margin: 0 }} className="small">Your day runs on {account.time_zone}, which decides when your streak rolls over. You can change it once a day.</p>
          {here !== account.time_zone && <div className="row"><button className="btn" type="button" onClick={() => setTimeZone(here)}>Use {here}</button></div>}
          <div className="row"><button className="btn" type="button" id="logoutBtn" onClick={logout}>Log out</button></div>
          <DeleteAccount />
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
          <p style={{ margin: 0 }} className="small">Whiteraven is a fictional company. The terminal is simulated, and its files stay on this device. Your progress is kept on the server.</p>
        </HudPanel>
      </div>
    </section>
  );
}
