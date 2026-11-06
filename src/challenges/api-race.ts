import { Rng } from '../engine/rng'
import type { Challenge, Doc } from '../engine/types'
import { noSubmit, out, solvedOut, splitCommand, tokens } from './util'

// APIセキュリティ(攻撃): 「確認してから書く」の隙間(TOCTOU)。2つのリクエストの実行順序を自分で決めて、
// 1枚しか使えないクーポンを2回受け取る。時間は仮想で、実際の並列処理はしない。

type Step = 'lock' | 'read' | 'check' | 'write' | 'unlock'
const TEMPLATES: Record<string, Step[]> = {
  locked: ['lock', 'read', 'check', 'write', 'unlock'],
  plain: ['read', 'check', 'write'],
  late: ['read', 'check', 'lock', 'write', 'unlock'],
}
const NAMES = ['/coupons/redeem', '/coupons/redeem/v2', '/coupons/redeem/bulk']

function build(seed: number) {
  const rng = new Rng(seed ^ 0x7ace)
  const kinds = rng.shuffle(Object.keys(TEMPLATES))
  const endpoints = new Map<string, Step[]>()
  NAMES.forEach((n, i) => endpoints.set(n, TEMPLATES[kinds[i]!]!))
  const value = rng.pick([50, 100, 200, 500])
  return { endpoints, value }
}

const STEP_TEXT: Record<Step, string> = {
  lock: 'lock(user) … 同じ利用者の他のロック取得を待たせる',
  read: 'used = coupons.get(code).used … クーポンが使用済みかを読む',
  check: 'if (used) return 409 … 使用済みなら中断(ロックは解放)',
  write: 'coupons.set(code, used=true); wallet.balance += value … 使用済みにして残高に加算',
  unlock: 'unlock(user)',
}

function docs(seed: number): Doc[] {
  const { endpoints, value } = build(seed)
  const body = [...endpoints.entries()]
    .map(([name, steps]) => `POST ${name}\n${steps.map((s, i) => `  ${i + 1}. ${STEP_TEXT[s]}`).join('\n')}`)
    .join('\n\n')
  return [
    {
      title: '概要',
      kind: 'text',
      body: `クーポンの引き換え API shop.example.test(演習用の架空のサービス)。
クーポン WELCOME は 1 人 1 回だけ使える(価値 ${value} ポイント)。残高は最初 0。

各エンドポイントは下の手順を 1 ステップずつ実行する。2 つのリクエスト A と B が同時に届くと、
サーバーは A と B のステップを任意の順に交互に実行しうる(ステップの途中では止まらない。ステップ単位で切り替わる)。
ロックは「持っている側のロック取得」だけを待たせる。ロックを取らないリクエストは待たされない。

コマンド:
  plan A=<エンドポイント> B=<エンドポイント>   2つのリクエストの宛先を決める
  run <A と B の並び>                          実行する順番。例: run ABBAAB
                                               先頭から 1 文字ずつ、その文字のリクエストが次のステップを 1 つ進む。
                                               ロック待ちの文字は空振りになる。並びが足りない分は A,B の順に自動で終わらせる。
  help
run のたびに、残高・クーポンは最初の状態から始まる(何度でも試せる)。
目標: 残高を ${value * 2} ポイント(= クーポン 2 回分)にする。`,
    },
    { title: 'エンドポイントの手順', kind: 'text', body },
  ]
}

