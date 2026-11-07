import { useEffect, useRef } from 'react';
import { paintScene } from './scene/paintScene.js';

const MAX_DPR = 1.5;

/* The data centre fills the whole window, and everything else is drawn into it (ADR 0003, 0008). */
export function SceneBackdrop({ frameRef }) {
  const inner = useRef(null);
  const glow = useRef(null);

  useEffect(() => {
    let raf = 0;
    let timer = 0;
    let lastKey = '';
    const paint = () => {
      const c = inner.current;
      const box = c.getBoundingClientRect();
      if (!box.width || !box.height) return;
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const W = Math.round(box.width * dpr);
      const H = Math.round(box.height * dpr);
      const key = `${W}x${H}`;
      if (key === lastKey) return;
      lastKey = key;
      c.width = W;
      c.height = H;
      glow.current.width = W;
      glow.current.height = H;
      paintScene(c.getContext('2d'), glow.current.getContext('2d'), W, H);

    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        raf = requestAnimationFrame(paint);
      }, 140);
    };
    raf = requestAnimationFrame(paint);
    const ro = new ResizeObserver(schedule);
    if (frameRef.current) ro.observe(frameRef.current);
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      ro.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, [frameRef]);

  return (
    <div className="scene-inner" aria-hidden="true">
      <canvas ref={inner} className="scene-layer" />
      <canvas ref={glow} className="scene-layer scene-glow" />
    </div>
  );
}
