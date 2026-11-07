import { useCallback, useRef, useState } from 'react';

/* One tooltip for a chart. It lives outside any scrolling area so it's never cut off, and it only ever adds to
   what the table under the chart already says. The value leads and the label follows. */
export function useChartTip() {
  const box = useRef(null);
  const [tip, setTip] = useState(null);
  const show = useCallback((el, value, label) => {
    if (!box.current) return;
    const outer = box.current.getBoundingClientRect();
    const mark = el.getBoundingClientRect();
    setTip({ value, label, x: mark.left + mark.width / 2 - outer.left, y: mark.top - outer.top, width: outer.width });
  }, []);
  const hide = useCallback(() => setTip(null), []);
  return { box, tip, show, hide };
}

const TIP_HALF_WIDTH = 92;

export function ChartTip({ tip }) {
  if (!tip) return null;
  const left = Math.min(Math.max(tip.x, TIP_HALF_WIDTH), Math.max(TIP_HALF_WIDTH, tip.width - TIP_HALF_WIDTH));
  return (
    <div className="chart-tip" style={{ left, top: tip.y }} aria-hidden="true">
      <b>{tip.value}</b>
      <span>{tip.label}</span>
    </div>
  );
}
