/* Devices are drawn in code, so nothing here is anyone's logo. */
export function DeviceIcon({ kind }) {
  if (kind === 'pc') {
    return (
      <g className="lab-icon">
        <rect x="-26" y="-24" width="52" height="34" rx="4" />
        <path d="M-8 10V20M8 10V20M-16 22H16" />
      </g>
    );
  }
  if (kind === 'laptop') {
    return (
      <g className="lab-icon">
        <rect x="-22" y="-22" width="44" height="28" rx="3" />
        <path d="M-30 14H30M-26 6-30 14M26 6 30 14" />
      </g>
    );
  }
  if (kind === 'ap') {
    return (
      <g className="lab-icon">
        <rect x="-24" y="2" width="48" height="16" rx="4" />
        <path d="M-14 10H-8M-16 -8A22 22 0 0 1 16 -8M-9 -2A12 12 0 0 1 9 -2M-23 -15A32 32 0 0 1 23 -15" />
      </g>
    );
  }
  if (kind === 'server') {
    return (
      <g className="lab-icon">
        <rect x="-22" y="-28" width="44" height="16" rx="3" />
        <rect x="-22" y="-8" width="44" height="16" rx="3" />
        <rect x="-22" y="12" width="44" height="16" rx="3" />
        <path d="M-14 -20H-6M-14 0H-6M-14 20H-6" />
      </g>
    );
  }
  if (kind === 'router') {
    return (
      <g className="lab-icon">
        <circle r="28" />
        <path d="M-16 0H16M9 -7 16 0 9 7M-9 -7-16 0-9 7M0 -16V16M-7 -9 0 -16 7 -9M-7 9 0 16 7 9" />
      </g>
    );
  }
  if (kind === 'firewall') {
    return (
      <g className="lab-icon">
        <rect x="-28" y="-24" width="56" height="48" rx="3" />
        <path d="M-28 -8H28M-28 8H28M-10 -24V-8M12 -24V-8M0 -8V8M-16 8V24M16 8V24" />
      </g>
    );
  }
  return (
    <g className="lab-icon">
      <rect x="-32" y="-18" width="64" height="36" rx="4" />
      <path d="M-20 -6H20M13 -11 20 -6 13 -1M20 6H-20M-13 1-20 6-13 11" />
      {kind === 'l3switch' && <text x="27" y="-24" textAnchor="middle">L3</text>}
    </g>
  );
}
