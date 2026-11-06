import type { Lab } from '../engine/lab'
import { verifyChain, type ChainCheck, type LogEntry } from './chain'
import { replayLog, type AttemptResult } from './replay'

// 友達と結果を交換するためのファイル。ログ全体を含むので、受け取った側が連鎖と再生で検証できる。
export const RESULT_FORMAT = 'secdrill-result/1'

export interface ResultFile {
  format: typeof RESULT_FORMAT
  player: string
  exportedAt: string
  entries: LogEntry[]
}

export interface Imported {
  player: string
  importedAt: string
  chain: ChainCheck
  results: AttemptResult[]
}

export function exportResult(lab: Lab, player: string, now = new Date()): string {
  const file: ResultFile = { format: RESULT_FORMAT, player, exportedAt: now.toISOString(), entries: [...lab.log()] }
  return JSON.stringify(file, null, 1)
}

export function importResult(text: string, now = new Date()): { ok: true; imported: Imported } | { ok: false; error: string } {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, error: 'JSON として読めません' }
  }
  const f = data as Partial<ResultFile>
  if (!f || f.format !== RESULT_FORMAT || !Array.isArray(f.entries) || typeof f.player !== 'string') {
    return { ok: false, error: 'SecDrill の結果ファイルではありません' }
  }
  const chain = verifyChain(f.entries)
  // 連鎖が壊れていても、壊れた位置より前の記録だけは再生して見せる(得点としては扱わない)
  const usable = chain.ok ? f.entries : f.entries.slice(0, Math.max(0, (chain.brokenAt ?? 1) - 1))
  return {
    ok: true,
    imported: { player: f.player.slice(0, 24), importedAt: now.toISOString(), chain, results: replayLog(usable) },
  }
}

/** 得点として数えてよい結果(解けていて、記録が再現と一致し、連鎖が壊れていない) */
export function countable(i: Pick<Imported, 'chain'>, r: AttemptResult): boolean {
  return i.chain.ok && r.solved && r.consistent && !r.abandoned
}

export interface Standing {
  player: string
  score: number
  steps: number
  hints: number
}

/** 同じ課題・同じシードで比べた順位 */
export function headToHead(players: { name: string; imported: Imported }[]): Map<string, Standing[]> {
  const table = new Map<string, Standing[]>()
  for (const { name, imported } of players) {
    const bestBySeed = new Map<string, AttemptResult>()
    for (const r of imported.results) {
      if (!countable(imported, r)) continue
      const key = `${r.challengeId}#${r.seed}`
      const cur = bestBySeed.get(key)
      if (!cur || r.score > cur.score) bestBySeed.set(key, r)
    }
    for (const [key, r] of bestBySeed) {
      table.set(key, [...(table.get(key) ?? []), { player: name, score: r.score, steps: r.steps, hints: r.hints }])
    }
  }
  for (const rows of table.values()) rows.sort((a, b) => b.score - a.score || a.steps - b.steps)
  return table
}
