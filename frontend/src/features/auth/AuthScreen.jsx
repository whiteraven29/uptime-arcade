import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { OperatorFigure } from '../../ui/OperatorFigure.jsx';
import { Logo } from '../../ui/icons.jsx';
import { login, register, usernameStatus } from '../../api/game.js';

const USERNAME_NOTES = {
  invalid: '3 to 20 letters, numbers, _ or -',
  reserved: "That name can't be used",
  taken: 'Already taken',
};

/* Asks the server as you type, waiting until you pause. */
function useUsernameStatus(name) {
  const [status, setStatus] = useState(null);
  const latest = useRef('');
  useEffect(() => {
    const value = name.trim();
    latest.current = value;
    if (!value) {
      setStatus(null);
      return undefined;
    }
    setStatus({ checking: true });
    const timer = setTimeout(async () => {
      try {
        const d = await usernameStatus(value);
        if (latest.current === value) setStatus(d);
      } catch {
        if (latest.current === value) setStatus(null); // the form still works, and register checks again
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [name]);
  return status;
}

function RegisterForm() {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const status = useUsernameStatus(username);
  const blocked = status && !status.checking && !status.available;

  const onSubmit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await register(username.trim(), email.trim(), password);
    } catch (x) {
      const details = x.details && Object.values(x.details).flat().join(' ');
      setError(details || x.message);
      setBusy(false);
    }
  };

  return (
    <form className="stack" onSubmit={onSubmit}>
      <header className="auth-head center">
        <h1>Create your operator</h1>
        <p>You start as a Noob. Real focus earns the play time.</p>
      </header>
      <div>
        <label className="small" htmlFor="username">Username</label>
        <input type="text" id="username" autoComplete="username" autoCapitalize="off" spellCheck="false" maxLength={20} required value={username} onChange={(e) => setUsername(e.target.value)} aria-describedby="usernameNote" />
        <p id="usernameNote" className={`field-note ${status?.available ? 'good' : blocked ? 'bad' : ''}`} role="status">
          {status?.checking ? 'Checking...' : status?.available ? 'Available' : blocked ? USERNAME_NOTES[status.reason] : USERNAME_NOTES.invalid}
        </p>
      </div>
      <div>
        <label className="small" htmlFor="email">Email</label>
        <input type="email" id="email" autoComplete="email" autoCapitalize="off" spellCheck="false" maxLength={150} required value={email} onChange={(e) => setEmail(e.target.value)} aria-describedby="emailNote" />
        <p id="emailNote" className="field-note">Private. It's never shown to anyone.</p>
      </div>
      <div>
        <label className="small" htmlFor="password">Password</label>
        <input type="password" id="password" autoComplete="new-password" minLength={10} maxLength={128} required value={password} onChange={(e) => setPassword(e.target.value)} aria-describedby="passwordNote" />
        <p id="passwordNote" className="field-note">At least 10 characters.</p>
      </div>
      {error && <p className="bad" role="alert" style={{ margin: 0 }}>{error}</p>}
      <button className="btn cta" type="submit" id="registerBtn" disabled={busy || blocked}>{busy ? 'Creating...' : 'Create account'}</button>
      <p className="small" style={{ margin: 0 }}>Already playing? <Link to="/login">Log in</Link></p>
    </form>
  );
}

function LoginForm() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await login(username.trim(), password);
    } catch (x) {
      setError(x.message);
      setPassword('');
      setBusy(false);
    }
  };

  return (
    <form className="stack" onSubmit={onSubmit}>
      <header className="auth-head">
        <h1>Welcome back, operator</h1>
        <p>Log in to get back to the data centre.</p>
      </header>
      <div>
        <label className="small" htmlFor="username">Username</label>
        <input type="text" id="username" autoComplete="username" autoCapitalize="off" spellCheck="false" required value={username} onChange={(e) => setUsername(e.target.value)} />
      </div>
      <div>
        <label className="small" htmlFor="password">Password</label>
        <input type="password" id="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      {error && <p className="bad" role="alert" style={{ margin: 0 }}>{error}</p>}
      <button className="btn cta" type="submit" id="loginBtn" disabled={busy}>{busy ? 'Logging in...' : 'Log in'}</button>
      <p className="small" style={{ margin: 0 }}>New here? <Link to="/register">Create an account</Link></p>
    </form>
  );
}

export function AuthScreen() {
  const { pathname } = useLocation();
  return (
    <section className="screen" aria-label={pathname === '/register' ? 'Create account' : 'Log in'}>
      <div className="auth">
        <div className="auth-card">
          <span className="auth-tabs" aria-hidden="true"><i /><i /><i /><i /><i /></span>
          <div className="auth-inner">
            <p className="auth-brand"><Logo /> Uptime Arcade</p>
            {pathname === '/register' ? <RegisterForm /> : <LoginForm />}
          </div>
        </div>
        <OperatorFigure beam={false} className="auth-figure" />
      </div>
    </section>
  );
}
