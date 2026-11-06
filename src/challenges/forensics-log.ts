import { Rng } from '../engine/rng'
import type { Challenge, Doc } from '../engine/types'
import { noExec } from './util'

// 監査ログ・インシデント分析(監査): 生成された模擬ログから、侵入の経路・権限昇格・持ち出しを復元する。
// IP は文書用の予約範囲(203.0.113.0/24 など)と私用範囲だけを使う。実在のものではない。

const USERS = ['sato', 'suzuki', 'takahashi', 'tanaka', 'ito', 'watanabe', 'yamamoto', 'nakamura', 'kobayashi', 'kato', 'yoshida', 'yamada', 'sasaki', 'matsumoto', 'kawai']

interface Ev {
  t: number
  text: string
  tag?: string
}

function fmt(t: number): string {
  const s = t % 60
  const m = Math.floor(t / 60) % 60
  const h = Math.floor(t / 3600) % 24
  const d = 14 + Math.floor(t / 86400)
  const p = (n: number) => String(n).padStart(2, '0')
  return `2026-10-${p(d)} ${p(h)}:${p(m)}:${p(s)}`
}

interface Case {
  lines: string[]
  answer: Record<string, string>
}

function build(seed: number): Case {
  const rng = new Rng(seed ^ 0x10f0)
  const ips = new Map(USERS.map((u) => [u, `10.0.${rng.int(1, 9)}.${rng.int(10, 240)}`]))
  const ua = ['Chrome/118', 'Firefox/119', 'Safari/17', 'Edge/118']
  const evs: Ev[] = []
  const push = (t: number, text: string, tag?: string) => evs.push({ t, text, tag })

  // 通常業務: 日中のログインと API 利用
  for (const u of USERS) {
    const ip = ips.get(u)!
    for (let k = 0; k < rng.int(1, 2); k++) {
      const t0 = 9 * 3600 + rng.int(0, 9 * 3600)
      if (rng.next() < 0.3) push(t0 - 20, `auth    login ip=${ip} user=${u} result=fail ua=${rng.pick(ua)}`)
      push(t0, `auth    login ip=${ip} user=${u} result=ok ua=${rng.pick(ua)}`)
      for (let j = 0; j < rng.int(1, 4); j++) {
        const path = rng.pick(['/api/orders/' + rng.int(1000, 1400), '/api/profile', '/api/orders?page=' + rng.int(1, 5), '/api/reports/' + rng.int(1, 30)])
        push(t0 + 30 + j * rng.int(40, 900), `api     GET ${path} ip=${ip} user=${u} status=200`)
      }
    }
  }
  // おとり1: 本人が何度かパスワードを間違えただけ(内部 IP)
  {
    const ip = '10.0.4.77'
    const t = 10 * 3600 + 5 * 60
    for (let k = 0; k < 5; k++) push(t + k * 17, `auth    login ip=${ip} user=tanaka result=fail ua=Chrome/118`)
    push(t + 120, `auth    login ip=${ip} user=tanaka result=ok ua=Chrome/118`)
  }
  // おとり2: 管理者 kawai の正規の書き出し(小さい)
  push(14 * 3600 + 600, `auth    login ip=${ips.get('kawai')!} user=kawai result=ok ua=Edge/118`)
  push(14 * 3600 + 780, `api     GET /api/export?table=reports rows=${rng.int(200, 400)} ip=${ips.get('kawai')!} user=kawai status=200`)

  // 攻撃
  const attackerIp = `203.0.113.${rng.int(20, 230)}`
  const entry = rng.pick(['bruteforce', 'spraying'] as const)
  const victim = rng.pick(['suzuki', 'ito', 'kato', 'nakamura', 'yoshida'])
  const aUa = ['python-requests/2.31', 'curl/8.4', 'Go-http-client/2.0']
  let t = 2 * 3600 + rng.int(0, 1800)
  if (entry === 'bruteforce') {
    const n = rng.int(25, 45)
    for (let k = 0; k < n; k++, t += rng.int(2, 6)) push(t, `auth    login ip=${attackerIp} user=${victim} result=fail ua=${rng.pick(aUa)}`)
  } else {
    const targets = rng.shuffle(USERS.filter((u) => u !== victim && u !== 'kawai')).slice(0, rng.int(8, 11))
    for (const u of [...targets.slice(0, 4), victim, ...targets.slice(4)]) {
      if (u === victim) break
      push(t, `auth    login ip=${attackerIp} user=${u} result=fail ua=${rng.pick(aUa)}`)
      t += rng.int(150, 300)
    }
    push(t, `auth    login ip=${attackerIp} user=${victim} result=fail ua=${rng.pick(aUa)}`)
    t += rng.int(150, 300)
    for (const u of targets.slice(4)) {
      push(t, `auth    login ip=${attackerIp} user=${u} result=fail ua=${rng.pick(aUa)}`)
      t += rng.int(150, 300)
    }
    t += rng.int(150, 300)
  }
  push(t, `auth    login ip=${attackerIp} user=${victim} result=ok ua=${rng.pick(aUa)}`, 'first-success')
  push(t + 40, `api     GET /api/profile ip=${attackerIp} user=${victim} status=200`)
  push(t + 95, `api     PUT /api/users/${victim} fields=[display_name,role] ip=${attackerIp} user=${victim} status=200`)
  push(t + 96, `audit   role_changed user=${victim} old=member new=admin actor=${victim}`)
  const rows = rng.int(4000, 9000)
  push(t + 160, `api     GET /api/export?table=customers rows=${rows} ip=${attackerIp} user=${victim} status=200`)
  push(t + 170, `auth    logout ip=${attackerIp} user=${victim}`)

  evs.sort((a, b) => a.t - b.t)
  const lines = evs.map((e, i) => `${String(i + 1).padStart(4, '0')} ${fmt(e.t)} ${e.text}`)
  const first = evs.findIndex((e) => e.tag === 'first-success') + 1
  return {
    lines,
    answer: {
      attacker_ip: attackerIp,
      victim_user: victim,
      first_login_line: String(first),
      entry,
      escalation: 'mass-assignment',
      exported_rows: String(rows),
    },
  }
}

