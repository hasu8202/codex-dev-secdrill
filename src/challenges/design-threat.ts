import { Rng } from '../engine/rng'
import type { Challenge, Doc } from '../engine/types'
import { noExec } from './util'

// セキュアな設計(監査): パスワード再設定の設計書をレビューし、欠陥を指摘して対策を選ぶ。
// 欠陥と“問題なさそうに見えて実は問題ない”記述が混ざっている。シードで出題が変わる。

const MITIGATIONS: Record<string, string> = {
  A: 'トークンを暗号論的な乱数で 128bit 以上にする',
  B: '使用後・パスワード変更後・新しい発行時に、そのトークンを即座に無効にする',
  C: '登録の有無にかかわらず、同じ応答・同じ応答時間にする',
  D: 'メールのリンクのホスト名は、固定の設定値から組み立てる',
  E: '試行回数を制限し、超えたらトークンを失効させる',
  F: '秘密の質問をやめ、復旧コードなど別の要素で本人確認する',
  G: 'リンクを開いたらトークンをセッションに移して URL から消し、Referrer-Policy を no-referrer にする',
  H: '再設定後に既存の全セッションを失効し、本人に通知する',
}

interface Item {
  text: string
  /** 欠陥なら対策の記号。問題なしは null */
  fix: string | null
}

const FLAWS: Item[] = [
  { text: '再設定トークンは 6 桁の数字で、15 分間有効。', fix: 'A' },
  { text: '再設定トークンは「発行時刻のミリ秒」を MD5 したもの。', fix: 'A' },
  { text: '再設定トークンは、パスワードを変更したあとも期限までは使える(同じ人が別のパスワードに何度でも変えられる)。', fix: 'B' },
  { text: '新しく再設定を依頼しても、古いトークンは期限まで有効なまま残る。', fix: 'B' },
  { text: '再設定の依頼画面は、未登録のメールアドレスには「そのアドレスは登録されていません」と表示する。', fix: 'C' },
  { text: '登録済みのアドレスだけ、メール送信の処理のぶん応答が 800ms 遅い。未登録は即座に返る。', fix: 'C' },
  { text: '再設定メールのリンクは、依頼を受けた HTTP リクエストの Host ヘッダーを使って組み立てる。', fix: 'D' },
  { text: '再設定の確認 API(トークン+新パスワード)に、試行回数の制限は設けていない。', fix: 'E' },
  { text: 'メールに加えて「最初のペットの名前」を答えれば、メールなしでも再設定できる。', fix: 'F' },
  { text: '再設定ページには外部の解析スクリプトを読み込んでおり、リンクのトークンは URL のクエリに載っている。', fix: 'G' },
  { text: 'パスワードを再設定したあとも、すでにログイン中の端末のセッションはそのまま使える。', fix: 'H' },
]

const SOUND: Item[] = [
  { text: 'トークンは暗号論的乱数 256bit で、DB にはハッシュだけを保存する。', fix: null },
  { text: 'トークンは 1 回使うか、新しいトークンを発行した時点で無効になる。', fix: null },
  { text: '依頼画面は、登録の有無にかかわらず「該当すれば案内を送りました」と同じ文面・同じ待ち時間で返す。', fix: null },
  { text: 'リンクのホスト名は環境変数 BASE_URL から作り、リクエストの値は使わない。', fix: null },
  { text: '確認 API はトークンごとに 5 回まで失敗できる。超えたらトークンは失効する。', fix: null },
  { text: '再設定が完了したら、全端末のセッションを失効し、本人のメールに通知する。', fix: null },
  { text: '再設定メールは、アカウントに登録済みのアドレスにだけ送る。', fix: null },
  { text: 'トークンの有効期限は 15 分。', fix: null },
]

