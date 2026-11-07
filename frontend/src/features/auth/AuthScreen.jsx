import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Logo } from '../../ui/icons.jsx';
import { PasswordField } from '../../ui/PasswordField.jsx';
import { login, register, resendCode, usernameStatus } from '../../api/game.js';
import { ForgotForm, ResetForm, VerifyForm } from './CodeForms.jsx';
import { HowItWorks } from './HowItWorks.jsx';

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
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const status = useUsernameStatus(username);
  const blocked = status && !status.checking && !status.available;
  const differs = confirm.length > 0 && confirm !== password;

  const onSubmit = async (e) => {
    e.preventDefault();
    if (busy || differs) return;
    setBusy(true);
    setError('');
    try {
      const made = await register(username.trim(), email.trim(), password, confirm);
      navigate('/verify', { state: { username: made.username } });
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
      <PasswordField id="password" label="Password" autoComplete="new-password" minLength={10} value={password} onChange={setPassword} describedBy="passwordNote">
        <p id="passwordNote" className="field-note">At least 10 characters.</p>
      </PasswordField>
      <PasswordField id="confirmPassword" label="Confirm password" autoComplete="new-password" value={confirm} onChange={setConfirm} describedBy="confirmNote">
        <p id="confirmNote" className={`field-note ${differs ? 'bad' : confirm ? 'good' : ''}`} role="status">{differs ? "These don't match yet" : confirm ? 'They match' : ''}</p>
      </PasswordField>
      {error && <p className="bad" role="alert" style={{ margin: 0 }}>{error}</p>}
      <button className="btn cta" type="submit" id="registerBtn" disabled={busy || blocked || differs}>{busy ? 'Creating...' : 'Create account'}</button>
      <p className="small" style={{ margin: 0 }}>Already playing? <Link to="/login">Log in</Link></p>
    </form>
  );
}

function LoginForm() {
  const navigate = useNavigate();
  const { state } = useLocation();
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
      if (x.code === 'email_not_verified') {
        await resendCode(username.trim()).catch(() => {});
        navigate('/verify', { state: { username: username.trim() } });
        return;
      }
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
      <PasswordField id="password" label="Password" autoComplete="current-password" value={password} onChange={setPassword} />
      {state?.notice && <p className="good small" id="loginNotice" role="status" style={{ margin: 0 }}>{state.notice}</p>}
      {error && <p className="bad" role="alert" style={{ margin: 0 }}>{error}</p>}
      <button className="btn cta" type="submit" id="loginBtn" disabled={busy}>{busy ? 'Logging in...' : 'Log in'}</button>
      <p className="small auth-links" style={{ margin: 0 }}><span>New here? <Link to="/register">Create an account</Link></span> <Link to="/forgot" id="forgotLink">Forgot password?</Link></p>
    </form>
  );
}

const FORMS = {
  '/register': ['Create account', RegisterForm],
  '/verify': ['Confirm your email', VerifyForm],
  '/forgot': ['Forgot password', ForgotForm],
  '/reset': ['Choose a new password', ResetForm],
};

export function AuthScreen() {
  const { pathname } = useLocation();
  const [label, Form] = FORMS[pathname] || ['Log in', LoginForm];
  return (
    <section className="screen" aria-label={label}>
      <div className="auth">
        <div className="auth-card">
          <span className="auth-tabs" aria-hidden="true"><i /><i /><i /><i /><i /></span>
          <div className="auth-inner">
            <p className="auth-brand"><Logo /> Uptime Arcade</p>
            <Form />
          </div>
        </div>
        <HowItWorks />
      </div>
    </section>
  );
}
