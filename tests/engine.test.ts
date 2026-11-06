import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Lab } from '../src/engine/lab'
import { scoreFor } from '../src/engine/score'
import { sha256 } from '../src/engine/sha256'
import { MemoryKV } from '../src/engine/storage'
import { appendEntry, parseJsonl, toJsonl, verifyChain, type LogEntry } from '../src/log/chain'
import { replayLog } from '../src/log/replay'

const lab = () => new Lab(new MemoryKV(), () => new Date('2026-11-06T00:00:00Z'), () => 777)

/** crypto-nonce を正規の手順で解く(ログに残る入力はすべて実際の操作) */
function solveCrypto(l: Lab) {
  l.begin('crypto-nonce', 5)
  const ct = /ct=([0-9a-f]+)/.exec(l.exec('crypto-nonce', 'bulletin').lines[0]!)![1]!
  const zeros = '00'.repeat(ct.length / 2)
  for (let i = 0; i < 16; i++) {
    const ks = /ct=([0-9a-f]+)/.exec(l.exec('crypto-nonce', `enc hex:${zeros}`).lines[0]!)![1]!
    const plain = l.exec('crypto-nonce', `xor ${ct} ${ks}`).lines[0]!
    const text = l.exec('crypto-nonce', `ascii ${plain}`).lines[0]!
    if (/^[a-z]+-\d{4}-[a-z]+$/.test(text)) return l.exec('crypto-nonce', `answer ${text}`)
  }
  throw new Error('解けなかった')
}

describe('sha256', () => {
  it('既知のテストベクタと一致する', () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(sha256('a'.repeat(1000))).toBe('41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3')
  })
})

describe('ログの連鎖', () => {
  const mk = (n: number): LogEntry[] => {
    const e: LogEntry[] = []
    for (let i = 0; i < n; i++) {
      e.push(appendEntry(e, { at: 't', attempt: 'a1', type: 'exec', challengeId: 'x', seed: 1, input: `cmd${i}`, output: 'o', solved: false }))
    }
    return e
  }
  it('正しい連鎖は検証を通り、JSONL で往復できる', () => {
    const e = mk(5)
    expect(verifyChain(e).ok).toBe(true)
    expect(verifyChain(parseJsonl(toJsonl(e))).ok).toBe(true)
  })
  it('書き換え・削除・並べ替えを検出する', () => {
    const e = mk(5)
    expect(verifyChain(e.map((x, i) => (i === 2 ? { ...x, input: 'forged' } : x))).brokenAt).toBe(3)
    expect(verifyChain(e.filter((_, i) => i !== 1)).ok).toBe(false)
    expect(verifyChain([e[1]!, e[0]!, ...e.slice(2)]).ok).toBe(false)
  })
})

describe('採点', () => {
  it('理想より多い手数・ヒントで減点され、下限がある', () => {
    const ch = { points: 400, par: 4 }
    expect(scoreFor(ch, 4, 0, 1)).toBe(400)
    expect(scoreFor(ch, 8, 0, 1)).toBe(200)
    expect(scoreFor(ch, 100, 0, 1)).toBe(200)
    expect(scoreFor(ch, 4, 2, 1)).toBe(320)
    expect(scoreFor(ch, 4, 9, 1)).toBe(200)
    expect(scoreFor(ch, 4, 0, 0)).toBe(0)
  })
})

