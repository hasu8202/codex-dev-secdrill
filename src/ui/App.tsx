import { useEffect, useState } from 'react'
import { BoardView } from './BoardView'
import { ChallengeView } from './ChallengeView'
import { HomeView } from './HomeView'
import { LogView } from './LogView'
import { SettingsView } from './SettingsView'
import { getPlayer, lab, useVersion } from '../state'

function useRoute(): string {
  const [hash, setHash] = useState(location.hash || '#/')
  useEffect(() => {
    const on = () => {
      setHash(location.hash || '#/')
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return hash
}

const NAV: [string, string][] = [
  ['#/', '課題'],
  ['#/log', '操作ログ'],
  ['#/board', '対戦・スコア'],
  ['#/settings', '設定'],
]

export function App() {
  const route = useRoute()
  useVersion()
  const challengeId = /^#\/c\/([\w-]+)$/.exec(route)?.[1]

  let view
  if (challengeId) view = <ChallengeView key={challengeId} id={challengeId} />
  else if (route === '#/log') view = <LogView />
  else if (route === '#/board') view = <BoardView />
  else if (route === '#/settings') view = <SettingsView />
  else view = <HomeView />

  return (
    <>
      <header className="top">
        <a className="brand" href="#/">
          <span className="brand-mark">◆</span> SecDrill <small>セキュリティ演習場</small>
        </a>
        <nav>
          {NAV.map(([href, label]) => (
            <a key={href} href={href} className={route === href ? 'on' : ''}>
              {label}
            </a>
          ))}
        </nav>
        <div className="who">
          {getPlayer()} <b>{lab.totalBest()}</b> pt
        </div>
      </header>
      <div className="sandbox-banner" role="note">
        すべて模擬データ上の演習です。実在のサービス・外部ネットワークには一切つながりません。
      </div>
      <main>{view}</main>
    </>
  )
}
