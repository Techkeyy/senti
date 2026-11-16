import { presage } from '@smartspectra/node-sdk/messages'
import type { DecodedMetrics } from './sensing'

const ExpressionType = presage.smartspectra.ExpressionType as unknown as Record<number, string>
const exprName = (t: number): string => ExpressionType[t] ?? String(t)

interface Seg {
  ms: number
  counts: Record<string, number>
  pulse: number[]
  pulseConf: number[]
  pulseStable: number
  breath: number[]
  hrv: Record<'rmssd' | 'sdnn' | 'meanNn' | 'baevsky', number[]>
  blinks: number
  talkYes: number
  talkN: number
  expr: Record<string, number[]>
  nonNeutral: number[]
  valid: Record<string, number>
}

const newSeg = (): Seg => ({
  ms: 0,
  counts: {},
  pulse: [],
  pulseConf: [],
  pulseStable: 0,
  breath: [],
  hrv: { rmssd: [], sdnn: [], meanNn: [], baevsky: [] },
  blinks: 0,
  talkYes: 0,
  talkN: 0,
  expr: {},
  nonNeutral: [],
  valid: {}
})

const mean = (a: number[]): number | null => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null)
const r = (v: number | null, d = 2): number | null => (v == null ? null : +v.toFixed(d))

export interface Live {
  pulse: { value: number; confidence: number; stable: boolean } | null
  breath: { value: number; confidence: number } | null
  blink: boolean | null
  talk: boolean | null
  expr: { name: string; value: number } | null
}

/** Per-segment aggregation, same measures as the Node probe. Dedupes packets by (group, timestamp). */
export class SegmentStats {
  live: Live = { pulse: null, breath: null, blink: null, talk: null, expr: null }
  private segs: Record<string, Seg> = {}
  private seg = ''
  private segStart = 0
  private seen = new Set<string>()
  private lastBlink = false

  constructor(
    private nowMs: () => number,
    first: string
  ) {
    this.setSegment(first)
  }

  private S(): Seg {
    return (this.segs[this.seg] ??= newSeg())
  }

  setSegment(name: string): void {
    if (this.seg) this.S().ms += this.nowMs() - this.segStart
    this.segStart = this.nowMs()
    this.seg = name
    this.S()
  }

  private fresh(g: string, ts: unknown): boolean {
    const k = `${g}:${String(ts)}`
    if (this.seen.has(k)) return false
    this.seen.add(k)
    return true
  }

  validation(name: string): void {
    const v = this.S().valid
    v[name] = (v[name] ?? 0) + 1
  }

  // The generated protobuf types mark every field optional/nullable; fields are read defensively below.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ingest(decoded: DecodedMetrics): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m: any = decoded
    const s = this.S()
    const c = (g: string): number => (s.counts[g] = (s.counts[g] ?? 0) + 1)
    for (const x of m.cardio?.pulseRate ?? [])
      if (this.fresh('pulse', x.timestamp)) {
        c('pulseRate')
        s.pulse.push(x.value)
        s.pulseConf.push(x.confidence)
        if (x.stable) s.pulseStable++
        this.live.pulse = { value: x.value, confidence: x.confidence, stable: !!x.stable }
      }
    for (const x of m.breathing?.rate ?? [])
      if (this.fresh('breath', x.timestamp)) {
        c('breathingRate')
        s.breath.push(x.value)
        this.live.breath = { value: x.value, confidence: x.confidence }
      }
    for (const x of m.cardio?.hrv ?? [])
      if (this.fresh('hrv', x.timestamp)) {
        c('hrv')
        for (const k of ['rmssd', 'sdnn', 'meanNn', 'baevsky'] as const) s.hrv[k].push(x[k])
      }
    for (const x of m.cardio?.arterialPressureTrace ?? []) if (this.fresh('ap', x.timestamp)) c('arterialPressureTrace')
    for (const x of m.face?.blinking ?? [])
      if (this.fresh('blink', x.timestamp)) {
        c('blinking')
        if (x.detected && !this.lastBlink) s.blinks++
        this.lastBlink = !!x.detected
        this.live.blink = !!x.detected
      }
    for (const x of m.face?.talking ?? [])
      if (this.fresh('talk', x.timestamp)) {
        c('talking')
        s.talkN++
        if (x.detected) s.talkYes++
        this.live.talk = !!x.detected
      }
    for (const x of m.face?.expression ?? [])
      if (this.fresh('expr', x.timestamp)) {
        c('expressions')
        let nn = 0
        let top: { name: string; value: number } | null = null
        for (const sc of x.scores) {
          const n = exprName(sc.type)
          ;(s.expr[n] ??= []).push(sc.confidence)
          if (n !== 'NEUTRAL') nn += sc.confidence
          if (!top || sc.confidence > top.value) top = { name: n, value: sc.confidence }
        }
        s.nonNeutral.push(nn)
        this.live.expr = top
      }
    for (const x of m.face?.landmarks ?? []) if (this.fresh('lm', x.timestamp)) c('landmarks')
  }

  summarize(): Record<string, unknown> {
    this.S().ms += this.nowMs() - this.segStart
    this.segStart = this.nowMs()
    const out: Record<string, unknown> = {}
    for (const [name, s] of Object.entries(this.segs)) {
      const min = s.ms / 60000
      out[name] = {
        durationSec: r(s.ms / 1000, 1),
        counts: s.counts,
        meanPulse: r(mean(s.pulse)),
        meanPulseConfidence: r(mean(s.pulseConf)),
        stablePulseSamples: s.pulseStable,
        meanBreathing: r(mean(s.breath)),
        hrv: s.hrv.rmssd.length
          ? {
              n: s.hrv.rmssd.length,
              rmssd: r(mean(s.hrv.rmssd)),
              sdnn: r(mean(s.hrv.sdnn)),
              meanNn: r(mean(s.hrv.meanNn)),
              baevsky: r(mean(s.hrv.baevsky))
            }
          : null,
        blinks: s.blinks,
        blinksPerMin: min > 0 ? r(s.blinks / min) : null,
        talkingFraction: s.talkN ? r(s.talkYes / s.talkN) : null,
        expressionMeanPct: Object.fromEntries(Object.entries(s.expr).map(([k, v]) => [k, r(mean(v))])),
        nonNeutralMeanPct: r(mean(s.nonNeutral)),
        validationProblems: s.valid
      }
    }
    return out
  }
}
