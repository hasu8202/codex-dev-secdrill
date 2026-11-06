import type { Session } from './types'

// セッションへの入力を実行して、ログに残す形(output 文字列)に揃える。画面・ログ・再生検証で共用する。
export interface ExecOutcome {
  lines: string[]
  output: string
  solved: boolean
}
export interface SubmitOutcome {
  messages: string[]
  output: string
  solved: boolean
  ratio: number
}

export function runExec(session: Session, line: string): ExecOutcome {
  try {
    const r = session.exec(line)
    return { lines: r.lines, output: r.lines.join('\n'), solved: Boolean(r.solved) }
  } catch (e) {
    const lines = [e instanceof Error ? e.message : String(e)]
    return { lines, output: lines.join('\n'), solved: false }
  }
}

export function runSubmit(session: Session, text: string): SubmitOutcome {
  try {
    const v = session.submit(text)
    return {
      messages: v.messages,
      output: `ratio=${v.ratio.toFixed(3)}\n${v.messages.join('\n')}`,
      solved: v.solved,
      ratio: v.ratio,
    }
  } catch (e) {
    const messages = [e instanceof Error ? e.message : String(e)]
    return { messages, output: `ratio=0.000\n${messages[0]}`, solved: false, ratio: 0 }
  }
}