/** テスト用の正解 */
export function forensicsAnswer(seed: number): Record<string, string> {
  return build(seed).answer
}

function docs(seed: number): Doc[] {
  const c = build(seed)
  return [
    {
      title: '状況',
      kind: 'text',
      body: `社内向け Web 業務システム(演習用の架空のサービス)の監査ログを渡されました。
どうやら夜間に、顧客データの大量の書き出しが行われたようです。ログを分析して、次の項目を答えてください。

  attacker_ip       攻撃者の IP アドレス
  victim_user       最初に乗っ取られたアカウント
  first_login_line  攻撃者が最初にログインに成功した行の番号(左端の 4 桁)
  entry             侵入の手口:
                      bruteforce      1 つのアカウントに対する大量の試行
                      spraying        多数のアカウントに、少数回ずつ試す
                      sqli            SQL インジェクション
                      session-hijack  盗んだセッションの再利用
  escalation        権限が上がった原因:
                      mass-assignment  更新 API が、受け取ったフィールドをそのまま反映した(role を含む)
                      idor             他人の ID を指定して他人のデータを操作できた
                      sqli             SQL インジェクション
                      mfa-bypass       追加認証の回避
  exported_rows     持ち出された行数(攻撃者の書き出しの rows)

注意: 業務時間の社内 IP(10.0.x.x)の失敗やログインがすべて怪しいわけではありません。
書式は 1 行に 1 つ「キー=値」。`,
    },
    { title: '監査ログ', kind: 'log', body: c.lines.join('\n') },
  ]
}

const KEYS = ['attacker_ip', 'victim_user', 'first_login_line', 'entry', 'escalation', 'exported_rows']

export const forensicsLog: Challenge = {
  id: 'forensics-log',
  title: '夜間の持ち出し',
  domain: 'forensics',
  mode: 'audit',
  input: 'audit',
  difficulty: 3,
  points: 400,
  par: 2,
  summary: '数百行の監査ログから、侵入・権限昇格・持ち出しの経路を復元する。おとりの記録が混ざっている。',
  objective: '6つの項目をすべて正しく答える。',
  hints: [
    '社内の IP と、文書用の予約範囲(203.0.113.x)に分けて眺める。外からの失敗の並び方が手口を示す。',
    '最初の成功の直後に、そのアカウントが何を“更新”したかを見る。audit の行も手がかり。',
    '持ち出し量は、攻撃者の IP とアカウントの書き出しだけを数える。管理者の正規の書き出しは別。',
  ],
  docs,
  initialText: () => KEYS.map((k) => `${k}=`).join('\n') + '\n',
  create(seed) {
    const { answer } = build(seed)
    return {
      exec: noExec,
      submit(text) {
        const got = new Map<string, string>()
        for (const raw of text.split('\n')) {
          const m = /^\s*([a-z_]+)\s*=\s*(.*?)\s*$/.exec(raw)
          if (m) got.set(m[1]!, m[2]!)
        }
        const wrong = KEYS.filter((k) => got.get(k) !== answer[k])
        const right = KEYS.length - wrong.length
        const solved = wrong.length === 0
        return {
          ratio: solved ? 1 : 0.5 * (right / KEYS.length),
          solved,
          messages: solved
            ? ['6項目すべて一致。インシデントの経過を正しく復元できた。']
            : [`一致 ${right} / ${KEYS.length}`, `違う項目: ${wrong.join(', ')}`],
        }
      },
    }
  },
}
