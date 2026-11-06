# SecDrill(セキュリティ演習場) — プロジェクト固有のルール

共通の方針は `C:/Users/kkth8/source/CodexProjects/AGENTS.md`(Codex では `~/.codex/AGENTS.md`)に従う。ここにはこのプロジェクト固有のことだけを書く。

## 目的と絶対に守ること

友人と合意のうえで、セキュリティの設計・実装の理解を競う**模擬の演習環境**。大学生レベルで、設計や実装を理解していないと解けない課題にする。

- **ajito など他のプロジェクトから完全に独立**。他のフォルダのファイル・設定は読み書きしない(このフォルダ内だけ)。
- **実際の脆弱なシステムは作らない**。脆弱性は模擬モデル(課題ごとの状態機械+限定コマンド)で表現する。
- **実際の攻撃コード・外部への攻撃機能は作らない**。ネットワーク通信(`fetch`/XHR/WebSocket など)・`eval`/`new Function`・OS やファイルの操作をソースに入れない。`tests/engine.test.ts` の「安全性」テストが自動で検出する(通信・動的実行の禁止、URL は `*.test` のみ、CSP に `connect-src 'none'`)。
- 課題の中の名前・URL・IP は演習用の架空のもの(`example.test`、`203.0.113.0/24` など)だけを使う。鍵や資格情報は明示的な偽物。
- 課題を足しても、実在のサービス・製品の脆弱性を再現する手順にしない(一般的な設計上の誤りの模型にとどめる)。

## 道具とコマンド

- Node 26 / npm 12。Vite 8 + TypeScript + React 19 + Vitest。依存は最小(react / react-dom のみ)。
- 一括検証: `pwsh -NoProfile -File scripts/codex-verify.ps1`(typecheck → test → build)
- テスト: `npm test` / 型: `npm run typecheck` / ビルド: `npm run build`(`dist/` に出力)
- 開発: `npm run dev`(127.0.0.1:5317)/ 配布物の確認: `npm run build` → `npm run preview`(127.0.0.1:5318)
- 配布物 `dist/index.html` は **ダブルクリックで開ける**(`vite.config.ts` の `classicScript` が type=module を外し、IIFE の単一スクリプトにして CSS も JS に含める)。外部へのリクエストはゼロ。

## 構成

- `src/engine/` 共通基盤: `rng.ts`(シード付き乱数)、`types.ts`(課題の型)、`run.ts`(入力の実行を共通化)、`score.ts`(採点)、`sha256.ts`(同期 SHA-256)、`storage.ts`(localStorage+メモリ退避)、`lab.ts`(進行・ログ・リセットを束ねる `Lab`)。
- `src/log/chain.ts`: 操作ログのハッシュ連鎖(各行に直前のハッシュ)。`replay.ts`: ログの入力を模擬システムに通し直して出力を照合(`consistent`)。`result.ts`: 友達と交換する結果ファイル(ログ全体入り)と、同じシードの順位表。
- `src/challenges/`: 1課題=1ファイル。`index.ts` に登録。`policy-dsl.ts` は認可ポリシーの小さな言語(自作インタプリタ)。
- `src/ui/`: 画面(App・Home・Challenge・Log・Board・Settings)と `styles.css`。`src/state.ts` は Lab の単一インスタンスと再描画。

## 課題の作り方(約束事)

- `Challenge` を実装し、`create(seed)` が返す `Session` の `exec(line)`(console 型)か `submit(text)`(editor/audit 型)だけで外とやり取りする。**同じシード・同じ入力なら必ず同じ出力**(再生検証が前提。`Math.random`・`Date` は課題の中で使わない。乱数は `Rng`)。
- 資料(`docs(seed)`)も同じシードから生成する。攻撃型は「資料を読んで初めて道筋が分かる」作りにし、解の経路はシードで変える。
- 追加したら `tests/challenges.test.ts` に「どのシードでも解ける」「素朴な近道では解けない」ことのテストを必ず足す(解法を実装したソルバーで確認)。
- 得点は `score.ts`(基礎点×達成率×効率×ヒント係数)。`par` は理想の入力回数。

## 注意点

- 静的アプリなので、ソースを読めば正解が分かる(`designThreatKey`・`forensicsAnswer` はテスト用に公開)。友人どうしの合意と信頼が前提。結果ファイルの検証は「ログの連鎖+再生」で、カジュアルな不正を見つけるためのもの。
- ログ・進行・取り込んだ結果は localStorage(`secdrill.v1.*`)にだけ保存する。設定画面から「初期化」「すべて消去」できる。
- Windows の git は改行を LF に揃える(`.gitattributes`)。
- PowerShell から `npx` が動かない環境がある。その場合は Bash から実行するか `npm run` を使う。

## 共有Vault

- 共有Vault(Obsidian互換、Claude Code と Codex で共用): `C:\Users\kkth8\Desktop\AI-DataBase\AI_DataBase`
- 作業開始時に、Vault の `projects/secdrill.md` と `shared/context.md` を読む。
- 作業の区切りで `projects/secdrill.md` の「現在の状態」と「直近の決定事項」を更新する(frontmatter の date を更新し、author は claude-code か codex)。
- APIキー・パスワード・トークン・`.env` の中身などの秘密情報は Vault に書かない。
