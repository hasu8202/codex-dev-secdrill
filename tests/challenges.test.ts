import { describe, expect, it } from 'vitest'
import { CHALLENGES, getChallenge } from '../src/challenges'
import { designThreatKey } from '../src/challenges/design-threat'
import { forensicsAnswer } from '../src/challenges/forensics-log'
import type { Session } from '../src/engine/types'

const SEEDS = [0, 1, 2, 3, 7, 42, 99, 1234, 31337, 987654321]

const make = (id: string, seed: number): Session => getChallenge(id)!.create(seed)
const docText = (id: string, seed: number) =>
  getChallenge(id)!
    .docs(seed)
    .map((d) => d.body)
    .join('\n')

describe('共通', () => {
  it('同じシードなら同じ資料、違うシードなら違う資料になる', () => {
    for (const ch of CHALLENGES) {
      expect(docText(ch.id, 5)).toBe(docText(ch.id, 5))
    }
    for (const id of ['authz-stale-share', 'session-fixation', 'input-canon', 'forensics-log', 'design-threat']) {
      const texts = new Set(SEEDS.map((s) => docText(id, s)))
      expect(texts.size, id).toBeGreaterThan(3)
    }
  })

  it('全課題にヒントと目標がある', () => {
    for (const ch of CHALLENGES) {
      expect(ch.hints.length, ch.id).toBeGreaterThanOrEqual(2)
      expect(ch.objective.length).toBeGreaterThan(10)
    }
  })
})

describe('authz-stale-share', () => {
  it('どのシードでも、お知らせの ID から取り消し済みの共有の穴にたどり着ける', () => {
    for (const seed of SEEDS) {
      const s = make('authz-stale-share', seed)
      expect(s.exec('GET /activity').lines.join('')).toContain('401')
      s.exec('login alice')
      const ids = [...s.exec('GET /activity').lines.join('').matchAll(/inv_[0-9a-f]{6}/g)].map((m) => m[0])
      const results: boolean[] = []
      for (const id of ids) {
        for (const sub of ['', '/export', '/history', '/receipt']) results.push(Boolean(s.exec(`GET /invoices/${id}${sub}`).solved))
      }
      expect(results.filter(Boolean).length, `seed ${seed}`).toBe(1)
    }
  })

  it('詳細(主の経路)は取り消し済みの請求書を 403 にする', () => {
    const s = make('authz-stale-share', 3)
    s.exec('login alice')
    const [, target] = [...s.exec('GET /activity').lines.join('').matchAll(/inv_[0-9a-f]{6}/g)].map((m) => m[0])
    expect(s.exec(`GET /invoices/${target}`).lines[0]).toContain('403')
  })
})

describe('authz-policy', () => {
  const SOLUTION = `default deny
deny read, export, history, receipt, update, delete if user.suspended == true
deny read, export, history, receipt if resource.confidential == true and user.org != resource.org
deny read, export, history, receipt if resource.confidential == true and user.role != admin
allow read if user.org == resource.org
allow export, history, receipt if user.org == resource.org and user.role != guest
allow read, receipt if share.exists == true and share.revoked == false
allow export, history if share.exists == true and share.revoked == false and share.scope == full
allow update if user.org == resource.org and user.role == admin
allow delete if user.org == resource.org and user.role == admin and resource.status == draft
`
  const ch = getChallenge('authz-policy')!

  it('模範解答は 864 通りすべてを満たす', () => {
    const v = ch.create(1).submit(SOLUTION)
    expect(v.messages.join('\n')).toContain('864')
    expect(v.solved).toBe(true)
    expect(v.ratio).toBe(1)
  })

  it('現行のポリシーは不合格で、具体例が出る', () => {
    const v = ch.create(1).submit(ch.initialText!(1))
    expect(v.solved).toBe(false)
    expect(v.messages.join('\n')).toMatch(/許しすぎ|拒みすぎ/)
  })

  it('許しすぎ・拒みすぎのどちらの近道も通らない', () => {
    expect(ch.create(1).submit('default allow').solved).toBe(false)
    expect(ch.create(1).submit('default deny').solved).toBe(false)
  })

  it('構文エラーは行番号つきで知らせ、得点にならない', () => {
    const v = ch.create(1).submit('default deny\nallow bogus if user.role == admin\nallow read if user.nothing == x')
    expect(v.ratio).toBe(0)
    expect(v.messages.join('\n')).toContain('2行目')
    expect(v.messages.join('\n')).toContain('3行目')
  })
})

