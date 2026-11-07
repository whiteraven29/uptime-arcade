import { useEffect, useMemo, useRef, useState } from 'react';
import { ChartTip, useChartTip } from './ChartTip.jsx';
import { HEAT_STEPS, buildMap, hoursAndMinutes, longDay } from './history.js';

const DAY_NAMES = ['Mon', '', 'Wed', '', 'Fri', '', ''];
const describe = (c) => (c.minutes ? `${hoursAndMinutes(c.minutes)}, ${c.blocks} block${c.blocks === 1 ? '' : 's'}` : 'No focus');

/* A square for every day of the last year, green where focus was used. Greener means more, in fixed steps. */
export function FocusMap({ today, days }) {
  const { cells, months, weeks } = useMemo(() => buildMap(today, days), [today, days]);
  const { box, tip, show, hide } = useChartTip();
  const scroller = useRef(null);
  const [active, setActive] = useState(cells.length - 1);
  const buttons = useRef([]);
  const focused = cells.filter((c) => c.minutes);
  const total = focused.reduce((sum, c) => sum + c.minutes, 0);

  // On a phone only part of the year fits, and the part that matters is now.
  useEffect(() => {
    if (scroller.current) scroller.current.scrollLeft = scroller.current.scrollWidth;
  }, []);

  const showCell = (i) => show(buttons.current[i], describe(cells[i]), longDay(cells[i].date));
  const move = (e) => {
    const step = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 }[e.key];
    const to = e.key === 'Home' ? 0 : e.key === 'End' ? cells.length - 1 : step ? active + step : null;
    if (to === null || to < 0 || to >= cells.length) return;
    e.preventDefault();
    setActive(to);
    buttons.current[to].focus();
  };

  return (
    <div className="stack">
      <p className="small" style={{ margin: 0 }} id="mapSummary">
        {focused.length ? `${focused.length} day${focused.length === 1 ? '' : 's'} with focus in the last year, ${hoursAndMinutes(total)} in all.` : 'Finish a focus block and today turns green.'}
      </p>
      <div className="map-box" ref={box}>
        <div className="map-days" aria-hidden="true">{DAY_NAMES.map((d, i) => <span key={i}>{d}</span>)}</div>
        <div className="map-scroll" ref={scroller} onScroll={hide}>
          <div className="map-months" style={{ '--weeks': weeks }} aria-hidden="true">
            {months.map((m) => <span key={m.column} style={{ gridColumn: m.column + 1 }}>{m.label}</span>)}
          </div>
          {/* Keyboard users get one stop for the whole map and move around it with the arrow keys. */}
          <div className="map-grid" role="group" aria-label="Focus for each day of the last year" onKeyDown={move}>
            {cells.map((c, i) => (
              <button
                key={c.date}
                ref={(el) => { buttons.current[i] = el; }}
                type="button"
                className={`map-cell heat-${c.level}`}
                data-date={c.date}
                data-level={c.level}
                tabIndex={i === active ? 0 : -1}
                aria-label={`${longDay(c.date)}: ${describe(c)}`}
                onPointerEnter={() => showCell(i)}
                onPointerLeave={hide}
                onClick={() => showCell(i)}
                onFocus={() => { setActive(i); showCell(i); }}
                onBlur={hide}
              />
            ))}
          </div>
        </div>
        <ChartTip tip={tip} />
      </div>
      <div className="map-legend">
        <span className="map-key"><i className="map-cell heat-0" />None</span>
        {HEAT_STEPS.map((s) => <span className="map-key" key={s.level}><i className={`map-cell heat-${s.level}`} />{s.label}</span>)}
      </div>
      <details className="chart-table">
        <summary>Show the days as a list</summary>
        {focused.length ? (
          <div className="chart-table-scroll">
            <table>
              <thead><tr><th scope="col">Day</th><th scope="col">Focus</th><th scope="col">Blocks</th></tr></thead>
              <tbody>{[...focused].reverse().map((c) => <tr key={c.date}><td>{longDay(c.date)}</td><td>{hoursAndMinutes(c.minutes)}</td><td>{c.blocks}</td></tr>)}</tbody>
            </table>
          </div>
        ) : <p className="small">No days yet.</p>}
      </details>
    </div>
  );
}
