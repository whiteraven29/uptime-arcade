import { useEffect, useRef } from 'react';
import { HudPanel } from './HudPanel.jsx';

/* Full-screen dimmed layer for debriefs, level-ups and the finale. */
export function Overlay({ label, className, children }) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.querySelector('button')?.focus();
  }, []);
  return (
    <div className="over" role="dialog" aria-modal="true" aria-label={label} ref={ref}>
      <HudPanel className={className}>{children}</HudPanel>
    </div>
  );
}