describe('session-fixation', () => {
  const PARAMS = ['sid', 'sessionid', 'jsid', 'sess']
  const PATHS = ['/login', '/login/mfa', '/login/link', '/sso/start', '/login/passkey']

  it('固定できるのは、ID を作り直さない唯一の経路だけ', () => {
    for (const seed of SEEDS) {
      const winners: string[] = []
      for (const param of PARAMS) {
        for (const path of PATHS) {
          const s = make('session-fixation', seed)
          const sid = /sid=(s_\w+)/.exec(s.exec('get /').lines.join('\n'))![1]
          s.exec(`phish ${path}?${param}=${sid}`)
          if (s.exec('get /account').solved) winners.push(`${param} ${path}`)
        }
      }
      expect(winners.length, `seed ${seed}: ${winners.join(',')}`).toBe(1)
      // 資料の記述と一致する(パラメータ名が資料に書かれている)
      expect(docText('session-fixation', seed)).toContain(`req.query.${winners[0]!.split(' ')[0]}`)
    }
  })

  it('ログイン前の何もしない状態では口座を開けない', () => {
    const s = make('session-fixation', 1)
    s.exec('get /')
    expect(s.exec('get /account').solved).toBeFalsy()
  })

  it('サーバーが発行していない ID は採用されない', () => {
    const s = make('session-fixation', 1)
    const param = /req\.query\.(\w+)/.exec(docText('session-fixation', 1))![1]
    const out = s.exec(`phish /sso/start?${param}=s_forged`).lines.join('\n')
    expect(out).toContain('採用せず')
  })
})

describe('input-canon', () => {
  const payloads = (dir: string) => [
    `../${dir}/key.txt`,
    `%2e%2e/${dir}/key.txt`,
    `....//${dir}/key.txt`,
    `%252e%252e/${dir}/key.txt`,
    `..\\${dir}\\key.txt`,
  ]

  it('各シードで、通る入力の型はちょうど 1 種類(素朴な ../ は必ず止まる)', () => {
    for (const seed of SEEDS) {
      const dir = /\/srv\/app\/(\S+)\/key\.txt/.exec(docText('input-canon', seed))![1]!
      const hits = payloads(dir).map((p) => Boolean(make('input-canon', seed).exec(`read ${p}`).solved))
      expect(hits[0], `seed ${seed}: 素朴な ../ が通ってしまった`).toBe(false)
      expect(hits.filter(Boolean).length, `seed ${seed}: ${hits}`).toBe(1)
    }
  })

  it('公開ファイルは普通に読める', () => {
    const s = make('input-canon', 4)
    expect(s.exec('read about.txt').lines.join('\n')).toContain('200 OK')
  })
})

describe('api-race', () => {
  const ENDPOINTS = ['/coupons/redeem', '/coupons/redeem/v2', '/coupons/redeem/bulk']
  const orders: string[] = []
  const gen = (p: string) => {
    if (p.length === 10) return void orders.push(p)
    gen(p + 'A')
    gen(p + 'B')
  }
  gen('')

  it('どのシードでも解ける並びがあり、両方がロックを取る組は解けない', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const kinds = new Map<string, string>()
      const body = docText('api-race', seed)
      for (const ep of ENDPOINTS) {
        const block = body.slice(body.indexOf(`POST ${ep}\n`)).split('\n\n')[0]!
        kinds.set(ep, block.includes('lock(user)') ? (block.indexOf('lock(user)') < block.indexOf('used = ') ? 'locked' : 'late') : 'plain')
      }
      let anySolved = false
      for (const a of ENDPOINTS) {
        for (const b of ENDPOINTS) {
          const s = make('api-race', seed)
          s.exec(`plan A=${a} B=${b}`)
          const solvable = orders.some((o) => s.exec(`run ${o}`).solved)
          if (kinds.get(a) === 'locked' && kinds.get(b) === 'locked') expect(solvable, `seed ${seed} ${a} ${b}`).toBe(false)
          if (solvable) anySolved = true
        }
      }
      expect(anySolved, `seed ${seed}`).toBe(true)
    }
  })

  it('順番に実行すれば二重には入金されない', () => {
    const s = make('api-race', 1)
    s.exec(`plan A=${ENDPOINTS[0]} B=${ENDPOINTS[1]}`)
    expect(s.exec('run AAAAABBBBB').solved).toBeFalsy()
  })
})

