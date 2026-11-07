import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { PasswordField } from '../../ui/PasswordField.jsx';
import { forgotPassword, resendCode, resetPassword, verifyEmail } from '../../api/game.js';

const RESEND_WAIT = 60;
const problem = (x) => (x.details && Object.values(x.details).flat().join(' ')) || x.message;

function CodeInput({ value, onChange }) {
  return (
    <div>
      <label className="small" htmlFor="code">6-digit code</label>
      <input type="text" id="code" className="code-input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={value} onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ''))} />
    </div>
  );
}

function UsernameInput({ value, onChange }) {
  return (
    <div>
      <label className="small" htmlFor="username">Username</label>
      <input type="text" id="username" autoComplete="username" autoCapitalize="off" spellCheck="false" required value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export function VerifyForm() {
  const { state } = useLocation();
  const [username, setUsername] = useState(state?.username || '');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState(state?.username ? 'We sent a code to your email. It can take a minute, so check spam too.' : '');
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(state?.username ? RESEND_WAIT : 0);

  useEffect(() => {
    if (wait <= 0) return undefined;
    const timer = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  const onSubmit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await verifyEmail(username.trim(), code);
    } catch (x) {
      setError(problem(x));
      setCode('');
      setBusy(false);
    }
  };
  const resend = async () => {
    setError('');
    try {
      await resendCode(username.trim());
      setNote('If a new code is due, it is on its way. Only the newest code works.');
      setWait(RESEND_WAIT);
    } catch (x) {
      setError(problem(x));
    }
  };

  return (
    <form className="stack" onSubmit={onSubmit}>
      <header className="auth-head center">
        <h1>Confirm your email</h1>
        <p>One last step before your first focus block.</p>
      </header>
      {!state?.username && <UsernameInput value={username} onChange={setUsername} />}
      <CodeInput value={code} onChange={setCode} />
      {note && <p className="small" id="codeNote" role="status" style={{ margin: 0 }}>{note}</p>}
      {error && <p className="bad" role="alert" style={{ margin: 0 }}>{error}</p>}
      <button className="btn cta" type="submit" id="verifyBtn" disabled={busy || code.length !== 6}>{busy ? 'Checking...' : 'Confirm'}</button>
      <button className="linkish" type="button" id="resendBtn" disabled={wait > 0 || !username.trim()} onClick={resend}>{wait > 0 ? `Send a new code in ${wait}s` : 'Send a new code'}</button>
      <p className="small" style={{ margin: 0 }}><Link to="/login">Back to log in</Link></p>
    </form>
  );
}

export function ForgotForm() {
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const value = identifier.trim();
    try {
      await forgotPassword(value);
      navigate('/reset', { state: { username: value.includes('@') ? '' : value } });
    } catch (x) {
      setError(problem(x));
      setBusy(false);
    }
  };

  return (
    <form className="stack" onSubmit={onSubmit}>
      <header className="auth-head center">
        <h1>Forgot your password?</h1>
        <p>Give your username or email, and we'll send a code.</p>
      </header>
      <div>
        <label className="small" htmlFor="identifier">Username or email</label>
        <input type="text" id="identifier" autoComplete="username" autoCapitalize="off" spellCheck="false" maxLength={150} required value={identifier} onChange={(e) => setIdentifier(e.target.value)} />
      </div>
      {error && <p className="bad" role="alert" style={{ margin: 0 }}>{error}</p>}
      <button className="btn cta" type="submit" id="forgotBtn" disabled={busy}>{busy ? 'Sending...' : 'Send the code'}</button>
      <p className="small" style={{ margin: 0 }}><Link to="/login">Back to log in</Link></p>
    </form>
  );
}

export function ResetForm() {
  const navigate = useNavigate();
  const { state } = useLocation();
  const [username, setUsername] = useState(state?.username || '');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const differs = confirm.length > 0 && confirm !== password;

  const onSubmit = async (e) => {
    e.preventDefault();
    if (busy || differs) return;
    setBusy(true);
    setError('');
    try {
      await resetPassword(username.trim(), code, password, confirm);
      navigate('/login', { state: { notice: 'Password changed, and every other device is logged out. Log in with the new one.' } });
    } catch (x) {
      setError(problem(x));
      setBusy(false);
    }
  };

  return (
    <form className="stack" onSubmit={onSubmit}>
      <header className="auth-head center">
        <h1>Choose a new password</h1>
        <p id="resetNote" role="status">If that account exists and its email is confirmed, a code is on its way. The email names your username too.</p>
      </header>
      <UsernameInput value={username} onChange={setUsername} />
      <CodeInput value={code} onChange={setCode} />
      <PasswordField id="password" label="New password" autoComplete="new-password" minLength={10} value={password} onChange={setPassword} />
      <PasswordField id="confirmPassword" label="Confirm new password" autoComplete="new-password" value={confirm} onChange={setConfirm} describedBy="confirmNote">
        <p id="confirmNote" className={`field-note ${differs ? 'bad' : ''}`} role="status">{differs ? "These don't match yet" : ''}</p>
      </PasswordField>
      {error && <p className="bad" role="alert" style={{ margin: 0 }}>{error}</p>}
      <button className="btn cta" type="submit" id="resetBtn" disabled={busy || differs || code.length !== 6}>{busy ? 'Saving...' : 'Change password'}</button>
      <p className="small" style={{ margin: 0 }}><Link to="/forgot">Send another code</Link></p>
    </form>
  );
}
