export const PlayIcon = () => (
  <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 1 L11 6 L2.5 11 Z" /></svg>
);
export const TimerIcon = () => (
  <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 0a6 6 0 1 0 0 12A6 6 0 0 0 6 0Zm0 1.6a4.4 4.4 0 1 1 0 8.8 4.4 4.4 0 0 1 0-8.8ZM5.4 3v3.3l2.4 1.4.6-1-1.8-1V3Z" /></svg>
);
export const Logo = () => (
  <svg viewBox="0 0 32 32" aria-hidden="true"><path fill="none" style={{ stroke: 'var(--holo)' }} strokeWidth="2" d="M4 19 13 7l5 3 9-3-5 7 5 3-10 1-6 9-1-8z" /><circle cx="16" cy="12" r="1.4" style={{ fill: 'var(--amber)' }} /></svg>
);

/* The screens' icons in the sidebar, drawn in code on a 20 unit grid with one stroke weight. */
const Line = ({ children }) => (
  <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);
export const DeckIcon = () => (
  <Line><rect x="2.5" y="2.5" width="6.5" height="6.5" rx="1.2" /><rect x="11" y="2.5" width="6.5" height="4.5" rx="1.2" /><rect x="11" y="9" width="6.5" height="8.5" rx="1.2" /><rect x="2.5" y="11" width="6.5" height="6.5" rx="1.2" /></Line>
);
export const FocusIcon = () => (
  <Line><circle cx="10" cy="11" r="6.5" /><path d="M10 7.5V11l2.4 1.6M8 2.5h4M15.3 5.2l1.2-1.2" /></Line>
);
export const MissionsIcon = () => (
  <Line><path d="M4.5 17.5V3" /><path d="M4.5 3.5h9.5l-2.2 3.2 2.2 3.3H4.5" /></Line>
);
export const RewardsIcon = () => (
  <Line><path d="M7 2.5 5.5 7M13 2.5 14.5 7" /><circle cx="10" cy="12" r="5" /><path d="m10 9.4.9 1.7 1.9.3-1.4 1.3.3 1.9-1.7-.9-1.7.9.3-1.9-1.4-1.3 1.9-.3Z" /></Line>
);
export const ProfileIcon = () => (
  <Line><circle cx="10" cy="7" r="3.5" /><path d="M3.5 17.5c.8-3.3 3.4-5 6.5-5s5.7 1.7 6.5 5" /></Line>
);
export const SystemIcon = () => (
  <Line><path d="M3 5.5h7M14 5.5h3M3 10h2M9 10h8M3 14.5h9M16 14.5h1" /><circle cx="12" cy="5.5" r="1.8" /><circle cx="7" cy="10" r="1.8" /><circle cx="14" cy="14.5" r="1.8" /></Line>
);
export const CollapseIcon = () => (
  <Line><rect x="2.5" y="3" width="15" height="14" rx="2" /><path d="M7.5 3v14M13.5 8l-2 2 2 2" /></Line>
);
