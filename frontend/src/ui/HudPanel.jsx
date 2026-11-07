/* Glass panel with two glowing corner brackets and an iridescent edge that wakes on hover. */
export function HudPanel({ as: Tag = 'div', label, className = '', children, ...rest }) {
  return (
    <Tag className={`hud ${className}`} {...rest}>
      <span className="hud-edge" aria-hidden="true" />
      {label && <p className="label">{label}</p>}
      {children}
    </Tag>
  );
}
