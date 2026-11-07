import { useEffect, useLayoutEffect, useRef, useState } from 'react';

const LINE = 19;

/* One line of text, with the selection and the cursor painted over it. */
function Line({ text, from, to, cursor }) {
  const out = [];
  const end = Math.max(text.length, cursor === null ? 0 : cursor + 1, to ?? 0);
  let i = 0;
  while (i < end) {
    const isCur = i === cursor;
    const inSel = from !== undefined && i >= from && i < to;
    let j = i + 1;
    while (j < end && j !== cursor && !isCur && (from !== undefined && j >= from && j < to) === inSel) j++;
    const part = text.slice(i, j) || ' ';
    out.push(isCur ? <span key={i} className="cur">{part}</span> : inSel ? <span key={i} className="sel">{part}</span> : part);
    i = j;
  }
  return <span>{out}{'\n'}</span>;
}

/* Full-pane modal editor with cursor, status bar and key counter. The vi engine owns the buffer. */
export function ViEditor({ vi, onKey, selection }) {
  const box = useRef(null);
  const wrap = useRef(null);
  const [rows, setRows] = useState(20);

  useLayoutEffect(() => {
    const measure = () => setRows(Math.max(8, Math.floor((box.current.clientHeight - 20) / LINE)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    wrap.current.focus();
  }, []);

  if (vi.r < vi.top) vi.top = vi.r;
  if (vi.r >= vi.top + rows) vi.top = vi.r - rows + 1;

  const rendered = [];
  for (let i = vi.top; i < vi.top + rows; i++) {
    if (i >= vi.L.length) {
      rendered.push(<span key={i} className="tilde">~{'\n'}</span>);
      continue;
    }
    const sel = selection(i);
    const cursor = i === vi.r && vi.mode !== 'command' ? Math.min(vi.c, vi.L[i].length) : null;
    rendered.push(<Line key={i} text={vi.L[i]} from={sel ? sel[0] : undefined} to={sel ? sel[1] : undefined} cursor={cursor} />);
  }

  return (
    <div
      className="vi"
      ref={wrap}
      tabIndex={0}
      role="application"
      aria-label="vi editor"
      onKeyDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onKey(e.key, e.ctrlKey);
      }}
    >
      <pre className="vi-text" ref={box}>{rendered}</pre>
      <div className="vi-status">
        <span>{vi.mode === 'command' ? vi.cmd : vi.mode === 'insert' ? '-- INSERT --' : vi.vis ? `-- VISUAL${vi.vis.kind === 'V' ? ' LINE' : vi.vis.kind === 'b' ? ' BLOCK' : ''} --` : vi.macroRec ? `recording @${vi.macroRec.name}` : vi.msg || vi.shown}</span>
        <span>{vi.r + 1},{vi.c + 1}   keys {vi.keys}</span>
      </div>
    </div>
  );
}
