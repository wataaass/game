# LANTERNFALL

@DECISIONS.md

## 確認コマンド
- `npm run check` — lint → テスト → 単一ファイルのビルド。コードを変えたら必ず通す
- `npm test` — シミュレーションのテストだけ（数秒）
- `npm run balance -- 30` — 腕前の違う bot に通しで遊ばせ、クリア率を集計する。敵や強化の数値を変えたら見る
- `npm start` — http://localhost:8080 で起動

## 守ること
- `src/sim` と `src/core` は決定的に保つ（DOM・時刻・`Math.random` 禁止。乱数は `G.rng` だけ）
- 見た目だけの乱数（パーティクルなど）は `src/render` 側で `Math.random` を使ってよい。シミュレーションへ値を戻さない
- モジュール直下の名前は全ファイルで重ならないようにする（バンドラが1つのスコープに並べるため。lint が検出する）
- `import * as` と `export default` / `export { }` は使わない（同上）
- シミュレーションの挙動を変えたら `SIM_VERSION` を上げる（古いリプレイを誤再生しないため）
- `dist/lanternfall.html` は `npm run build` の生成物。手で編集しない
