/* A code editor with a Run tests button and an output pane. */
export function CodeEditor({ language = 'Python', value, onChange, readOnly, canRun, onRun, note, output }) {
  return (
    <div className="code-pane">
      <textarea
        value={value}
        readOnly={readOnly}
        spellCheck="false"
        aria-label={`${language} code`}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Tab') {
            e.preventDefault();
            const t = e.target;
            t.setRangeText('    ', t.selectionStart, t.selectionEnd, 'end');
            onChange(t.value);
          }
        }}
      />
      <div className="row">
        <button className="btn go" type="button" disabled={!canRun} onClick={onRun}>Run tests</button>
        <span className="small">{note}</span>
      </div>
      <div className="code-out" role="log" aria-label="Test results">
        {output.split('\n').map((line, i) => {
          const kind = /^ok /.test(line) ? 'pass' : /^FAIL /.test(line) ? 'fail' : /Error|on line \d/.test(line) ? 'fail' : '';
          return <div key={`${i}${line}`} className={`code-line ${kind}`}>{line}</div>;
        })}
      </div>
    </div>
  );
}
