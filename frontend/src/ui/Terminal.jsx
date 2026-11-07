import { memo, useEffect, useRef, useState } from 'react';

// `version` is what tells memo the (mutated in place) list has changed.
const Output = memo(function Output({ spans }) {
  return spans.map((s) => <span key={s.id} className={s.c}>{s.t}</span>);
});

/* Monospace console: prompt, history, Tab completion and colour classes. The output is a live
   region, so screen readers hear each result. */
export function Terminal({ spans, version, prompt, enabled, focusKey, history, onRun, onComplete, onClear, onInterrupt }) {
  const out = useRef(null);
  const input = useRef(null);
  const [value, setValue] = useState('');
  const hist = useRef(null);

  useEffect(() => {
    if (out.current) out.current.scrollTop = out.current.scrollHeight;
  }, [version]);
  useEffect(() => {
    if (enabled) input.current?.focus();
  }, [enabled, focusKey]);

  const onKeyDown = (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const r = onComplete(value, e.target.selectionStart);
      if (r) {
        setValue(r.value);
        requestAnimationFrame(() => input.current?.setSelectionRange(r.caret, r.caret));
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (hist.current === null) hist.current = history.length;
      hist.current = Math.max(0, hist.current - 1);
      setValue(history[hist.current] || '');
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (hist.current === null) return;
      hist.current += 1;
      if (hist.current >= history.length) {
        hist.current = null;
        setValue('');
      } else {
        setValue(history[hist.current]);
      }
    } else if (e.ctrlKey && e.key === 'l') {
      e.preventDefault();
      onClear();
    } else if (e.ctrlKey && e.key === 'c') {
      e.preventDefault();
      onInterrupt(value);
      setValue('');
    }
  };

  return (
    <>
      <div className="term-out" role="log" aria-label="Terminal output" ref={out}>
        <Output spans={spans} version={version} />
      </div>
      {enabled && (
        <form
          className="prompt"
          onSubmit={(e) => {
            e.preventDefault();
            hist.current = null;
            const v = value;
            setValue('');
            onRun(v);
          }}
        >
          <label className="pr" htmlFor="cmd">{prompt}</label>
          <input id="cmd" ref={input} type="text" value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={onKeyDown} autoComplete="off" autoCapitalize="off" spellCheck="false" />
        </form>
      )}
    </>
  );
}
