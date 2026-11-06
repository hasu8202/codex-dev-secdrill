import { useSyncExternalStore } from 'react'
import { Lab } from './engine/lab'
import { browserKV } from './engine/storage'
import type { Imported } from './log/result'

export const kv = browserKV()
export const lab = new Lab(kv)

let version = 0
const listeners = new Set<() => void>()
export function bump() {
  version++
  listeners.forEach((l) => l())
}
/** Lab を操作したあとに画面を更新させるためのフック */
export function useVersion(): number {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => version,
  )
}

const PLAYER_KEY = 'secdrill.v1.player'
const IMPORTS_KEY = 'secdrill.v1.imports'

export const getPlayer = () => kv.get(PLAYER_KEY) ?? 'わたし'
export function setPlayer(name: string) {
  kv.set(PLAYER_KEY, name.slice(0, 24) || 'わたし')
  bump()
}

export function getImports(): Imported[] {
  try {
    return JSON.parse(kv.get(IMPORTS_KEY) ?? '[]') as Imported[]
  } catch {
    return []
  }
}
export function saveImports(list: Imported[]) {
  kv.set(IMPORTS_KEY, JSON.stringify(list))
  bump()
}

/** テキストをファイルとして保存させる(ブラウザ内で完結。通信はしない) */
export function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
