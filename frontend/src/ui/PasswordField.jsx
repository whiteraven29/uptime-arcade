import { useState } from 'react';

function Eye({ crossed }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
      {crossed && <path d="M4 4l16 16" />}
    </svg>
  );
}

/* A password you can check as you type. The button never submits the form, and each field remembers its own choice. */
export function PasswordField({ id, label, value, onChange, autoComplete, minLength, describedBy, children }) {
  const [shown, setShown] = useState(false);
  return (
    <div>
      <label className="small" htmlFor={id}>{label}</label>
      <div className="pw-field">
        <input type={shown ? 'text' : 'password'} id={id} autoComplete={autoComplete} autoCapitalize="off" spellCheck="false" minLength={minLength} maxLength={128} required aria-describedby={describedBy} value={value} onChange={(e) => onChange(e.target.value)} />
        <button type="button" className="pw-toggle" id={`${id}Toggle`} aria-label={shown ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`} aria-pressed={shown} onClick={() => setShown(!shown)}>
          <Eye crossed={shown} />
        </button>
      </div>
      {children}
    </div>
  );
}
