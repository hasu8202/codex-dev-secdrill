import { Rng, seedFrom } from '../engine/rng'
import type { Challenge, Doc } from '../engine/types'
import { noSubmit, out, solvedOut, splitCommand, tokens } from './util'

// 暗号・データ保護(攻撃): ストリーム暗号で、ノンス(使い捨ての値)が使い回されると何が起きるか。
// 暗号は演習用の玩具(DRIFT-16)で、実在の暗号方式ではない。パラメータも小さく、実用の鍵には何の意味もない。

const NONCES = 16
const QUOTA = 20

function keystream(seed: number, nonce: number, length: number): number[] {
  const r = new Rng(seedFrom(seed, 'drift16', nonce))
  return Array.from({ length }, () => r.int(0, 255))
}

const toHex = (b: number[]) => b.map((x) => x.toString(16).padStart(2, '0')).join('')
function fromHex(s: string): number[] | null {
  if (s.length % 2 || !/^[0-9a-fA-F]*$/.test(s)) return null
  return (s.match(/../g) ?? []).map((h) => parseInt(h, 16))
}
const toBytes = (s: string) => Array.from(new TextEncoder().encode(s))
const printable = (b: number[]) => b.map((x) => (x >= 32 && x < 127 ? String.fromCharCode(x) : '.')).join('')

function secretOf(seed: number): string {
  const r = new Rng(seed ^ 0x5ec2e7)
  return `${r.pick(['harbor', 'tunnel', 'lantern', 'orchard', 'quarry'])}-${r.int(1000, 9999)}-${r.pick(['east', 'west', 'north', 'south'])}`
}

function docs(seed: number): Doc[] {
  const m = secretOf(seed)
  return [
    {
      title: '概要',
      kind: 'text',
      body: `暗号化メモ係 memo.example.test(演習用の架空のサービス)。

暗号方式 DRIFT-16(演習用の玩具。実在しない):
  ・鍵 K はサーバーだけが持つ(あなたには見えない)。
  ・ノンス n は 0〜${NONCES - 1} の整数。キーストリーム KS(K, n) の各バイトは、n ごとに決まった疑似乱数。
  ・暗号文 = 平文 XOR KS(K, n)(バイトごと)。復号も同じ XOR。
  ・ノンスは「暗号化するたびに 1 増やす(${NONCES} で 0 に戻る)」カウンタで作る。

サーバーは起動直後に、秘密のメッセージ(${m.length} 文字の ASCII)を 1 回だけ暗号化して掲示した。
その後は、利用者が好きな平文を暗号化してくれる(暗号化オラクル)。同じカウンタを共有している。

コマンド:
  bulletin             掲示された暗号文(16進)を表示。どのノンスで暗号化されたかは書かれていない
  enc <文字列>         文字列を暗号化して nonce と暗号文(16進)を返す。最大 64 文字、${QUOTA} 回まで
  enc hex:<16進>       16進の平文を暗号化する(例: enc hex:000000)
  xor <16進> <16進>    2つの16進のバイト列を XOR する(短い方の長さまで)
  ascii <16進>         16進を文字列で表示(読めないバイトは . )
  answer <文字列>      掲示されたメッセージを答える
  help

目標: 秘密のメッセージを突き止めて answer する。`,
    },
  ]
}

export const cryptoNonce: Challenge = {
  id: 'crypto-nonce',
  title: '一度きりのはずの値',
  domain: 'crypto',
  mode: 'attack',
  input: 'console',
  difficulty: 3,
  points: 450,
  par: 19,
  summary: 'ノンスが 16 回で一巡する。同じキーストリームが再び使われると、鍵を知らなくても暗号文が読める。',
  objective: '暗号化オラクルの出力と掲示された暗号文から、秘密のメッセージを復元して answer する。',
  hints: [
    '暗号文 = 平文 XOR キーストリーム。平文が全部 0 のバイトなら、暗号文はそのままキーストリームになる。',
    'ノンスは一巡する。掲示された暗号文と同じノンスのキーストリームを、オラクルから集められる。',
    'どのノンスで暗号化されたかは書かれていない。候補ごとに「掲示の暗号文 XOR キーストリーム」を作り、読める文字列になるものが正解。',
  ],
  docs,
  create(seed) {
    const m = secretOf(seed)
    const r = new Rng(seed ^ 0xb00)
    const n0 = r.int(0, NONCES - 1)
    const c0 = toBytes(m).map((b, i) => b ^ keystream(seed, n0, m.length)[i]!)
    let counter = (n0 + 1 + r.int(0, NONCES - 1)) % NONCES
    let used = 0
    return {
      exec(line) {
        const { cmd, rest } = splitCommand(line)
        if (cmd === 'help') return out('bulletin / enc / xor / ascii / answer')
        if (cmd === 'bulletin') return out(`ct=${toHex(c0)} (${c0.length} bytes)`)
        if (cmd === 'enc') {
          if (used >= QUOTA) return out(`429 回数の上限(${QUOTA})に達しました`)
          let plain: number[]
          if (rest.startsWith('hex:')) {
            const h = fromHex(rest.slice(4))
            if (!h) return out('hex: の後ろは偶数桁の16進にしてください')
            plain = h
          } else plain = toBytes(rest)
          if (plain.length === 0 || plain.length > 64) return out('平文は 1〜64 バイト')
          used++
          const n = counter
          counter = (counter + 1) % NONCES
          const ks = keystream(seed, n, plain.length)
          return out(`nonce=${n} ct=${toHex(plain.map((b, i) => b ^ ks[i]!))}  (残り ${QUOTA - used} 回)`)
        }
        if (cmd === 'xor') {
          const [a, b] = tokens(rest)
          const x = a ? fromHex(a) : null
          const y = b ? fromHex(b) : null
          if (!x || !y) return out('xor <16進> <16進>')
          const len = Math.min(x.length, y.length)
          return out(toHex(Array.from({ length: len }, (_, i) => x[i]! ^ y[i]!)))
        }
        if (cmd === 'ascii') {
          const h = fromHex(rest.trim())
          return out(h ? printable(h) : 'ascii <16進>')
        }
        if (cmd === 'answer') {
          if (rest === m) return solvedOut('正解。', '', '>>> 鍵を知らないまま、使い回されたキーストリームから平文を復元した。目標達成。')
          return out('違います。')
        }
        return out('不明なコマンド。help を参照')
      },
      submit: noSubmit,
    }
  },
}
