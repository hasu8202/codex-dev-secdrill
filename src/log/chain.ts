import { sha256 } from '../engine/sha256'

// 操作ログ。各行に直前のハッシュを含める(ハッシュ連鎖)ので、途中の改ざん・削除・並べ替えが検出できる。
export type LogType = 'start' | 'exec' | 'submit' | 'hint' | 'reset'

export interface LogEntry {
  seq: number
  at: string
  attempt: string
  type: LogType
  challengeId: string
  seed: number
  input: string
  output: string
  solved: boolean
  prev: string
  hash: string
}

export const GENESIS = '0'.repeat(64)

type Body = Omit<LogEntry, 'hash'>

function hashOf(body: Body): string {
  return sha256(
    JSON.stringify([body.seq, body.at, body.attempt, body.type, body.challengeId, body.seed, body.input, body.output, body.solved, body.prev]),
  )
}

export function appendEntry(
  entries: readonly LogEntry[],
  fields: Omit<LogEntry, 'seq' | 'prev' | 'hash'>,
): LogEntry {
  const last = entries[entries.length - 1]
  const body: Body = { ...fields, seq: last ? last.seq + 1 : 1, prev: last ? last.hash : GENESIS }
  return { ...body, hash: hashOf(body) }
}

export interface ChainCheck {
  ok: boolean
  /** 壊れている最初の行(1始まりの seq)。ok のときは undefined */
  brokenAt?: number
  reason?: string
}

export function verifyChain(entries: readonly LogEntry[]): ChainCheck {
  let prev = GENESIS
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i] as LogEntry
    if (e.seq !== i + 1) return { ok: false, brokenAt: e.seq, reason: '連番が飛んでいる(削除・並べ替えの疑い)' }
    if (e.prev !== prev) return { ok: false, brokenAt: e.seq, reason: '直前のハッシュと繋がらない' }
    const { hash, ...body } = e
    if (hashOf(body) !== hash) return { ok: false, brokenAt: e.seq, reason: '内容とハッシュが合わない(改ざんの疑い)' }
    prev = hash
  }
  return { ok: true }
}

export function toJsonl(entries: readonly LogEntry[]): string {
  return entries.map((e) => JSON.stringify(e)).join('\n')
}

export function parseJsonl(text: string): LogEntry[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as LogEntry)
}
