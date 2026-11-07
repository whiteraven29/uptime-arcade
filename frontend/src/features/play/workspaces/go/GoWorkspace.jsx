import { useEffect, useState } from 'react';
import { CodeEditor } from '../../../../ui/CodeEditor.jsx';
import { S, bump, canPlay, reportCode, saveCode } from '../../../../api/game.js';

/* Real Go: there's no Go in the browser, so Run tests compiles it in the sandbox on the server with `go test`. */
export function GoWorkspace({ mission }) {
  const on = canPlay();
  const [code, setCode] = useState(S.code[mission.id] ?? mission.starter);
  const [output, setOutput] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setCode(S.code[mission.id] ?? mission.starter);
    setOutput('');
  }, [mission.id, mission.starter]);
  return (
    <CodeEditor
      language="Go"
      value={code}
      readOnly={!on}
      canRun={on && !busy}
      note={busy ? 'Compiling and running on the server...' : 'Your code runs with go test on the server.'}
      output={output}
      onChange={(v) => {
        setCode(v);
        saveCode(mission, v);
      }}
      onRun={async () => {
        if (!canPlay() || busy) return;
        saveCode(mission, code);
        setBusy(true);
        setOutput('Running...');
        const r = await reportCode(mission, { code });
        setOutput(r.output);
        setBusy(false);
        bump();
      }}
    />
  );
}
