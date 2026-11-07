import { useRef, useState } from 'react';
import { ChartTip, useChartTip } from './ChartTip.jsx';
import { axis } from './history.js';

/* One measure over time, so one colour and no legend: the title says what it is. Each column's whole height is
   its hover target, and the table underneath has every value for anyone who can't hover. */
export function ColumnChart({ title, unit, data, tone, fallback, tickUnit, labelEvery, firstColumn }) {
  const { top, ticks } = axis(Math.max(0, ...data.map((d) => d.value)), fallback, tickUnit);
  const { box, tip, show, hide } = useChartTip();
  const [active, setActive] = useState(data.length - 1);
  const columns = useRef([]);
  const showColumn = (i) => show(columns.current[i], `${data[i].value} ${unit}`, data[i].detail);
  const move = (e) => {
    const step = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
    const to = active + (step ?? 0);
    if (!step || to < 0 || to >= data.length) return;
    e.preventDefault();
    setActive(to);
    columns.current[to].focus();
  };

  return (
    <div className="stack">
      <div className="chart" ref={box}>
        <div className="chart-plot">
          {ticks.map((v) => (
            <div key={v} className="chart-tick" style={{ bottom: `${(v / top) * 100}%` }} aria-hidden="true"><span>{v}</span></div>
          ))}
          <div className={`chart-bars tone-${tone}`} role="group" aria-label={title} onKeyDown={move} style={{ gridTemplateColumns: `repeat(${data.length}, minmax(0, 1fr))` }}>
            {data.map((d, i) => (
              <button
                key={d.key}
                ref={(el) => { columns.current[i] = el; }}
                type="button"
                className="chart-col"
                tabIndex={i === active ? 0 : -1}
                aria-label={`${d.detail}: ${d.value} ${unit}`}
                onPointerEnter={() => showColumn(i)}
                onPointerLeave={hide}
                onClick={() => showColumn(i)}
                onFocus={() => { setActive(i); showColumn(i); }}
                onBlur={hide}
              >
                {d.value > 0 && <i style={{ height: `${(d.value / top) * 100}%` }} />}
              </button>
            ))}
          </div>
        </div>
        <div className="chart-x" aria-hidden="true" style={{ gridTemplateColumns: `repeat(${data.length}, minmax(0, 1fr))` }}>
          {data.map((d, i) => (((data.length - 1 - i) % labelEvery === 0 && i >= firstColumn) ? <span key={d.key} style={{ gridColumn: i + 1 }}>{d.label}</span> : null))}
        </div>
        <ChartTip tip={tip} />
      </div>
      <details className="chart-table">
        <summary>Show the numbers</summary>
        <div className="chart-table-scroll">
          <table>
            <thead><tr><th scope="col">When</th><th scope="col">{unit}</th></tr></thead>
            <tbody>{[...data].reverse().map((d) => <tr key={d.key}><td>{d.detail}</td><td>{d.value}</td></tr>)}</tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
