/* A section of the HUD. It has no box of its own: the scene and the veil behind it are the surface,
   so sections sit in the world instead of hovering over it (ADR 0003). */
export function HudPanel({ as: Tag = 'div', label, className = '', children, ...rest }) {
  return (
    <Tag className={`hud ${className}`} {...rest}>
      {label && <p className="label">{label}</p>}
      {children}
    </Tag>
  );
}
