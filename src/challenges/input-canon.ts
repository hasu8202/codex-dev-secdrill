import { Rng } from '../engine/rng'
import type { Challenge, Doc } from '../engine/types'
import { noSubmit, out, solvedOut, splitCommand } from './util'

// 入力値検証(攻撃): 「検査」と「使用」の間で入力が変形されると、検査をすり抜けられる。
// 仮想のファイルツリー上だけで動く。実際のファイルシステムには一切触れない。

type Stage =
  | { kind: 'reject'; needles: string[]; ci: boolean }
  | { kind: 'urldecode' }
  | { kind: 'strip'; needle: string }
  | { kind: 'backslash' }

const BASE = '/srv/app/public'

function variants(): Stage[][] {
  return [
    // 検査 → デコード
    [{ kind: 'reject', needles: ['..'], ci: false }, { kind: 'urldecode' }],
    // デコード → 除去(1回だけ)
    [{ kind: 'urldecode' }, { kind: 'strip', needle: '../' }],
    // 検査 → デコード2回
    [{ kind: 'reject', needles: ['..', '%2e'], ci: true }, { kind: 'urldecode' }, { kind: 'urldecode' }],
    // 検査 → 区切り文字の変換
    [{ kind: 'reject', needles: ['../'], ci: false }, { kind: 'backslash' }],
  ]
}

function build(seed: number) {
  const rng = new Rng(seed ^ 0xca404)
  const pipeline = rng.pick(variants())
  const secretDir = rng.pick(['private', 'config', 'vault', 'internal']) + (rng.int(0, 1) ? `_${rng.hex(3)}` : '')
  const token = `KEY-${rng.hex(8)}`
  return { pipeline, secretDir, token }
}

function urldecodeOnce(s: string): string {
  return s.replace(/%([0-9a-fA-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
}

function normalize(path: string): string {
  const stack: string[] = []
  for (const seg of path.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') stack.pop()
    else stack.push(seg)
  }
  return '/' + stack.join('/')
}

function describeStage(s: Stage, n: number): string {
  switch (s.kind) {
    case 'reject':
      return `${n}. 次の文字列を含む入力は拒否する${s.ci ? '(大文字小文字を区別しない)' : ''}: ${s.needles.map((x) => `"${x}"`).join(' / ')}`
    case 'urldecode':
      return `${n}. URL デコード(%XX を文字に直す)を 1 回行う`
    case 'strip':
      return `${n}. 文字列 "${s.needle}" をすべて取り除く(1 回の置換。取り除いた結果は再検査しない)`
    case 'backslash':
      return `${n}. バックスラッシュ(\\)をスラッシュ(/)に置き換える`
  }
}

function docs(seed: number): Doc[] {
  const { pipeline, secretDir } = build(seed)
  return [
    {
      title: '概要',
      kind: 'text',
      body: `静的ファイル配信サービス files.example.test(演習用の架空のサービス)。
公開ディレクトリは ${BASE}。利用者が指定した名前のファイルを返す。

コマンド:
  ls              公開ディレクトリのファイル一覧
  read <名前>     ファイルを読む(行の残り全体が「名前」。空白も含む)
  help

目標: 公開ディレクトリの外にある秘密のファイルを読む。
配置メモ: 秘密の鍵は /srv/app/${secretDir}/key.txt に置いてある(公開ディレクトリの外)。`,
    },
    {
      title: '入力の処理手順(設計書)',
      kind: 'text',
      body: `read の入力 name は、上から順に次の処理を受ける。

${pipeline.map((s, i) => describeStage(s, i + 1)).join('\n')}
${pipeline.length + 1}. 処理後の name を「${BASE}/」の後ろに連結し、"." と ".." を解決した絶対パスのファイルを読む
   (解決したパスが公開ディレクトリの内側かどうかは、この段階では確認しない)

どの段階も、実際のディスクではなく仮想のファイルツリーに対して動く。`,
    },
  ]
}

export const inputCanon: Challenge = {
  id: 'input-canon',
  title: '検査と使用のあいだ',
  domain: 'input',
  mode: 'attack',
  input: 'console',
  difficulty: 3,
  points: 400,
  par: 4,
  summary: '入力は検査されるが、検査のあとで変形される。処理の順序を読み解き、検査を通って外へ出る名前を作る。',
  objective: '公開ディレクトリの外にある /srv/app/…/key.txt の内容を read で読み出す。',
  hints: [
    'read は各段階の経過を表示する。入力が各段階でどう変わるかを観察できる。',
    '「拒否の段階」より後ろにある変形が、拒否された文字列を“作り出して”しまう。順序に注目。',
    '公開ディレクトリから見て、秘密のファイルは 1 つ上のディレクトリの下にある。',
  ],
  docs,
  create(seed) {
    const { pipeline, secretDir, token } = build(seed)
    const files = new Map<string, string>([
      [`${BASE}/index.html`, '<h1>files.example.test</h1>'],
      [`${BASE}/about.txt`, 'これは演習用の架空のサービスです。'],
      [`${BASE}/css/site.css`, 'body { margin: 0 }'],
      [`/srv/app/${secretDir}/key.txt`, token],
      ['/srv/app/app.js', '// server code'],
    ])
    return {
      exec(line) {
        const { cmd, rest } = splitCommand(line)
        if (cmd === 'help') return out('ls / read <名前>')
        if (cmd === 'ls') return out(...[...files.keys()].filter((k) => k.startsWith(BASE + '/')).map((k) => k.slice(BASE.length + 1)))
        if (cmd !== 'read') return out('不明なコマンド。help を参照')
        let name = rest
        const trace = [`入力: ${JSON.stringify(name)}`]
        pipeline.forEach((s, i) => {
          if (s.kind === 'reject') {
            const hay = s.ci ? name.toLowerCase() : name
            const hit = s.needles.find((n) => hay.includes(n))
            trace.push(`  段階${i + 1} 検査: ${hit ? `拒否("${hit}" を含む)` : '通過'}`)
            if (hit) name = ''
            return
          }
          if (name === '') return
          if (s.kind === 'urldecode') name = urldecodeOnce(name)
          else if (s.kind === 'strip') name = name.split(s.needle).join('')
          else name = name.replace(/\\/g, '/')
          trace.push(`  段階${i + 1} 変形後: ${JSON.stringify(name)}`)
        })
        if (name === '') return out(...trace, '400 Bad Request(拒否された)')
        const path = normalize(`${BASE}/${name}`)
        trace.push(`  解決したパス: ${path}`)
        const body = files.get(path)
        if (body === undefined) return out(...trace, '404 Not Found')
        if (path === `/srv/app/${secretDir}/key.txt`) {
          return solvedOut(...trace, '200 OK', body, '', '>>> 公開ディレクトリの外の秘密ファイルを読めた。目標達成。')
        }
        return out(...trace, '200 OK', body)
      },
      submit: noSubmit,
    }
  },
}
