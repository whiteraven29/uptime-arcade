import { memo, useEffect, useRef, useState } from 'react';

/* Every command becomes its own block: where you were, what you ran, what came back and how it ended,
   so a long session stays easy to read. */
function toBlocks(spans) {
  const blocks = [];
  let cur = { id: 'start', lines: [] };
  for (const s of spans) {
    if (s.c === 'pr') {
      blocks.push(cur);
      cur = { id: s.id, where: s.t.trim(), lines: [] };
    } else if (s.c === 'cmd') cur.cmd = s.t.trimEnd();
    else if (s.c === 'st') cur.status = s.t.trim();
    else cur.lines.push(s);
  }
  blocks.push(cur);
  return blocks.filter((b) => b.cmd !== undefined || b.lines.length);
}
const STATUS = { 0: ['ok', '\u2713 done'], 127: ['bad', '\u2717 not found'], quiet: ['quiet', '\u2022 nothing found'] };
function Status({ code }) {
  if (code === undefined) return null;
  const [kind, text] = STATUS[code] || ['warn', `\u2717 exit ${code}`];
  return <span className={`t-status ${kind}`}>{text}</span>;
}

// `version` is what tells memo the (mutated in place) list has changed.
const Output = memo(function Output({ spans }) {
  return toBlocks(spans).map((b) => (
    <div key={b.id} className="t-block">
      {b.cmd !== undefined && (
        <div className="t-line">
          <span className="t-where">{b.where}</span>
          <span className="t-cmd">{b.cmd}</span>
          <Status code={b.status} />
        </div>
      )}
      {b.lines.map((s) => <div key={s.id} className={`t-out ${s.c || ''}`}>{s.t.replace(/\n$/, '')}</div>)}
    </div>
  ));
});

/* The console: a clear prompt, a grey suggestion Tab will accept, and a line that says what the command
   you're typing does. The output is a live region, so screen readers hear each result. */
export function Terminal({ spans, version, prompt, enabled, focusKey, history, onRun, onComplete, onClear, onInterrupt, assist, suggest }) {
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

  const help = assist(value);
  const ghost = suggest(value);

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
          <div className={`prompt-field ${help.kind}`}>
            <label className="pr" htmlFor="cmd">{prompt}</label>
            <span className="prompt-type">
              <span className="ghost" aria-hidden="true"><span className="ghost-typed">{value}</span>{ghost}</span>
              <input id="cmd" ref={input} type="text" value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={onKeyDown} autoComplete="off" autoCapitalize="off" spellCheck="false" aria-describedby="cmdHelp" />
            </span>
          </div>
          <p className="prompt-help" id="cmdHelp">{help.text}</p>
        </form>
      )}
    </>
  );
}
