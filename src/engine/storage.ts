// localStorage を安全に使うための薄い層。使えない環境(プライベートモードなど)ではメモリに退避する。
export interface KV {
  get(key: string): string | null
  set(key: string, value: string): void
  remove(key: string): void
}

export class MemoryKV implements KV {
  private m = new Map<string, string>()
  get(key: string) {
    return this.m.get(key) ?? null
  }
  set(key: string, value: string) {
    this.m.set(key, value)
  }
  remove(key: string) {
    this.m.delete(key)
  }
}

export function browserKV(): KV {
  const fallback = new MemoryKV()
  return {
    get(key) {
      try {
        return localStorage.getItem(key)
      } catch {
        return fallback.get(key)
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, value)
      } catch {
        fallback.set(key, value)
      }
    },
    remove(key) {
      try {
        localStorage.removeItem(key)
      } catch {
        fallback.remove(key)
      }
    },
  }
}
