import { useEffect, useState } from 'react';
import { CodeEditor } from '../../../../ui/CodeEditor.jsx';
import { S, bump, complete, notePyAttempt, saveCode, sessionOn, ui } from '../../../../api/localGame.js';
import { loadPython, runTests } from './runner.js';

export function PythonWorkspace({ mission }) {
  const on = sessionOn();
  const [code, setCode] = useState(S.code[mission.id] ?? mission.starter);
  const [output, setOutput] = useState('');
  useEffect(() => {
    setCode(S.code[mission.id] ?? mission.starter);
    setOutput('');
  }, [mission.id, mission.starter]);
  const state = ui.py.state;
  const note = state === 'loading' ? 'Loading Python...' : !on ? 'Open a session to run code.' : 'Tests run on your PC.';
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
        if (!sessionOn()) return;
        saveCode(mission, code);
        setOutput('Running...');
        notePyAttempt(mission);
        const r = await runTests(mission, code);
        setOutput(r.out);
        if (r.passed) complete(mission);
        bump();
      }}
    />
  );
}

export const ensurePython = loadPython;
