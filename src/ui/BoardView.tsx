import { useRef, useState } from 'react'
import { getChallenge } from '../challenges'
import { replayLog } from '../log/replay'
import { countable, exportResult, headToHead, importResult, type Imported } from '../log/result'
import { download, getImports, getPlayer, lab, saveImports, setPlayer } from '../state'

export function BoardView() {
  const [error, setError] = useState('')
  const [pasted, setPasted] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const imports = getImports()
  const me = getPlayer()

  const mine: Imported = {
    player: me,
    importedAt: '',
    chain: { ok: true },
    results: replayLog(lab.log()),
  }
  const players = [{ name: me, imported: mine }, ...imports.map((i) => ({ name: i.player, imported: i }))]
  const table = headToHead(players)
  const contested = [...table.entries()].filter(([, rows]) => rows.length >= 2)
  const solo = [...table.entries()].filter(([, rows]) => rows.length < 2)

  const load = (text: string) => {
    const r = importResult(text)
    if (!r.ok) return setError(r.error)
    setError('')
    // 同じ名前の人は置き換える
    saveImports([...imports.filter((i) => i.player !== r.imported.player), r.imported])
    setPasted('')
  }

  const label = (key: string) => {
    const [id, seed] = key.split('#')
    return `${getChallenge(id!)?.title ?? id}(シード ${seed})`
  }

  return (
    <div className="page">
      <h1>対戦・スコア</h1>
      <p className="muted">
        友達と<b>同じ課題・同じシード</b>で挑戦し、結果ファイルを交換して比べます。受け取った側は、ログの連鎖と、入力の再生による出力の照合で、結果が本物かを自動で確かめます。通信は使いません(ファイルを渡す方法は自由です)。
      </p>

      <section className="panel">
        <h2>1. 自分の結果を渡す</h2>
        <div className="inputrow">
          <label>
            名前{' '}
            <input value={me} maxLength={24} onChange={(e) => setPlayer(e.target.value)} aria-label="自分の名前" />
          </label>
          <button className="primary" onClick={() => download(`secdrill-result-${me}.json`, exportResult(lab, me))} disabled={!lab.log().length}>
            結果ファイルを書き出す
          </button>
        </div>
        <p className="dim small">ファイルにはこのブラウザの操作ログ全体が入ります。入れたくない場合は、設定でログを消してから挑戦してください。</p>
      </section>

      <section className="panel">
        <h2>2. 友達の結果を取り込む</h2>
        <div className="inputrow">
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            onChange={async (e) => {
              const f = e.target.files?.[0]
              if (f) load(await f.text())
              e.target.value = ''
            }}
          />
        </div>
        <textarea rows={3} placeholder="またはここに結果ファイルの中身を貼り付け" value={pasted} onChange={(e) => setPasted(e.target.value)} />
        <div className="inputrow">
          <button onClick={() => load(pasted)} disabled={!pasted.trim()}>
            貼り付けた内容を取り込む
          </button>
        </div>
        {error && <p className="bad-text">{error}</p>}

        {imports.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>名前</th>
                <th>ログの連鎖</th>
                <th>有効な結果</th>
                <th>再生で不一致</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {imports.map((i) => (
                <tr key={i.player}>
                  <td>{i.player}</td>
                  <td>{i.chain.ok ? '✓ 正常' : <span className="bad-text">✗ 破損({i.chain.brokenAt}件目)</span>}</td>
                  <td>{i.results.filter((r) => countable(i, r)).length}</td>
                  <td>{i.results.filter((r) => !r.consistent).length}</td>
                  <td>
                    <button onClick={() => saveImports(imports.filter((x) => x.player !== i.player))}>取り除く</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2>同じシードの勝負</h2>
        {contested.length === 0 && <p className="dim">まだ比べられる結果がありません。友達と同じシード(課題画面で指定できます)で解き、結果を取り込んでください。</p>}
        {contested.map(([key, rows]) => (
          <div key={key} className="panel">
            <h3>{label(key)}</h3>
            <ol className="rank">
              {rows.map((r, i) => (
                <li key={r.player} className={i === 0 ? 'first' : ''}>
                  <b>{r.player}</b> — {r.score} pt({r.steps} 手・ヒント {r.hints})
                </li>
              ))}
            </ol>
          </div>
        ))}
      </section>

      {solo.length > 0 && (
        <section>
          <h2>比較相手のいない結果</h2>
          <ul>
            {solo.map(([key, rows]) => (
              <li key={key}>
                {label(key)}: {rows[0]!.player} {rows[0]!.score} pt
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
