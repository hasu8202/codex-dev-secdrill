import { CHALLENGES } from '../challenges'
import { DOMAIN_LABEL, MODE_LABEL } from '../engine/types'
import { lab } from '../state'

const MODE_SHORT = { attack: '攻撃', defend: '防御', audit: '監査' } as const

export function HomeView() {
  const domains = [...new Set(CHALLENGES.map((c) => c.domain))]
  const solved = CHALLENGES.filter((c) => lab.bestScore(c.id) > 0).length
  return (
    <div className="page">
      <section className="hero">
        <h1>模擬システムで、守りと攻めを学ぶ</h1>
        <p>
          認証・認可、セッション、入力検証、API、暗号、設計、ログ分析。実際の脆弱なシステムは作らず、
          <b>設計と実装を理解していないと解けない</b>模擬モデルを相手にします。操作はすべてログに残り、友達と同じ問題(同じシード)で競えます。
        </p>
        <p className="muted">
          攻略済み {solved} / {CHALLENGES.length} 課題・合計 {lab.totalBest()} pt
        </p>
      </section>

      {domains.map((d) => (
        <section key={d}>
          <h2>{DOMAIN_LABEL[d]}</h2>
          <div className="cards">
            {CHALLENGES.filter((c) => c.domain === d).map((c) => {
              const p = lab.progressOf(c.id)
              const best = lab.bestScore(c.id)
              return (
                <a key={c.id} className={`card ${best > 0 ? 'done' : ''}`} href={`#/c/${c.id}`}>
                  <div className="tags">
                    <span className={`tag mode-${c.mode}`} title={MODE_LABEL[c.mode]}>
                      {MODE_SHORT[c.mode]}
                    </span>
                    <span className="tag" title="難易度">
                      {'★'.repeat(c.difficulty)}
                      <span className="dim">{'★'.repeat(3 - c.difficulty)}</span>
                    </span>
                    <span className="tag">{c.points} pt</span>
                  </div>
                  <h3>{c.title}</h3>
                  <p>{c.summary}</p>
                  <div className="card-foot">
                    {best > 0 ? (
                      <span className="ok">✓ 最高 {best} pt</span>
                    ) : p ? (
                      <span className="warn">挑戦中({p.inputs.length} 手)</span>
                    ) : (
                      <span className="dim">未挑戦</span>
                    )}
                  </div>
                </a>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
