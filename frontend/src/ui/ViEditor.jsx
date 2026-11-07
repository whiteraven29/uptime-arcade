import { useEffect, useLayoutEffect, useRef, useState } from 'react';

const LINE = 19;

/* Full-pane modal editor with cursor, status bar and key counter. The vi engine owns the buffer. */
export function ViEditor({ vi, onKey }) {
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
    const l = vi.L[i];
    if (i === vi.r && vi.mode !== 'command') {
      const c = Math.min(vi.c, l.length);
      rendered.push(<span key={i}>{l.slice(0, c)}<span className="cur">{l[c] || ' '}</span>{l.slice(c + 1)}{'\n'}</span>);
    } else {
      rendered.push(<span key={i}>{l}{'\n'}</span>);
    }
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
        <span>{vi.mode === 'command' ? vi.cmd : vi.mode === 'insert' ? '-- INSERT --' : vi.msg || vi.shown}</span>
        <span>{vi.r + 1},{vi.c + 1}   keys {vi.keys}</span>
      </div>
    </div>
  );
}
