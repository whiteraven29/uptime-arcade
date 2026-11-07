import { Terminal } from '../../../../ui/Terminal.jsx';
import { S, VI, bump, clearTerm, echoCmd, promptText, runCommand, sessionOn, tabComplete, ui } from '../../../../api/game.js';

export function TerminalWorkspace() {
  return (
    <Terminal
      spans={ui.term}
      version={ui.termVersion}
      prompt={promptText()}
      enabled={sessionOn()}
      focusKey={VI.on}
      history={S.hist}
      onRun={(v) => {
        if (sessionOn()) runCommand(v);
      }}
      onComplete={tabComplete}
      onClear={clearTerm}
      onInterrupt={(v) => {
        echoCmd(v + '^C');
        bump();
      }}
    />
  );
}
