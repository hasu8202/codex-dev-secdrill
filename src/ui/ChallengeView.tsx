import { useEffect, useMemo, useRef, useState } from 'react'
import { getChallenge } from '../challenges'
import type { TranscriptItem } from '../engine/lab'
import { DOMAIN_LABEL, MODE_LABEL, type Challenge, type Doc } from '../engine/types'
import { bump, lab } from '../state'

function DocView({ doc }: { doc: Doc }) {
  const [filter, setFilter] = useState('')
  if (doc.kind === 'log') {
    const lines = doc.body.split('\n')
    const shown = filter ? lines.filter((l) => l.toLowerCase().includes(filter.toLowerCase())) : lines
    return (
      <div>
        <div className="filter">
          <input placeholder="絞り込み(例: 203.0.113 / fail / user=sato)" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <span className="dim">
            {shown.length} / {lines.length} 行
          </span>
        </div>
        <pre className="doc log">{shown.join('\n')}</pre>
      </div>
    )
  }
  return <pre className={`doc ${doc.kind}`}>{doc.body}</pre>
}

function Docs({ ch, seed }: { ch: Challenge; seed: number }) {
  const docs = useMemo(() => ch.docs(seed), [ch, seed])
  const [tab, setTab] = useState(0)
  const cur = docs[Math.min(tab, docs.length - 1)]!
  return (
    <section className="panel docs">
      <div className="tabs">
        {docs.map((d, i) => (
          <button key={d.title} className={i === tab ? 'on' : ''} onClick={() => setTab(i)}>
            {d.title}
          </button>
        ))}
      </div>
      <DocView key={`${seed}-${tab}`} doc={cur} />
    </section>
  )
}

function Console({ id, transcript }: { id: string; transcript: readonly TranscriptItem[] }) {
  const [value, setValue] = useState('')
  const [cursor, setCursor] = useState<number | null>(null)
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' })
  }, [transcript.length])
  const sent = transcript.map((t) => t.text)

  const run = () => {
    const line = value.trim()
    if (!line) return
    lab.exec(id, line)
    setValue('')
    setCursor(null)
    bump()
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') run()
    else if (e.key === 'ArrowUp' && sent.length) {
      e.preventDefault()
      const i = cursor === null ? sent.length - 1 : Math.max(0, cursor - 1)
      setCursor(i)
      setValue(sent[i]!)
    } else if (e.key === 'ArrowDown' && cursor !== null) {
      e.preventDefault()
      const i = cursor + 1
      if (i >= sent.length) {
        setCursor(null)
        setValue('')
      } else {
        setCursor(i)
        setValue(sent[i]!)
      }
    }
  }
  return (
    <section className="panel console">
      <h2>模擬システムの操作</h2>
      <div className="screen" aria-live="polite">
        {transcript.length === 0 && <p className="dim">コマンドを入力してください。分からなければ help。</p>}
        {transcript.map((t, i) => (
          <div key={i} className={`entry ${t.solved ? 'solved' : ''}`}>
            <div className="cmd">
              <span className="prompt">›</span> {t.text}
            </div>
            <pre className="res">{t.lines.join('\n')}</pre>
          </div>
        ))}
        <div ref={end} />
      </div>
      <div className="inputrow">
        <span className="prompt">›</span>
        <input
          autoFocus
          spellCheck={false}
          autoComplete="off"
          value={value}
          placeholder="コマンドを入力して Enter(↑↓で履歴)"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKey}
        />
        <button className="primary" onClick={run}>
          実行
        </button>
      </div>
    </section>
  )
}

function Editor({ ch, id, seed, transcript }: { ch: Challenge; id: string; seed: number; transcript: readonly TranscriptItem[] }) {
  const lastSubmit = [...transcript].reverse().find((t) => t.kind === 'submit')
  const [text, setText] = useState(() => lastSubmit?.text ?? ch.initialText?.(seed) ?? '')
  const submit = () => {
    lab.submit(id, text)
    bump()
  }
  return (
    <section className="panel editor">
      <h2>{ch.mode === 'defend' ? 'ポリシーを編集して提出' : '回答を書いて提出'}</h2>
      <textarea spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} rows={16} aria-label="提出内容" />
      <div className="inputrow">
        <button className="primary" onClick={submit}>
          提出して採点
        </button>
        <button onClick={() => setText(ch.initialText?.(seed) ?? '')}>初期状態に戻す</button>
        <span className="dim">提出 {transcript.filter((t) => t.kind === 'submit').length} 回</span>
      </div>
      {lastSubmit && (
        <div className={`verdict ${lastSubmit.solved ? 'good' : 'bad'}`}>
          <b>{lastSubmit.solved ? '合格' : '不合格'}</b>
          {lastSubmit.lines.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      )}
    </section>
  )
}

