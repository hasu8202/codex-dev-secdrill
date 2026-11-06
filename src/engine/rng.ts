// シード付きの乱数。同じシードなら同じ問題になる(友達との勝負・再生検証の土台)
export class Rng {
  private a: number
  constructor(seed: number) {
    this.a = seed >>> 0
  }
  next(): number {
    this.a = (this.a + 0x6d2b79f5) >>> 0
    let t = this.a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  /** min 以上 max 以下の整数 */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1))
  }
  pick<T>(items: readonly T[]): T {
    return items[this.int(0, items.length - 1)] as T
  }
  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items]
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(0, i)
      ;[out[i], out[j]] = [out[j] as T, out[i] as T]
    }
    return out
  }
  hex(length: number): string {
    let s = ''
    for (let i = 0; i < length; i++) s += this.int(0, 15).toString(16)
    return s
  }
}

/** 文字列から 32bit の数を作る(シードの派生用) */
export function seedFrom(...parts: (string | number)[]): number {
  let h = 2166136261
  for (const ch of parts.join('|')) {
    h ^= ch.codePointAt(0) ?? 0
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
