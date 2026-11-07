import { useEffect, useRef } from 'react';
import { paintScene } from './scene/paintScene.js';

const MAX_DPR = 1.5;

/* The inner canvases fill the glass frame, sharp. The outer canvas repeats the same picture, zoomed
   and dimmed behind the frame, which gives the floating-window depth of the look. */
export function SceneBackdrop({ frameRef, outerRef: outer }) {
  const inner = useRef(null);
  const lava = useRef(null);

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
      lava.current.width = W;
      lava.current.height = H;
      paintScene(c.getContext('2d'), lava.current.getContext('2d'), W, H);

      const o = outer.current;
      const vw = Math.round(window.innerWidth * dpr);
      const vh = Math.round(window.innerHeight * dpr);
      o.width = vw;
      o.height = vh;
      const octx = o.getContext('2d');
      const zoom = Math.max(vw / W, vh / H) * 1.1;
      const dw = W * zoom;
      const dh = H * zoom;
      const dx = (vw - dw) / 2;
      const dy = (vh - dh) / 2;
      octx.drawImage(c, dx, dy, dw, dh);
      octx.drawImage(lava.current, dx, dy, dw, dh);
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
  }, [frameRef, outer]);

  return (
    <div className="scene-inner" aria-hidden="true">
      <canvas ref={inner} className="scene-layer" />
      <canvas ref={lava} className="scene-layer scene-lava" />
    </div>
  );
}

/* A small painted card image, used by the Deck's feature cards. */
export function SceneThumb({ palette, seed, focus, lava = 0 }) {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current;
    const box = c.getBoundingClientRect();
    const W = Math.round((box.width || 340) * 1.5);
    const H = Math.round((box.height || 120) * 1.5);
    c.width = W;
    c.height = H;
    paintScene(c.getContext('2d'), null, W, H, { palette, seed, focus, lava });
  }, [palette, seed, focus, lava]);
  return <canvas ref={ref} className="thumb" aria-hidden="true" />;
}
