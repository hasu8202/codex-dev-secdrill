import { bump, lab, saveImports } from '../state'

export function SettingsView() {
  return (
    <div className="page">
      <h1>設定・初期化</h1>

      <section className="panel">
        <h2>演習の初期化</h2>
        <p>すべての課題を最初の状態に戻します。操作ログと最高記録は残ります(やり直しの記録がログに追加されます)。</p>
        <button
          onClick={() => {
            if (confirm('すべての課題を最初の状態に戻します。よろしいですか?')) {
              lab.resetAll()
              bump()
            }
          }}
        >
          すべての課題を初期状態に戻す
        </button>
      </section>

      <section className="panel danger">
        <h2>すべて消去</h2>
        <p>操作ログ・進行・最高記録・取り込んだ友達の結果を、このブラウザからすべて消します。元には戻せません。</p>
        <button
          className="warn-btn"
          onClick={() => {
            if (confirm('ログ・記録・取り込んだ結果をすべて消します。元には戻せません。よろしいですか?')) {
              lab.wipeEverything()
              saveImports([])
              bump()
            }
          }}
        >
          すべて消去する
        </button>
      </section>

      <section className="panel">
        <h2>安全のしくみ</h2>
        <ul>
          <li>サーバーを持たない静的なアプリです。ネットワーク通信のコードがなく、ページの CSP も通信を遮断しています。</li>
          <li>課題の相手は、この画面の中だけにある模擬データです。ホスト名は演習用の <code>example.test</code>、IP は文書用の予約範囲だけを使います。</li>
          <li>入力は限定的なコマンドとして自作のインタプリタが処理します。任意コードの実行(eval)やファイル・OS の操作はしません。</li>
          <li>データはこのブラウザの localStorage にだけ保存されます。ajito など他のアプリには触れません。</li>
          <li>ソースを読めば正解が分かる作りです(ブラウザだけで動くため)。友人どうしの合意と信頼を前提にした演習です。</li>
        </ul>
      </section>
    </div>
  )
}
