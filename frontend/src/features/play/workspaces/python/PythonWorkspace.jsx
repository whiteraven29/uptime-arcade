import { useEffect, useState } from 'react';
import { CodeEditor } from '../../../../ui/CodeEditor.jsx';
import { S, bump, reportCode, saveCode, canPlay, ui } from '../../../../api/game.js';
import { loadPython, runTests } from './runner.js';

export function PythonWorkspace({ mission }) {
  const on = canPlay();
  const [code, setCode] = useState(S.code[mission.id] ?? mission.starter);
  const [output, setOutput] = useState('');
  useEffect(() => {
    setCode(S.code[mission.id] ?? mission.starter);
    setOutput('');
  }, [mission.id, mission.starter]);
  const state = ui.py.state;
  const note = state === 'loading' ? 'Loading Python...' : state === 'failed' ? "Python couldn't start. Reload the page to try again." : !on ? 'Open a session to run code.' : 'Tests run on your PC.';
  return (
    <CodeEditor
      value={code}
      readOnly={!on}
      canRun={on && state === 'ready'}
      note={note}
      output={output}
      onChange={(v) => {
        setCode(v);
        saveCode(mission, v);
      }}
      onRun={async () => {
        if (!canPlay()) return;
        saveCode(mission, code);
        setOutput('Running...');
        const r = await runTests(mission, code);
        // A pass here is only a claim: the same tests then run on the server, and that run decides.
        setOutput(r.passed ? `${r.out}\nChecking on the server...` : r.out);
        const server = await reportCode(mission, { code, passed: r.passed });
        if (r.passed) setOutput(server.output || r.out);
        bump();
      }}
    />
  );
}

export const ensurePython = loadPython;