describe('crypto-nonce', () => {
  it('ノンスが一巡する性質を使えば、鍵なしで秘密を復元できる', () => {
    for (const seed of SEEDS) {
      const s = make('crypto-nonce', seed)
      const ct = /ct=([0-9a-f]+)/.exec(s.exec('bulletin').lines[0]!)![1]!
      const zeros = '00'.repeat(ct.length / 2)
      const guesses: string[] = []
      for (let i = 0; i < 16; i++) {
        const ks = /ct=([0-9a-f]+)/.exec(s.exec(`enc hex:${zeros}`).lines[0]!)![1]!
        guesses.push(s.exec(`ascii ${s.exec(`xor ${ct} ${ks}`).lines[0]}`).lines[0]!)
      }
      const secret = guesses.filter((g) => /^[a-z]+-\d{4}-[a-z]+$/.test(g))
      expect(secret.length, `seed ${seed}`).toBe(1)
      expect(s.exec(`answer ${secret[0]}`).solved).toBe(true)
    }
  })

  it('間違った答えは通らず、暗号化の回数には上限がある', () => {
    const s = make('crypto-nonce', 1)
    expect(s.exec('answer nope').solved).toBeFalsy()
    for (let i = 0; i < 20; i++) s.exec('enc hex:00')
    expect(s.exec('enc hex:00').lines[0]).toContain('429')
  })
})

describe('design-threat', () => {
  const ch = getChallenge('design-threat')!
  it('正解を出せば満点、安全な記述を欠陥と言うと不合格', () => {
    for (const seed of SEEDS) {
      const key = designThreatKey(seed)
      expect(key.size).toBe(6)
      const answer = [...key].map(([n, f]) => `${n}=${f}`).join('\n')
      expect(ch.create(seed).submit(answer).solved).toBe(true)
      const safe = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].find((n) => !key.has(n))!
      expect(ch.create(seed).submit(`${answer}\n${safe}=A`).solved).toBe(false)
    }
  })
  it('対策の選び間違いと形式エラーを区別する', () => {
    const key = designThreatKey(1)
    const [n, f] = [...key][0]!
    const wrong = f === 'A' ? 'B' : 'A'
    expect(ch.create(1).submit(`${n}=${wrong}`).solved).toBe(false)
    expect(ch.create(1).submit('abc').messages[0]).toContain('1行目')
  })
})

describe('forensics-log', () => {
  const ch = getChallenge('forensics-log')!
  it('正解の6項目で満点、ログの行番号は資料と一致する', () => {
    for (const seed of SEEDS) {
      const a = forensicsAnswer(seed)
      const text = Object.entries(a).map(([k, v]) => `${k}=${v}`).join('\n')
      expect(ch.create(seed).submit(text).solved, `seed ${seed}`).toBe(true)
      const log = ch.docs(seed).find((d) => d.kind === 'log')!.body.split('\n')
      const line = log[Number(a.first_login_line) - 1]!
      expect(line).toContain(`ip=${a.attacker_ip} user=${a.victim_user} result=ok`)
      expect(log.filter((l) => l.includes(`ip=${a.attacker_ip}`) && l.includes('result=ok')).length).toBe(1)
      expect(log.some((l) => l.includes(`rows=${a.exported_rows}`))).toBe(true)
    }
  })
  it('一部だけ合っていても満点にならない', () => {
    const a = forensicsAnswer(1)
    const v = ch.create(1).submit(`attacker_ip=${a.attacker_ip}\nvictim_user=${a.victim_user}`)
    expect(v.solved).toBe(false)
    expect(v.messages.join('\n')).toContain('違う項目')
  })
})