export const apiRace: Challenge = {
  id: 'api-race',
  title: '確認してから書くまで',
  domain: 'api',
  mode: 'attack',
  input: 'console',
  difficulty: 3,
  points: 400,
  par: 3,
  summary: '1回しか使えないクーポンを、同時に届く2つのリクエストの隙間で2回使う。ステップの実行順序を設計する。',
  objective: 'plan で宛先を決め、run で実行順序を指定して、残高をクーポン2回分にする。',
  hints: [
    '失敗しても run は何度でもやり直せる。出力のトレースで、各ステップがいつ実行されたかを見る。',
    '「読む」が 2 回とも「書く」より前に来る並びを探す。両方が「未使用」と読めば、両方が先へ進める。',
    'ロックは“ロックを取る側どうし”しか待たせない。両方がロックを取るエンドポイントだと、順序で隙間を作れない。宛先の組み合わせも選ぶこと。',
  ],
  docs,
  create(seed) {
    const { endpoints, value } = build(seed)
    let plan: { A: string; B: string } | null = null
    return {
      exec(line) {
        const { cmd, rest } = splitCommand(line)
        if (cmd === 'help') return out('plan A=<endpoint> B=<endpoint> / run <ABAB...>')
        if (cmd === 'plan') {
          const a = /A=(\S+)/.exec(rest)?.[1]
          const b = /B=(\S+)/.exec(rest)?.[1]
          if (!a || !b || !endpoints.has(a) || !endpoints.has(b)) {
            return out('plan A=<endpoint> B=<endpoint>', '使えるエンドポイント:', ...endpoints.keys())
          }
          plan = { A: a, B: b }
          return out(`A → ${a}`, `B → ${b}`)
        }
        if (cmd !== 'run') return out('不明なコマンド。help を参照')
        if (!plan) return out('先に plan で宛先を決めてください')
        const order = (tokens(rest).join('') || '').toUpperCase()
        if (!/^[AB]*$/.test(order)) return out('run には A と B だけを並べます')

        // 仮想的な実行
        const coupon = { used: false }
        let balance = 0
        let lockOwner: 'A' | 'B' | null = null
        type Req = { steps: Step[]; pc: number; seenUsed: boolean; done: boolean; aborted: boolean }
        const reqs: Record<'A' | 'B', Req> = {
          A: { steps: endpoints.get(plan.A)!, pc: 0, seenUsed: false, done: false, aborted: false },
          B: { steps: endpoints.get(plan.B)!, pc: 0, seenUsed: false, done: false, aborted: false },
        }
        const trace: string[] = []
        const advance = (who: 'A' | 'B'): 'ran' | 'blocked' | 'done' => {
          const r = reqs[who]
          if (r.done) return 'done'
          const step = r.steps[r.pc]!
          if (step === 'lock' && lockOwner && lockOwner !== who) return 'blocked'
          r.pc++
          let note = ''
          if (step === 'lock') {
            lockOwner = who
            note = 'ロック取得'
          } else if (step === 'unlock') {
            if (lockOwner === who) lockOwner = null
            note = 'ロック解放'
          } else if (step === 'read') {
            r.seenUsed = coupon.used
            note = `used=${r.seenUsed}`
          } else if (step === 'check') {
            if (r.seenUsed) {
              r.aborted = true
              r.done = true
              if (lockOwner === who) lockOwner = null
              note = '使用済みと読んだので 409 で中断'
            } else note = '未使用と読んだので続行'
          } else {
            coupon.used = true
            balance += value
            note = `使用済みにして +${value}(残高 ${balance})`
          }
          if (r.pc >= r.steps.length) r.done = true
          trace.push(`${who}: ${step.padEnd(6)} ${note}`)
          return 'ran'
        }
        for (const ch of order) {
          const who = ch as 'A' | 'B'
          if (advance(who) === 'blocked') trace.push(`${who}: (ロック待ち。この番は空振り)`)
        }
        for (let guard = 0; guard < 50 && !(reqs.A.done && reqs.B.done); guard++) {
          for (const who of ['A', 'B'] as const) {
            while (!reqs[who].done && advance(who) === 'ran');
          }
        }
        trace.push(`--- 結果: 残高 ${balance} / クーポン ${coupon.used ? '使用済み' : '未使用'}`)
        if (balance >= value * 2) {
          return solvedOut(...trace, '', '>>> クーポンが 2 回分入金された。目標達成。')
        }
        return out(...trace)
      },
      submit: noSubmit,
    }
  },
}
