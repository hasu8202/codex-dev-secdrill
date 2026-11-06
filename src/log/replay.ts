import { getChallenge } from '../challenges'
import { runExec, runSubmit } from '../engine/run'
import { scoreFor } from '../engine/score'
import type { Session } from '../engine/types'
import type { LogEntry } from './chain'

export interface AttemptResult {
  attempt: string
  challengeId: string
  seed: number
  solved: boolean
  steps: number
  hints: number
  ratio: number
  score: number
  abandoned: boolean
  /** ログの出力が、同じ入力を模擬システムに通し直した結果と一致したか */
  consistent: boolean
  note?: string
}

/**
 * ログから挑戦ごとの結果を作り直す。入力を模擬システムに通し直して出力と照合するので、
 * 「解けたことにした」だけのログや、出力を書き換えたログは consistent=false になる。
 */
export function replayLog(entries: readonly LogEntry[]): AttemptResult[] {
  const results = new Map<string, AttemptResult>()
  const sessions = new Map<string, Session>()
  for (const e of entries) {
    let r = results.get(e.attempt)
    if (!r) {
      if (e.type !== 'start') continue
      const ch = getChallenge(e.challengeId)
      if (!ch) continue
      r = {
        attempt: e.attempt, challengeId: e.challengeId, seed: e.seed, solved: false, steps: 0, hints: 0,
        ratio: 0, score: 0, abandoned: false, consistent: true,
      }
      results.set(e.attempt, r)
      sessions.set(e.attempt, ch.create(e.seed))
      continue
    }
    const ch = getChallenge(r.challengeId)
    const session = sessions.get(e.attempt)
    if (!ch || !session) continue
    if (e.type === 'reset') {
      r.abandoned = true
    } else if (e.type === 'hint') {
      if (!r.solved) r.hints++
    } else if (e.type === 'exec' || e.type === 'submit') {
      const out = e.type === 'exec' ? runExec(session, e.input) : runSubmit(session, e.input)
      if (out.output !== e.output || out.solved !== e.solved) {
        r.consistent = false
        r.note = `seq ${e.seq}: 記録された出力が再現と一致しない`
      }
      if (!r.solved) {
        r.steps++
        const ratio = 'ratio' in out ? out.ratio : out.solved ? 1 : 0
        r.ratio = Math.max(r.ratio, ratio)
        if (out.solved) {
          r.solved = true
          r.ratio = ratio
          r.score = scoreFor(ch, r.steps, r.hints, r.ratio)
        }
      }
    }
  }
  return [...results.values()]
}
