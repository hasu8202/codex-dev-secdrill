import { Rng } from '../engine/rng'
import type { Challenge, Doc } from '../engine/types'
import { json, noSubmit, out, solvedOut, splitCommand } from './util'

// セッション管理(攻撃): ログイン時にセッション ID を作り直し忘れている経路を突く(セッション固定)。
// 仮想の「被害者の閲覧」を動かして、ログインの前後で何が変わるかをトレースで観察する。

const PARAMS = ['sid', 'sessionid', 'jsid', 'sess'] as const
const ROTATING = ['/login', '/login/mfa']
const OTHER = ['/login/link', '/sso/start', '/login/passkey']
const LABEL: Record<string, string> = {
  '/login': 'パスワードでログイン',
  '/login/mfa': 'パスワード+確認コードでログイン',
  '/login/link': 'メールのリンクでログイン',
  '/sso/start': '社内SSOでログイン',
  '/login/passkey': 'パスキーでログイン',
}

function build(seed: number) {
  const rng = new Rng(seed ^ 0x5e55)
  const param = rng.pick(PARAMS)
  const sloppy = rng.pick(OTHER)
  const paths = rng.shuffle([...ROTATING, ...OTHER])
  return { rng, param, sloppy, paths }
}

function docs(seed: number): Doc[] {
  const { param, sloppy, paths } = build(seed)
  const handlers = paths
    .map((p) => {
      const rotate = p !== sloppy
      return `// ${LABEL[p]}
app.all('${p}', (req, res) => {
  const user = authenticate(req)            // 認証に成功した利用者
  ${rotate ? 'req.session = store.regenerate(req.session)   // セッション ID を新しくする\n  ' : ''}req.session.user = user
  res.redirect('/account')
})`
    })
    .join('\n\n')
  return [
    {
      title: '概要',
      kind: 'text',
      body: `銀行風の Web アプリ bank.example.test(演習用の架空のサービス)。
目標: 被害者(victim)が正規の手順でログインしたあと、攻撃者(あなた)が被害者として /account を開く。
被害者のパスワードや確認コードは知らない。

あなたができること(あなたの“ブラウザ”):
  get <path>      自分のブラウザで GET する。Set-Cookie は自動で保存される。
  phish <url>     被害者に“リンク”を踏ませる。被害者はそのリンクのページを開き、そのページでの通常の手順でログインする。
                   例: phish /login?x=1
  cookie          自分のブラウザの Cookie を表示
  help
被害者のブラウザは最初 Cookie を持っていない。`,
    },
    {
      title: 'サーバーのコード(抜粋)',
      kind: 'code',
      body: `// セッションの取り出し
app.use((req, res, next) => {
  let sid = req.cookies.sid
  // 旧モバイルアプリ互換: Cookie が無いときだけ URL の ${param} を受け付ける
  if (!sid && req.query.${param} && store.has(req.query.${param})) sid = req.query.${param}
  if (!sid || !store.has(sid)) {
    sid = store.create()                    // 新しい匿名セッション
    res.cookie('sid', sid, { httpOnly: true })
  }
  req.session = store.get(sid)
  next()
})

app.get('/account', (req, res) => {
  if (!req.session.user) return res.status(401).end()
  res.json({ user: req.session.user, balance: '…' })
})

${handlers}`,
    },
  ]
}

export const sessionFixation: Challenge = {
  id: 'session-fixation',
  title: '更新されない通行証',
  domain: 'session',
  mode: 'attack',
  input: 'console',
  difficulty: 2,
  points: 300,
  par: 4,
  summary: 'ログインの前後でセッション ID が変わらない経路がある。被害者に“こちらが用意した ID”でログインさせる。',
  objective: '被害者がログインしたあと、あなたの Cookie だけで被害者の /account を開く。',
  hints: [
    'まず自分のブラウザで GET / して、サーバーが発行した正規のセッション ID を手に入れる。',
    'サーバーは Cookie が無い人に限って、URL のパラメータで渡された“既存の”ID を引き継ぐ。',
    '全部のログイン経路が ID を作り直すわけではない。コードで regenerate が無い経路を探し、そのページに ID 付きのリンクを踏ませる。',
  ],
  docs,
  create(seed) {
    const { param, sloppy } = build(seed)
    const rng = new Rng(seed ^ 0xabc)
    let counter = 0
    const newSid = () => `s_${rng.hex(10)}_${++counter}`
    const store = new Map<string, { user?: string }>()
    let myCookie: string | null = null

    // 他人のブラウザ(Cookie なし)のリクエスト → 使われるセッション ID を返す
    function resolve(cookie: string | null, query: URLSearchParams): { sid: string; adopted: boolean; fresh: boolean } {
      let sid = cookie
      let adopted = false
      const q = query.get(param)
      if (!sid && q && store.has(q)) {
        sid = q
        adopted = true
      }
      if (!sid || !store.has(sid)) {
        sid = newSid()
        store.set(sid, {})
        return { sid, adopted: false, fresh: true }
      }
      return { sid, adopted, fresh: false }
    }

    return {
      exec(line) {
        const { cmd, rest } = splitCommand(line)
        if (cmd === 'help') return out('get <path> / phish <url> / cookie')
        if (cmd === 'cookie') return out(myCookie ? `sid=${myCookie}` : '(Cookie なし)')
        if (cmd === 'get') {
          const url = new URL(rest || '/', 'http://bank.example.test')
          const r = resolve(myCookie, url.searchParams)
          const lines: string[] = []
          if (r.fresh) {
            myCookie = r.sid
            lines.push(`Set-Cookie: sid=${r.sid}; HttpOnly`)
          }
          if (url.pathname === '/account') {
            const user = store.get(r.sid)?.user
            if (!user) return out(...lines, '401 Unauthorized')
            const body = json({ user, balance: '1,204,300 円' })
            return solvedOut(...lines, '200 OK', body, '', `>>> あなたの Cookie で ${user} の口座を開けた。目標達成。`)
          }
          return out(...lines, '200 OK')
        }
        if (cmd === 'phish') {
          const url = new URL(rest || '/', 'http://bank.example.test')
          const r = resolve(null, url.searchParams)
          const lines = [`[被害者] GET ${url.pathname}${url.search}`]
          if (r.adopted) lines.push(`[被害者] サーバーが URL の ${param} を採用 → セッション ${r.sid} で閲覧`)
          else if (r.fresh) lines.push(`[被害者] サーバーは URL の ID を採用せず、新しいセッション ${r.sid} を発行`)
          if (!(url.pathname in LABEL)) {
            lines.push('[被害者] ログインページではないので、見ただけで帰った。')
            return out(...lines)
          }
          lines.push(`[被害者] ${LABEL[url.pathname]}(正規の手順)`)
          const rotates = url.pathname !== sloppy
          const session = store.get(r.sid)!
          if (rotates) {
            store.delete(r.sid)
            const next = newSid()
            store.set(next, { user: 'victim' })
            lines.push(`[被害者] ログイン成功。サーバーはセッション ID を ${r.sid} → ${next} に作り直した`)
          } else {
            session.user = 'victim'
            lines.push(`[被害者] ログイン成功。セッション ID は ${r.sid} のまま`)
          }
          return out(...lines)
        }
        return out('不明なコマンド。help を参照')
      },
      submit: noSubmit,
    }
  },
}
