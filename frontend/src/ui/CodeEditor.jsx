/* Python editor with a Run tests button and an output pane. */
export function CodeEditor({ value, onChange, readOnly, canRun, onRun, note, output }) {
  return (
    <div className="code-pane">
      <textarea
        value={value}
        readOnly={readOnly}
        spellCheck="false"
        aria-label="Python code"
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
      <pre className="code-out">{output}</pre>
    </div>
  );
}
