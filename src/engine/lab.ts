import { getChallenge } from '../challenges'
import { appendEntry, type LogEntry, type LogType } from '../log/chain'
import type { KV } from './storage'
import { runExec, runSubmit, type ExecOutcome, type SubmitOutcome } from './run'
import { scoreFor } from './score'
import type { Session } from './types'

export interface Input {
  kind: 'exec' | 'submit'
  text: string
}
export interface Progress {
  seed: number
  attempt: string
  inputs: Input[]
  hints: number
  solved: boolean
  /** 解けた時点の入力回数 */
  steps: number
  ratio: number
  score: number
}
export interface TranscriptItem {
  kind: 'exec' | 'submit'
  text: string
  lines: string[]
  ratio?: number
  solved: boolean
}

const LOG_KEY = 'secdrill.v1.log'
const PROGRESS_KEY = 'secdrill.v1.progress'
const BEST_KEY = 'secdrill.v1.best'

function toItem(i: Input, o: ExecOutcome | SubmitOutcome): TranscriptItem {
  return 'ratio' in o
    ? { kind: i.kind, text: i.text, lines: o.messages, ratio: o.ratio, solved: o.solved }
    : { kind: i.kind, text: i.text, lines: o.lines, solved: o.solved }
}

/** 演習の進行・ログ・得点をまとめて扱う。保存先は差し替えられる(テストはメモリ)。 */
export class Lab {
  private entries: LogEntry[]
  private progress: Record<string, Progress>
  private best: Record<string, number>
  private sessions = new Map<string, Session>()
  private transcripts = new Map<string, TranscriptItem[]>()

  constructor(
    private kv: KV,
    private now: () => Date = () => new Date(),
    private randomSeed: () => number = () => Math.floor(Math.random() * 1_000_000_000),
  ) {
    this.entries = this.load<LogEntry[]>(LOG_KEY, [])
    this.progress = this.load<Record<string, Progress>>(PROGRESS_KEY, {})
    this.best = this.load<Record<string, number>>(BEST_KEY, {})
  }

  private load<T>(key: string, fallback: T): T {
    try {
      const raw = this.kv.get(key)
      return raw ? (JSON.parse(raw) as T) : fallback
    } catch {
      return fallback
    }
  }
  private save() {
    this.kv.set(LOG_KEY, JSON.stringify(this.entries))
    this.kv.set(PROGRESS_KEY, JSON.stringify(this.progress))
    this.kv.set(BEST_KEY, JSON.stringify(this.best))
  }

  log(): readonly LogEntry[] {
    return this.entries
  }
  progressOf(id: string): Progress | undefined {
    return this.progress[id]
  }
  bestScore(id: string): number {
    return this.best[id] ?? 0
  }
  totalBest(): number {
    return Object.values(this.best).reduce((a, b) => a + b, 0)
  }

  private append(type: LogType, id: string, p: Progress, input: string, output: string, solved: boolean) {
    this.entries.push(
      appendEntry(this.entries, {
        at: this.now().toISOString(), attempt: p.attempt, type, challengeId: id, seed: p.seed, input, output, solved,
      }),
    )
  }

  /** 挑戦を始める(すでにあれば続きから)。入力履歴から模擬システムの状態を作り直す。 */
  begin(id: string, seed?: number): Progress {
    const ch = getChallenge(id)
    if (!ch) throw new Error(`unknown challenge: ${id}`)
    let p = this.progress[id]
    if (!p) {
      p = { seed: seed ?? this.randomSeed(), attempt: `a${this.entries.length + 1}`, inputs: [], hints: 0, solved: false, steps: 0, ratio: 0, score: 0 }
      this.progress[id] = p
      this.append('start', id, p, '', '', false)
      this.save()
    }
    if (!this.sessions.has(id)) {
      const session = ch.create(p.seed)
      const transcript = p.inputs.map((i) => toItem(i, i.kind === 'exec' ? runExec(session, i.text) : runSubmit(session, i.text)))
      this.sessions.set(id, session)
      this.transcripts.set(id, transcript)
    }
    return p
  }

  transcript(id: string): readonly TranscriptItem[] {
    this.begin(id)
    return this.transcripts.get(id) ?? []
  }

  private afterInput(id: string, p: Progress, solved: boolean, ratio: number) {
    const ch = getChallenge(id)!
    if (p.solved) return
    p.ratio = Math.max(p.ratio, ratio)
    p.score = scoreFor(ch, p.inputs.length, p.hints, p.ratio)
    if (solved) {
      p.solved = true
      p.steps = p.inputs.length
      p.ratio = ratio
      p.score = scoreFor(ch, p.steps, p.hints, p.ratio)
      this.best[id] = Math.max(this.best[id] ?? 0, p.score)
    }
  }

  exec(id: string, line: string): TranscriptItem {
    const p = this.begin(id)
    const input: Input = { kind: 'exec', text: line }
    const out = runExec(this.sessions.get(id)!, line)
    p.inputs.push(input)
    this.append('exec', id, p, line, out.output, out.solved)
    this.afterInput(id, p, out.solved, out.solved ? 1 : 0)
    const item = toItem(input, out)
    this.transcripts.get(id)!.push(item)
    this.save()
    return item
  }

  submit(id: string, text: string): TranscriptItem {
    const p = this.begin(id)
    const input: Input = { kind: 'submit', text }
    const out = runSubmit(this.sessions.get(id)!, text)
    p.inputs.push(input)
    this.append('submit', id, p, text, out.output, out.solved)
    this.afterInput(id, p, out.solved, out.ratio)
    const item = toItem(input, out)
    this.transcripts.get(id)!.push(item)
    this.save()
    return item
  }

  /** 次のヒントを開く。返すのは開いた数。 */
  useHint(id: string): number {
    const ch = getChallenge(id)!
    const p = this.begin(id)
    if (p.hints >= ch.hints.length) return p.hints
    p.hints++
    this.append('hint', id, p, String(p.hints), '', false)
    if (!p.solved) p.score = scoreFor(ch, p.inputs.length, p.hints, p.ratio)
    this.save()
    return p.hints
  }

  /** この課題をやり直す。newSeed が true なら別の問題(別シード)になる。 */
  restart(id: string, opts: { newSeed?: boolean; seed?: number } = {}) {
    const p = this.progress[id]
    if (p) this.append('reset', id, p, '', '', false)
    const seed = opts.seed ?? (opts.newSeed || !p ? this.randomSeed() : p.seed)
    delete this.progress[id]
    this.sessions.delete(id)
    this.transcripts.delete(id)
    this.begin(id, seed)
  }

  /** 全課題の進行を初期化する(ログと最高記録は残る)。 */
  resetAll() {
    for (const [id, p] of Object.entries(this.progress)) this.append('reset', id, p, '', '', false)
    this.progress = {}
    this.sessions.clear()
    this.transcripts.clear()
    this.save()
  }

  /** ログ・進行・最高記録をすべて消して、まっさらに戻す。 */
  wipeEverything() {
    this.entries = []
    this.progress = {}
    this.best = {}
    this.sessions.clear()
    this.transcripts.clear()
    this.save()
  }
}
