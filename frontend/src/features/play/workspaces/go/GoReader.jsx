import { TerminalWorkspace } from '../terminal/TerminalWorkspace.jsx';

/* v1 of the Go track is read-and-predict (section 10): the code on top, answer from the terminal. */
export function GoReader({ code }) {
  return (
    <>
      <pre className="go-reader" aria-label="Go program">{code}</pre>
      <TerminalWorkspace />
    </>
  );
}
