import type { Challenge } from './types'

/**
 * 得点 = 基礎点 × 達成率 × 効率 × ヒント係数
 * 効率: 理想の回数(par)に対する実際の回数(0.5〜1)。ヒント: 1つ使うごとに −10%(最低 50%)
 */
export function scoreFor(ch: Pick<Challenge, 'points' | 'par'>, steps: number, hints: number, ratio: number): number {
  if (ratio <= 0) return 0
  const efficiency = Math.min(1, Math.max(0.5, ch.par / Math.max(1, steps)))
  const hintFactor = Math.max(0.5, 1 - 0.1 * hints)
  return Math.round(ch.points * ratio * efficiency * hintFactor)
}
