import type { ReactNode } from 'react'

/** A flat line with one spike: chalk line, ember spike. Not a logo with depth, just the idea of the product. */
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size * 0.57} viewBox="0 0 28 16" aria-hidden="true">
      <path d="M1 12 H10" stroke="var(--text)" strokeWidth={1.75} strokeLinecap="round" fill="none" />
      <path d="M10 12 L12.5 2 L15 12" stroke="var(--ember)" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M15 12 H27" stroke="var(--text)" strokeWidth={1.75} strokeLinecap="round" fill="none" />
    </svg>
  )
}

export function Wordmark() {
  return (
    <div className="wordmark">
      <Mark />
      <span>Senti</span>
    </div>
  )
}

export function Shell({ children, right, width, bare }: { children: ReactNode; right?: ReactNode; width?: 'mid' | 'narrow'; bare?: boolean }) {
  return (
    <div className="shell">
      <header className="topbar">
        <Wordmark />
        <div className="row">{right}</div>
      </header>
      {bare ? <main style={{ flex: 1 }}>{children}</main> : <main className={`content${width ? ` ${width}` : ''}`}>{children}</main>}
    </div>
  )
}
