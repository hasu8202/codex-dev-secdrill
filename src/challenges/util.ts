import type { ExecResult, Verdict } from '../engine/types'
import { unsupported } from '../engine/types'

export const out = (...lines: string[]): ExecResult => ({ lines })
export const solvedOut = (...lines: string[]): ExecResult => ({ lines, solved: true })

export function tokens(line: string): string[] {
  return line.trim().split(/\s+/).filter(Boolean)
}

/** 先頭の語を取り、残りを(空白を保ったまま)返す */
export function splitCommand(line: string): { cmd: string; rest: string } {
  const t = line.trim()
  const i = t.search(/\s/)
  return i < 0 ? { cmd: t, rest: '' } : { cmd: t.slice(0, i), rest: t.slice(i).trim() }
}

export const noSubmit = (): Verdict => unsupported()
export const noExec = (): ExecResult => unsupported()

export function json(value: unknown): string {
  return JSON.stringify(value)
}