function build(seed: number): { items: Item[] } {
  const rng = new Rng(seed ^ 0xde5164)
  // 欠陥は対策の種類ごとに 1 つずつ(A〜H で 6 種類)選び、問題なしを 4 つ混ぜる
  const byFix = new Map<string, Item[]>()
  for (const f of FLAWS) byFix.set(f.fix!, [...(byFix.get(f.fix!) ?? []), f])
  const keys = rng.shuffle([...byFix.keys()]).slice(0, 6)
  const flaws = keys.map((k) => rng.pick(byFix.get(k)!))
  const sound = rng.shuffle(SOUND).slice(0, 4)
  return { items: rng.shuffle([...flaws, ...sound]) }
}

/** テスト用: 番号 → 正しい対策の記号。静的アプリなのでソースを読めば分かる点は割り切り(README に記載) */
export function designThreatKey(seed: number): Map<number, string> {
  const key = new Map<number, string>()
  build(seed).items.forEach((it, i) => {
    if (it.fix) key.set(i + 1, it.fix)
  })
  return key
}

function docs(seed: number): Doc[] {
  const { items } = build(seed)
  return [
    {
      title: '設計書(レビュー対象)',
      kind: 'text',
      body: `パスワード再設定フロー 設計書 v0.9(演習用の架空のサービス)

概要: 利用者がメールアドレスを入力すると、再設定リンクがメールで届く。リンクを開いて新しいパスワードを設定する。

記述(番号は回答で使う):
${items.map((it, i) => `  ${i + 1}. ${it.text}`).join('\n')}`,
    },
    {
      title: '対策の候補',
      kind: 'text',
      body: Object.entries(MITIGATIONS)
        .map(([k, v]) => `  ${k}. ${v}`)
        .join('\n'),
    },
  ]
}

export const designThreat: Challenge = {
  id: 'design-threat',
  title: '再設定フローの設計レビュー',
  domain: 'design',
  mode: 'audit',
  input: 'audit',
  difficulty: 2,
  points: 300,
  par: 2,
  summary: 'パスワード再設定の設計書から、危険な記述だけを見抜き、それぞれに合う対策を選ぶ。安全な記述を欠陥と呼ぶと減点。',
  objective: '欠陥のある記述の番号と、合う対策を「番号=記号」の形で全部答える。',
  hints: [
    '欠陥は 6 つ。残りの 4 つは、そのままで問題ない記述。',
    '対策は 1 つの記述に 1 つ。トークンの「強さ」「寿命」「試行回数」「漏れ方」を別々に見る。',
    '“登録の有無が分かる”のは、メッセージだけでなく、応答の時間でも起こる。',
  ],
  docs,
  initialText: () => '# 1行に1つ。欠陥の番号=対策の記号。例:\n3=B\n',
  create(seed) {
    const truth = designThreatKey(seed)
    return {
      exec: noExec,
      submit(text) {
        const answers = new Map<number, string>()
        const problems: string[] = []
        text.split('\n').forEach((raw, idx) => {
          const line = raw.replace(/#.*/, '').trim()
          if (!line) return
          const m = /^(\d+)\s*=\s*([A-H])$/i.exec(line)
          if (!m) {
            problems.push(`${idx + 1}行目: 「番号=記号」の形で書いてください(例: 3=B)`)
            return
          }
          answers.set(Number(m[1]), m[2]!.toUpperCase())
        })
        if (problems.length) return { ratio: 0, solved: false, messages: problems }
        let right = 0
        let falseAlarm = 0
        let wrongFix = 0
        for (const [n, fix] of answers) {
          const want = truth.get(n)
          if (want === undefined) falseAlarm++
          else if (want === fix) right++
          else wrongFix++
        }
        const missed = truth.size - right - wrongFix
        const solved = right === truth.size && falseAlarm === 0
        const ratio = solved ? 1 : Math.max(0, (right - 0.5 * falseAlarm) / truth.size) * 0.5
        return {
          ratio,
          solved,
          messages: solved
            ? [`欠陥 ${truth.size} 件をすべて正しく指摘し、対策も合っている。`]
            : [
                `正解 ${right} / ${truth.size}`,
                `見逃し ${missed}、対策の選び間違い ${wrongFix}、安全なものを欠陥扱い ${falseAlarm}`,
                '(どれが違うかは伏せます。設計書を読み直してください)',
              ],
        }
      },
    }
  },
}
