import type { Challenge } from '../engine/types'
import { noExec } from './util'
import { ACTIONS, decide, parsePolicy, type Action, type Context } from './policy-dsl'

// 認可(防御): 請求書サービスのアクセス制御ポリシーを書き直す。
// 要件どおりに動くか(許すべきものは許し、拒むべきものは拒む)を、全組み合わせで検証する。

const REQUIREMENTS = `請求書サービスのアクセス制御 要件(すべて満たすこと)

R1. 停止中の利用者(user.suspended)は、どの操作もできない。
R2. 更新(update)は、請求書を発行した組織の管理者(admin)だけ。
    削除(delete)は、さらに請求書が下書き(resource.status == draft)のときだけ。
R3. 同じ組織(user.org == resource.org)の場合:
    - 閲覧(read)は member / admin / guest のすべて。
    - 書き出し(export)・履歴(history)・領収書(receipt)は member / admin のみ(guest は不可)。
R4. 機密の請求書(resource.confidential == true)は、
    - 他の組織には、共有されていても一切見せない。
    - 同じ組織でも admin だけが read / export / history / receipt できる。
R5. 他の組織の利用者は、有効な共有(share.exists かつ取り消されていない)があるときだけ:
    - read / receipt ができる。
    - export / history は共有の範囲(share.scope)が full のときだけ。
    共有を取り消した(share.revoked)後は、どの操作もできない。

書き方(ポリシー言語):
  default deny
  allow <操作>[, <操作>...] [if <条件> [and <条件>...]]
  deny  <操作>[, ...]       [if <条件> [and ...]]
  判定: deny が1つでも当てはまれば拒否。なければ allow が当てはまれば許可。どれもなければ default。
  条件: <属性または値> == != <属性または値>   /   <属性> in [値, 値]   /   <属性> notin [値, 値]
  操作: ${ACTIONS.join(' ')}
  属性: user.org user.role(member|admin|guest) user.suspended(true|false)
        resource.org resource.confidential(true|false) resource.status(draft|issued)
        share.exists(true|false) share.revoked(true|false) share.scope(none|read|full)
  共有が無いとき: share.exists=false, share.revoked=false, share.scope=none
  # 以降はコメント`

const INITIAL = `# 現行のポリシー(要件を満たしていない)
default deny
allow read if user.org == resource.org
allow read if share.exists == true
allow export, history, receipt if user.role != guest
allow update, delete if user.org == resource.org
`

function reference(a: Action, c: Context): boolean {
  if (c['user.suspended'] === 'true') return false
  const same = c['user.org'] === c['resource.org']
  const role = c['user.role']
  if (a === 'update') return same && role === 'admin'
  if (a === 'delete') return same && role === 'admin' && c['resource.status'] === 'draft'
  if (same) {
    if (c['resource.confidential'] === 'true') return role === 'admin'
    return a === 'read' ? true : role !== 'guest'
  }
  if (c['resource.confidential'] === 'true') return false
  if (c['share.exists'] !== 'true' || c['share.revoked'] === 'true') return false
  if (a === 'read' || a === 'receipt') return true
  return c['share.scope'] === 'full'
}

const SHARES: [string, string, string][] = [
  ['false', 'false', 'none'],
  ['true', 'false', 'read'],
  ['true', 'false', 'full'],
  ['true', 'true', 'read'],
  ['true', 'true', 'full'],
]

function* contexts(): Generator<Context> {
  for (const org of ['acme', 'borealis'])
    for (const role of ['member', 'admin', 'guest'])
      for (const suspended of ['false', 'true'])
        for (const confidential of ['false', 'true'])
          for (const status of ['draft', 'issued'])
            for (const [exists, revoked, scope] of org === 'acme' ? [SHARES[0]!] : SHARES)
              yield {
                'user.org': org, 'user.role': role, 'user.suspended': suspended,
                'resource.org': 'acme', 'resource.confidential': confidential, 'resource.status': status,
                'share.exists': exists, 'share.revoked': revoked, 'share.scope': scope,
              }
}

function describe(a: Action, c: Context): string {
  const who = c['user.org'] === c['resource.org'] ? `同じ組織の ${c['user.role']}` : `他組織の ${c['user.role']}`
  const share =
    c['share.exists'] === 'true' ? `、共有=${c['share.revoked'] === 'true' ? '取り消し済み' : '有効'}(${c['share.scope']})` : ''
  const flags = [
    c['user.suspended'] === 'true' ? '停止中' : '',
    c['resource.confidential'] === 'true' ? '機密' : '',
    c['resource.status'] === 'draft' ? '下書き' : '',
  ].filter(Boolean)
  return `${who}${flags.length ? '(' + flags.join('・') + ')' : ''}${share} が ${a}`
}

export const authzPolicy: Challenge = {
  id: 'authz-policy',
  title: '請求書サービスのポリシーを直す',
  domain: 'authz',
  mode: 'defend',
  input: 'editor',
  difficulty: 3,
  points: 400,
  par: 3,
  summary: '穴だらけのアクセス制御ポリシーを、要件どおりに書き直す。許しすぎも、拒みすぎも不合格。',
  objective: '要件 R1〜R5 のすべての組み合わせ(864通り)で、期待どおりの許可・拒否になるポリシーを提出する。',
  hints: [
    '拒否(deny)は許可(allow)より常に優先される。「例外なく止めたいこと」は deny で書くと確実。',
    '停止中・機密・他組織の三つは、先に deny でふさぐ。そのうえで allow を最小限に足す。',
    '他組織の共有は「存在する」だけでなく「取り消されていない」ことも条件に入れる。export / history は scope も見る。',
  ],
  docs: () => [{ title: '要件とポリシー言語', kind: 'text', body: REQUIREMENTS }],
  initialText: () => INITIAL,
  create() {
    return {
      exec: noExec,
      submit(text) {
        const parsed = parsePolicy(text)
        if (!parsed.ok) return { ratio: 0, solved: false, messages: ['ポリシーを読み込めません:', ...parsed.errors.slice(0, 6)] }
        let total = 0
        let falseAllow = 0
        let falseDeny = 0
        const examples: string[] = []
        for (const c of contexts()) {
          for (const a of ACTIONS) {
            total++
            const want = reference(a, c)
            const got = decide(parsed.policy, a, c)
            if (want === got) continue
            if (got) falseAllow++
            else falseDeny++
            if (examples.length < 4) examples.push(`${got ? '許しすぎ' : '拒みすぎ'}: ${describe(a, c)}`)
          }
        }
        const bad = falseAllow + falseDeny
        if (bad === 0) {
          return { ratio: 1, solved: true, messages: [`${total}通りすべてが要件どおり。`, `ルール ${parsed.policy.rules.length} 本。`] }
        }
        return {
          ratio: 0.5 * ((total - bad) / total) ** 4,
          solved: false,
          messages: [
            `${total}通り中 ${bad} 通りが要件と食い違う(許しすぎ ${falseAllow} / 拒みすぎ ${falseDeny})。`,
            ...examples,
          ],
        }
      },
    }
  },
}
