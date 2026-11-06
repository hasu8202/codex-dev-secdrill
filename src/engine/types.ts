// 課題・模擬システムの共通の型。
// 模擬システムは「入力(1行の文字列)→出力(文字列の配列)」だけで外と繋がる。
// ファイル・ネットワーク・eval には触れない(すべて模擬データ上で完結)。

export type Domain = 'authz' | 'session' | 'input' | 'api' | 'crypto' | 'design' | 'forensics'
export type Mode = 'attack' | 'defend' | 'audit'
/** console: 1行ずつコマンドを打つ / editor: 文章(ポリシー等)を直して提出 / audit: 回答を書いて提出 */
export type InputKind = 'console' | 'editor' | 'audit'

export interface Doc {
  title: string
  kind: 'text' | 'code' | 'log'
  body: string
}

export interface ExecResult {
  lines: string[]
  /** この入力で目標に到達したか */
  solved?: boolean
}

export interface Verdict {
  /** 0〜1。1なら満点(solved) */
  ratio: number
  solved: boolean
  messages: string[]
}

export interface Session {
  exec(line: string): ExecResult
  submit(text: string): Verdict
}

export interface Challenge {
  id: string
  title: string
  domain: Domain
  mode: Mode
  input: InputKind
  /** 1〜3 */
  difficulty: 1 | 2 | 3
  points: number
  /** 攻撃は理想の入力回数、editor/audit は理想の提出回数 */
  par: number
  summary: string
  objective: string
  docs: (seed: number) => Doc[]
  hints: string[]
  /** editor / audit の入力欄の初期値や書式の見本 */
  initialText?: (seed: number) => string
  create(seed: number): Session
}

export const DOMAIN_LABEL: Record<Domain, string> = {
  authz: '認可・アクセス制御',
  session: 'セッション管理',
  input: '入力値検証',
  api: 'APIセキュリティ',
  crypto: '暗号化・データ保護',
  design: 'セキュアな設計',
  forensics: '監査ログ・インシデント分析',
}

export const MODE_LABEL: Record<Mode, string> = {
  attack: '攻撃(模擬システム上で成立させる)',
  defend: '防御(設計・設定を直す)',
  audit: '監査(欠陥を見つけて答える)',
}

export function unsupported(): never {
  throw new Error('この課題ではこの操作は使えません')
}
