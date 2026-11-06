import { Rng } from '../engine/rng'
import type { Challenge, Doc } from '../engine/types'
import { json, noSubmit, out, solvedOut, splitCommand, tokens } from './util'

// 認可(攻撃): 取り消した共有が、一部の経路だけ有効なまま残っている。
// 画面で「主の経路は 403 なのに別の経路は通る」という認可の不統一を、コードを読んで突き止める。

const SUBS = ['export', 'history', 'receipt'] as const
type Sub = (typeof SUBS)[number]
const GOOD = ['shareAllowsRead', 'shareAllowsReadStrict'] as const

interface World {
  rng: Rng
  buggy: Sub
  helperOf: Record<Sub, string>
  target: string
  decoy: string
  own: string
}

function build(seed: number): World {
  const rng = new Rng(seed ^ 0x51a7e)
  const buggy = rng.pick(SUBS)
  const helperOf = {} as Record<Sub, string>
  for (const s of SUBS) helperOf[s] = s === buggy ? 'legacyShareCheck' : rng.pick(GOOD)
  return {
    rng, buggy, helperOf,
    target: `inv_${rng.hex(6)}`, decoy: `inv_${rng.hex(6)}`, own: `inv_${rng.hex(6)}`,
  }
}

function docs(seed: number): Doc[] {
  const w = build(seed)
  const order = new Rng(seed).shuffle([...SUBS])
  const handlers = order
    .map((s) => `app.get('/invoices/:id/${s}', requireLogin, (req, res) => {
  const inv = invoices.get(req.params.id)
  if (!inv) return res.status(404).end()
  if (!${w.helperOf[s]}(req.user, inv)) return res.status(403).end()
  return res.json(render_${s}(inv))
})`)
    .join('\n\n')
  return [
    {
      title: 'API 仕様',
      kind: 'text',
      body: `請求書サービス billing.example.test(演習用の架空のサービス)

認証: login <user> で利用者を切り替える(alice = 取引先 acme の一般会員)。
GET /activity               自分の組織に関するお知らせ
GET /invoices               自分の組織の請求書の一覧
GET /invoices/:id           請求書の詳細
GET /invoices/:id/export    CSV 書き出し
GET /invoices/:id/history   変更履歴
GET /invoices/:id/receipt   領収書

方針(設計書より):
- 請求書は発行元の組織のもの。他の組織へは「共有」したときだけ読める。
- 共有は発行元がいつでも「取り消し(revoked)」できる。取り消した後は、どの経路からも読めてはならない。
- 請求書 ID は推測できない(連番ではない)。`,
    },
    {
      title: '認可ヘルパー(抜粋)',
      kind: 'code',
      body: `// 共有を根拠にした閲覧可否。利用者の組織 = user.org
function shareAllowsRead(user, inv) {
  if (user.org === inv.org) return true
  const s = shares.find((s) => s.invoice === inv.id && s.to === user.org)
  return Boolean(s) && !s.revoked
}

// 共有された請求書を、厳密に判定する版(監査ログつき)
function shareAllowsReadStrict(user, inv) {
  if (user.org === inv.org) return true
  const s = shares.find((s) => s.invoice === inv.id && s.to === user.org)
  if (s?.revoked) auditLog('denied: revoked share', user, inv)
  return Boolean(s) && !s.revoked
}

// 旧システム互換。共有があれば読める
function legacyShareCheck(user, inv) {
  if (user.org === inv.org) return true
  return shares.some((s) => s.invoice === inv.id && s.to === user.org)
}

app.get('/invoices/:id', requireLogin, (req, res) => {
  const inv = invoices.get(req.params.id)
  if (!inv) return res.status(404).end()
  if (!shareAllowsRead(req.user, inv)) return res.status(403).end()
  return res.json(inv)
})

${handlers}`,
    },
  ]
}

export const authzStaleShare: Challenge = {
  id: 'authz-stale-share',
  title: '取り消したはずの共有',
  domain: 'authz',
  mode: 'attack',
  input: 'console',
  difficulty: 2,
  points: 300,
  par: 5,
  summary: '共有を取り消された請求書が、別の経路からはまだ読めてしまう。コードを読んで、読める経路を突き止める。',
  objective: 'alice として、取引先 borealis から共有が取り消された請求書の「機密項目(internal_margin)」を読み出す。',
  hints: [
    '請求書の ID は、alice が正当に受け取った「お知らせ」の中にある。まず GET /activity。',
    '詳細(GET /invoices/:id)は 403 になる。これは取り消しが正しく効いている証拠。',
    '認可ヘルパーは3種類ある。どの経路がどのヘルパーを呼んでいるか、コードを突き合わせる。',
  ],
  docs,
  create(seed) {
    const w = build(seed)
    let user: string | null = null
    const target = {
      id: w.target, org: 'borealis', amount: 128000, internal_margin: `${w.rng.int(12, 38)}%`, note: 'Q3 consulting',
    }
    const decoy = { id: w.decoy, org: 'borealis', amount: 54000, internal_margin: '—', note: 'training' }
    const own = { id: w.own, org: 'acme', amount: 9800, internal_margin: '—', note: 'stationery' }
    const all = [target, decoy, own]
    const shares = [
      { invoice: target.id, to: 'acme', revoked: true },
      { invoice: decoy.id, to: 'acme', revoked: false },
    ]
    const find = (id: string) => all.find((i) => i.id === id)
    const allows = (helper: string, inv: (typeof all)[number]) => {
      if (inv.org === 'acme') return true
      const s = shares.find((x) => x.invoice === inv.id && x.to === 'acme')
      return helper === 'legacyShareCheck' ? Boolean(s) : Boolean(s) && !s!.revoked
    }
    return {
      exec(line) {
        const { cmd, rest } = splitCommand(line)
        if (cmd === 'help') return out('login <user> / whoami / GET <path>')
        if (cmd === 'whoami') return out(user ? `${user} (org=acme)` : '(未ログイン)')
        if (cmd === 'login') {
          if (rest !== 'alice') return out('利用できる利用者: alice')
          user = 'alice'
          return out('ログインしました: alice (org=acme, role=member)')
        }
        if (cmd.toUpperCase() !== 'GET') return out('不明なコマンド。help を参照')
        if (!user) return out('401 Unauthorized')
        const path = tokens(rest)[0] ?? ''
        if (path === '/activity') {
          return out(
            json([
              { at: '2026-09-02', text: `borealis が請求書 ${decoy.id} を acme と共有しました` },
              { at: '2026-09-14', text: `borealis が請求書 ${target.id} を acme と共有しました` },
              { at: '2026-10-01', text: `acme が請求書 ${own.id} を発行しました` },
            ]),
          )
        }
        if (path === '/invoices') return out(json([{ id: own.id, amount: own.amount }]))
        const m = /^\/invoices\/([^/]+)(?:\/(export|history|receipt))?$/.exec(path)
        if (!m) return out('404 Not Found')
        const inv = find(m[1]!)
        if (!inv) return out('404 Not Found')
        const sub = m[2] as Sub | undefined
        const helper = sub ? w.helperOf[sub] : 'shareAllowsRead'
        if (!allows(helper, inv)) return out('403 Forbidden')
        const body = sub ? { view: sub, ...inv } : inv
        const leaked = inv.id === target.id && inv.internal_margin !== '—'
        return leaked ? solvedOut('200 OK', json(body), '', '>>> 取り消された共有の機密項目が読み出せた。目標達成。') : out('200 OK', json(body))
      },
      submit: noSubmit,
    }
  },
}