describe('Lab(進行・ログ・リセット)', () => {
  it('解くと得点が付き、ログは連鎖していて、再生で同じ結果になる', () => {
    const l = lab()
    const done = solveCrypto(l)
    expect(done.solved).toBe(true)
    const p = l.progressOf('crypto-nonce')!
    expect(p.solved).toBe(true)
    expect(p.score).toBeGreaterThan(0)
    expect(verifyChain(l.log()).ok).toBe(true)
    const r = replayLog(l.log())
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ challengeId: 'crypto-nonce', seed: 5, solved: true, consistent: true, score: p.score, steps: p.steps })
  })

  it('保存した状態から、入力履歴をたどって同じ画面を復元できる', () => {
    const kv = new MemoryKV()
    const a = new Lab(kv, () => new Date(0), () => 1)
    a.begin('session-fixation', 11)
    a.exec('session-fixation', 'get /')
    const before = a.transcript('session-fixation').map((t) => t.lines.join('\n'))
    const b = new Lab(kv, () => new Date(0), () => 1)
    expect(b.transcript('session-fixation').map((t) => t.lines.join('\n'))).toEqual(before)
    expect(b.progressOf('session-fixation')!.seed).toBe(11)
  })

  it('出力を書き換えたログ・解いていないのに solved としたログは再生検証で見破る', () => {
    const l = lab()
    solveCrypto(l)
    const forged = l.log().map((e) => ({ ...e }))
    const idx = forged.findIndex((e) => e.type === 'exec' && e.input === 'bulletin')
    forged[idx]!.output = 'ct=00'
    // 連鎖も作り直して「形式上は正しい」改ざんにする
    const rebuilt: LogEntry[] = []
    for (const { seq: _s, prev: _p, hash: _h, ...f } of forged) rebuilt.push(appendEntry(rebuilt, f))
    expect(verifyChain(rebuilt).ok).toBe(true)
    expect(replayLog(rebuilt)[0]!.consistent).toBe(false)

    const fake: LogEntry[] = []
    const base = { at: 't', attempt: 'a1', challengeId: 'crypto-nonce', seed: 5 }
    fake.push(appendEntry(fake, { ...base, type: 'start', input: '', output: '', solved: false }))
    fake.push(appendEntry(fake, { ...base, type: 'exec', input: 'answer whatever', output: '正解。', solved: true }))
    expect(replayLog(fake)[0]!.consistent).toBe(false)
  })

  it('やり直し・全リセットで初期状態に戻り、最高記録とログは残る', () => {
    const l = lab()
    solveCrypto(l)
    const best = l.bestScore('crypto-nonce')
    expect(best).toBeGreaterThan(0)
    l.restart('crypto-nonce', { seed: 6 })
    expect(l.progressOf('crypto-nonce')).toMatchObject({ seed: 6, solved: false, inputs: [], hints: 0 })
    expect(l.transcript('crypto-nonce')).toHaveLength(0)
    l.exec('crypto-nonce', 'bulletin')
    l.resetAll()
    expect(l.progressOf('crypto-nonce')).toBeUndefined()
    expect(l.bestScore('crypto-nonce')).toBe(best)
    expect(verifyChain(l.log()).ok).toBe(true)
    expect(l.log().filter((e) => e.type === 'reset').length).toBe(2)
  })

  it('全消去でログ・進行・記録がすべて消える', () => {
    const l = lab()
    solveCrypto(l)
    l.wipeEverything()
    expect(l.log()).toHaveLength(0)
    expect(l.totalBest()).toBe(0)
    expect(l.progressOf('crypto-nonce')).toBeUndefined()
  })

  it('ヒントは使うたびに減点され、上限を越えない', () => {
    const l = lab()
    l.begin('crypto-nonce', 5)
    expect(l.useHint('crypto-nonce')).toBe(1)
    l.useHint('crypto-nonce')
    l.useHint('crypto-nonce')
    expect(l.useHint('crypto-nonce')).toBe(3)
    expect(l.log().filter((e) => e.type === 'hint')).toHaveLength(3)
  })

  it('防御・監査の課題は提出で採点され、不合格でも部分点が記録される', () => {
    const l = lab()
    const t = l.submit('authz-policy', 'default deny\nallow read if user.org == resource.org')
    expect(t.solved).toBe(false)
    expect(t.ratio).toBeGreaterThan(0)
    expect(l.progressOf('authz-policy')!.score).toBeGreaterThan(0)
    expect(l.bestScore('authz-policy')).toBe(0)
  })
})

describe('安全性: 外部と通信しない・任意コードを実行しない', () => {
  const files: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.(ts|tsx)$/.test(name)) files.push(p)
    }
  }
  walk(join(__dirname, '..', 'src'))

  it('ソースに通信・動的コード実行・OS 操作の呼び出しがない', () => {
    const banned = [/\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /EventSource/, /sendBeacon/, /\beval\s*\(/, /new\s+Function\s*\(/, /child_process/, /node:fs/, /import\s*\(/, /importScripts/]
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      for (const re of banned) expect(re.test(src), `${f} に ${re} がある`).toBe(false)
    }
  })

  it('ソースに書かれた URL は演習用の予約ドメインだけ', () => {
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      for (const m of src.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
        expect(m[1], `${f}: ${m[0]}`).toMatch(/\.test$|^localhost$/)
      }
    }
  })

  it('index.html の CSP が通信を遮断している', () => {
    const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8')
    expect(html).toContain("connect-src 'none'")
    expect(html).toContain("default-src 'self'")
    expect(html).not.toMatch(/<script[^>]+src="https?:/)
  })
})

describe('結果ファイル(友達との交換)', () => {
  it('書き出して取り込むと、再生検証つきで同じ結果が読める', async () => {
    const { exportResult, importResult, headToHead } = await import('../src/log/result')
    const l = lab()
    solveCrypto(l)
    const text = exportResult(l, 'alice')
    const r = importResult(text)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.imported.chain.ok).toBe(true)
    expect(r.imported.results[0]).toMatchObject({ solved: true, consistent: true })
    const table = headToHead([{ name: 'alice', imported: r.imported }])
    expect(table.get('crypto-nonce#5')?.[0]?.player).toBe('alice')
  })

  it('連鎖が壊れたファイルは得点として数えない', async () => {
    const { exportResult, importResult, headToHead } = await import('../src/log/result')
    const l = lab()
    solveCrypto(l)
    const file = JSON.parse(exportResult(l, 'mallory'))
    file.entries[3].output = 'tampered'
    const r = importResult(JSON.stringify(file))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.imported.chain.ok).toBe(false)
    expect(headToHead([{ name: 'mallory', imported: r.imported }]).size).toBe(0)
  })

  it('別の形式のファイルは取り込まない', async () => {
    const { importResult } = await import('../src/log/result')
    expect(importResult('not json').ok).toBe(false)
    expect(importResult('{"format":"other"}').ok).toBe(false)
  })
})
