import { Fragment, useState } from 'react'
import { getChallenge } from '../challenges'
import { toJsonl, verifyChain } from '../log/chain'
import { replayLog } from '../log/replay'
import { download, lab } from '../state'

const TYPE_LABEL = { start: '開始', exec: '実行', submit: '提出', hint: 'ヒント', reset: 'やり直し' } as const

export function LogView() {
  const entries = lab.log()
  const chain = verifyChain(entries)
  const [filter, setFilter] = useState('all')
  const [open, setOpen] = useState<number | null>(null)
  const attempts = replayLog(entries).filter((a) => !a.abandoned || a.solved)
  const ids = [...new Set(entries.map((e) => e.challengeId))]
  const shown = [...entries].reverse().filter((e) => filter === 'all' || e.challengeId === filter)

  return (
    <div className="page">
      <h1>操作ログ</h1>
      <p className="muted">
        すべての操作が、直前の記録のハッシュを含む形で記録されます(改ざん・削除・並べ替えが検出できます)。ログはこのブラウザの中にだけ保存され、外には送られません。
      </p>
      <div className={`banner ${chain.ok ? 'good' : 'bad'}`}>
        {chain.ok ? `✓ 連鎖は正常です(${entries.length} 件)` : `✗ ${chain.brokenAt} 件目で連鎖が壊れています: ${chain.reason}`}
      </div>

      {attempts.length > 0 && (
        <section>
          <h2>挑戦ごとの結果(ログを再生して再計算)</h2>
          <table>
            <thead>
              <tr>
                <th>課題</th>
                <th>シード</th>
                <th>入力</th>
                <th>ヒント</th>
                <th>結果</th>
                <th>得点</th>
                <th>再生検証</th>
              </tr>
            </thead>
            <tbody>
              {attempts.map((a) => (
                <tr key={a.attempt}>
                  <td>{getChallenge(a.challengeId)?.title ?? a.challengeId}</td>
                  <td>
                    <code>{a.seed}</code>
                  </td>
                  <td>{a.steps}</td>
                  <td>{a.hints}</td>
                  <td>{a.solved ? '✓ クリア' : a.abandoned ? 'やり直し' : '挑戦中'}</td>
                  <td>{a.score}</td>
                  <td>{a.consistent ? '一致' : <span className="bad-text">不一致</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section>
        <div className="row">
          <h2>記録(新しい順)</h2>
          <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="課題で絞り込み">
            <option value="all">すべての課題</option>
            {ids.map((i) => (
              <option key={i} value={i}>
                {getChallenge(i)?.title ?? i}
              </option>
            ))}
          </select>
          <button onClick={() => download('secdrill-log.jsonl', toJsonl(entries))} disabled={!entries.length}>
            JSONL で書き出す
          </button>
        </div>
        {shown.length === 0 && <p className="dim">まだ記録がありません。</p>}
        <table className="logtable">
          <thead>
            <tr>
              <th>#</th>
              <th>時刻</th>
              <th>課題</th>
              <th>種類</th>
              <th>入力</th>
              <th>ハッシュ</th>
            </tr>
          </thead>
          <tbody>
            {shown.slice(0, 300).map((e) => (
              <Fragment key={e.seq}>
                <tr onClick={() => setOpen(open === e.seq ? null : e.seq)} className="click">
                  <td>{e.seq}</td>
                  <td>{e.at.replace('T', ' ').slice(0, 19)}</td>
                  <td>{getChallenge(e.challengeId)?.title ?? e.challengeId}</td>
                  <td>
                    {TYPE_LABEL[e.type]}
                    {e.solved ? ' ✓' : ''}
                  </td>
                  <td className="trunc">{e.input.split('\n')[0]}</td>
                  <td>
                    <code>{e.hash.slice(0, 8)}</code>
                  </td>
                </tr>
                {open === e.seq && (
                  <tr className="detail">
                    <td colSpan={6}>
                      <pre>{`入力:\n${e.input || '(なし)'}\n\n出力:\n${e.output || '(なし)'}\n\nprev=${e.prev}\nhash=${e.hash}`}</pre>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        {shown.length > 300 && <p className="dim">新しい 300 件を表示しています。全件は JSONL で書き出せます。</p>}
      </section>
    </div>
  )
}
