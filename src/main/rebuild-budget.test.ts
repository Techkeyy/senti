import { describe, expect, it } from 'vitest'
import { noteRebuild } from './rebuild-budget'

describe('noteRebuild', () => {
  it('allows 6 rebuilds in 2 minutes and refuses the 7th', () => {
    let times: number[] = []
    for (let i = 0; i < 6; i++) {
      const r = noteRebuild(times, i * 1000)
      expect(r.ok).toBe(true)
      times = r.times
    }
    expect(noteRebuild(times, 6000).ok).toBe(false)
  })
  it('forgets rebuilds older than the window', () => {
    let times: number[] = []
    for (let i = 0; i < 6; i++) times = noteRebuild(times, i * 1000).times
    const r = noteRebuild(times, 130_000)
    expect(r.ok).toBe(true)
    expect(r.times).toEqual([130_000])
  })
})
