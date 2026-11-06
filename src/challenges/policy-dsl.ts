// 認可ポリシーの小さな言語。自作のインタプリタで評価し、eval や Function は使わない。
//   default deny
//   allow read, export if user.org == resource.org and user.role in [member, admin]
//   deny  read if user.suspended == true
// 判定: deny が1つでも当てはまれば拒否 → allow が当てはまれば許可 → どれもなければ default。

export const ACTIONS = ['read', 'export', 'history', 'receipt', 'update', 'delete'] as const
export type Action = (typeof ACTIONS)[number]

export const ATTRS = [
  'user.org', 'user.role', 'user.suspended',
  'resource.org', 'resource.confidential', 'resource.status',
  'share.exists', 'share.revoked', 'share.scope',
] as const

export type Context = Record<(typeof ATTRS)[number], string>

type Operand = { attr: string } | { lit: string }
type Atom = { left: Operand; op: '==' | '!=' | 'in' | 'notin'; right: Operand | { list: string[] } }
export interface Rule {
  effect: 'allow' | 'deny'
  actions: Action[]
  atoms: Atom[]
  line: number
}
export interface Policy {
  defaultAllow: boolean
  rules: Rule[]
}
export type ParseResult = { ok: true; policy: Policy } | { ok: false; errors: string[] }

function operand(raw: string, line: number, errors: string[]): Operand {
  if (raw.includes('.')) {
    if (!(ATTRS as readonly string[]).includes(raw)) errors.push(`${line}行目: 未知の属性 ${raw}`)
    return { attr: raw }
  }
  return { lit: raw }
}

export function parsePolicy(text: string): ParseResult {
  const errors: string[] = []
  const policy: Policy = { defaultAllow: false, rules: [] }
  text.split('\n').forEach((raw, idx) => {
    const line = idx + 1
    const src = raw.replace(/#.*/, '').trim()
    if (!src) return
    if (/^default\s+(allow|deny)$/.test(src)) {
      policy.defaultAllow = src.endsWith('allow')
      return
    }
    const m = /^(allow|deny)\s+([a-z_,\s]+?)(?:\s+if\s+(.+))?$/.exec(src)
    if (!m) {
      errors.push(`${line}行目: 構文が読めない「${src}」`)
      return
    }
    const actions = m[2]!.split(',').map((a) => a.trim()).filter(Boolean)
    for (const a of actions) {
      if (!(ACTIONS as readonly string[]).includes(a)) errors.push(`${line}行目: 未知の操作 ${a}`)
    }
    const atoms: Atom[] = []
    if (m[3]) {
      for (const part of m[3].split(/\s+and\s+/)) {
        const am = /^(\S+)\s+(==|!=|in|notin)\s+(.+)$/.exec(part.trim())
        if (!am) {
          errors.push(`${line}行目: 条件が読めない「${part.trim()}」`)
          continue
        }
        const op = am[2] as Atom['op']
        const rhs = am[3]!.trim()
        let right: Atom['right']
        if (op === 'in' || op === 'notin') {
          const lm = /^\[(.*)\]$/.exec(rhs)
          if (!lm) {
            errors.push(`${line}行目: in の右側は [a, b] の形にする`)
            continue
          }
          right = { list: lm[1]!.split(',').map((s) => s.trim()).filter(Boolean) }
        } else {
          right = operand(rhs, line, errors)
        }
        atoms.push({ left: operand(am[1]!, line, errors), op, right })
      }
    }
    policy.rules.push({ effect: m[1] as Rule['effect'], actions: actions as Action[], atoms, line })
  })
  return errors.length ? { ok: false, errors } : { ok: true, policy }
}

function value(o: Operand, ctx: Context): string {
  return 'attr' in o ? ctx[o.attr as keyof Context] : o.lit
}

function matches(rule: Rule, action: Action, ctx: Context): boolean {
  if (!rule.actions.includes(action)) return false
  return rule.atoms.every((a) => {
    const l = value(a.left, ctx)
    if ('list' in a.right) {
      const has = a.right.list.includes(l)
      return a.op === 'in' ? has : !has
    }
    const r = value(a.right, ctx)
    return a.op === '==' ? l === r : l !== r
  })
}

export function decide(policy: Policy, action: Action, ctx: Context): boolean {
  let allowed = false
  for (const r of policy.rules) {
    if (!matches(r, action, ctx)) continue
    if (r.effect === 'deny') return false
    allowed = true
  }
  return allowed || policy.defaultAllow
}
