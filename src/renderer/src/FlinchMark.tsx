/**
 * The flinch mark: a sharp vertical spike with a small dot on top, in ember.
 * Used for every detected startle and nowhere else. Draw it inside an <svg>; `base` is the y of its foot.
 */
export function FlinchMark({ x, base, h, r = 3 }: { x: number; base: number; h: number; r?: number }) {
  return (
    <g className="flinch-mark" aria-hidden="true">
      <line x1={x} x2={x} y1={base} y2={base - h} stroke="var(--ember)" strokeWidth={2} strokeLinecap="round" />
      <circle cx={x} cy={base - h} r={r} fill="var(--ember)" />
    </g>
  )
}

/** Stand-alone 16 px version for legends and lists. */
export function FlinchIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" role="img" aria-label="Flinch mark" className="flinch-icon">
      <FlinchMark x={8} base={15} h={9} r={3} />
    </svg>
  )
}