export function ChallengeView({ id }: { id: string }) {
  const ch = getChallenge(id)
  const [seedText, setSeedText] = useState('')
  if (!ch) return <div className="page">課題が見つかりません。<a href="#/">一覧へ</a></div>
  const p = lab.begin(id)
  const transcript = lab.transcript(id)
  const shownHints = ch.hints.slice(0, p.hints)

  const setSeed = () => {
    const n = Number(seedText)
    if (!Number.isInteger(n) || n < 0 || n > 4294967295) return
    if (p.inputs.length && !confirm('入力履歴をいったん片付けて、このシードの問題を最初から始めます。よろしいですか?')) return
    lab.restart(id, { seed: n })
    setSeedText('')
    bump()
  }

  return (
    <div className="page challenge">
      <div className="crumbs">
        <a href="#/">← 課題一覧</a>
        <span className="dim">{DOMAIN_LABEL[ch.domain]}</span>
      </div>
      <h1>{ch.title}</h1>
      <p className="objective">
        <b>目標:</b> {ch.objective}
      </p>

      {p.solved && (
        <div className="banner good" role="status">
          ✓ クリア! {p.steps} 手・ヒント {p.hints} 回 → <b>{p.score} pt</b>(理想 {ch.par} 手)。続けて試してもかまいません。
        </div>
      )}

      <div className="grid">
        <div className="main">
          <Docs ch={ch} seed={p.seed} />
          {ch.input === 'console' ? (
            <Console id={id} transcript={transcript} />
          ) : (
            <Editor key={p.attempt} ch={ch} id={id} seed={p.seed} transcript={transcript} />
          )}
        </div>

        <aside className="side">
          <section className="panel">
            <h2>状況</h2>
            <dl className="stats">
              <dt>種類</dt>
              <dd>{MODE_LABEL[ch.mode]}</dd>
              <dt>入力回数</dt>
              <dd>
                {p.inputs.length}(理想 {ch.par})
              </dd>
              <dt>ヒント</dt>
              <dd>{p.hints} / {ch.hints.length}(1回 −10%)</dd>
              <dt>得点</dt>
              <dd>{p.solved ? `${p.score} pt` : `未クリア(基礎 ${ch.points} pt)`}</dd>
              <dt>シード</dt>
              <dd>
                <code>{p.seed}</code>
              </dd>
            </dl>
            <p className="dim small">同じシードなら、友達と同じ問題になります。</p>
          </section>

          <section className="panel">
            <h2>ヒント</h2>
            {shownHints.length === 0 && <p className="dim small">まずは資料を読みましょう。詰まったら開けます。</p>}
            <ol className="hints">
              {shownHints.map((h, i) => (
                <li key={i}>{h}</li>
              ))}
            </ol>
            {p.hints < ch.hints.length && (
              <button
                onClick={() => {
                  lab.useHint(id)
                  bump()
                }}
              >
                ヒントを開く(−10%)
              </button>
            )}
          </section>

          <section className="panel">
            <h2>やり直し</h2>
            <div className="stack">
              <button
                onClick={() => {
                  lab.restart(id)
                  bump()
                }}
              >
                同じ問題を最初から
              </button>
              <button
                onClick={() => {
                  lab.restart(id, { newSeed: true })
                  bump()
                }}
              >
                別の問題(新しいシード)
              </button>
              <div className="inputrow">
                <input
                  inputMode="numeric"
                  placeholder="シードを指定(友達と合わせる)"
                  value={seedText}
                  onChange={(e) => setSeedText(e.target.value)}
                />
                <button onClick={setSeed}>開始</button>
              </div>
            </div>
            <p className="dim small">やり直しても、操作ログは残ります(設定から消せます)。</p>
          </section>
        </aside>
      </div>
    </div>
  )
}
