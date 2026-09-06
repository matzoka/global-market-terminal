# IMPROVEMENT_BACKLOG — Global Market Terminal

自己改善型メンテナンス用の正式バックログ。
コード・実態調査は GitHub `main` が正本。改善は常に
`発見 → backlog登録 → Discord提案 → 承認 → 実装 → test → main Push → Cloudflare自動Deploy → 本番確認 → Completed更新`
の順。

最優先目標: コードを綺麗にすることではなく、
**Global Market Terminal を「実際の投資判断に役立つツール」へ進化させること。**

---

## 運用手順（確定・2026-09-06）

自己改善ループの標準フロー:

1. Hermes が改善提案を作成（この BACKLOG に起票し、提案文を作成）
2. Hermes が内容を自己レビューし、ユーザーが確認
3. ユーザーが Discord へ**手動投稿**
4. Discord での**承認**（人間側が判断）
5. Hermes が実装
6. テスト・本番確認（`npm test` / 16/16 / Cloudflare 自動 Deploy）
7. 完了報告

**自動化方針（将来）**
- Discord への自動投稿は、この運用を数回回して安定してから検討。
- 自動化する場合でも、「提案投稿」と「実装結果報告」は自動化候補とし、**本番変更につながる「実装承認」は人間側に残す**。

---

## 正常ベースライン（固定・2026-09-06 確定）

以下は現在の「正常」の定義。これらが満たされている間は P0 障害とみなさない。

| 項目 | 基準 |
| --- | --- |
| 現在値 | **16/16** 正常（ユーザー側受入確認セット・後述） |
| 詳細チャート | **16/16** 正常（同上・bars 取得） |
| 自動テスト | `npm test` **9/9** 通過 |
| 本番経路 | GitHub `main` → Cloudflare Builds → Workers（`https://global-market-terminal.matzoka.workers.dev/`） |
| 旧環境 | Ubuntu 旧本番・Tailscale `:8443` 経路は**完全撤去済み** |

調査時点での本番 `/api/v1/dashboard` は全43銘柄のうち42を返却（FTSE のみ無料ソース非対応で `UNAVAILABLE`）、
FX/暗号/金属とも値を返していることを curl で確認済み。

---

## 指標の定義（重要）

### 「43 銘柄」＝ 全登録銘柄数（内部指標）
- `server/instruments.mjs` に登録された全インストルメント。`npm test` も `instruments.length === 43` を検証。
- FTSE を含む。FTSE は無料ソースでカバーされないため恒常的に `UNAVAILABLE`。

### 「16/16」＝ ユーザー側受入確認セット（外部指標・アプリ内定数なし）
- **コード調査結果**: アプリ内に `16` という定数・カウンターは存在しない。該当箇所:
  - `researchIds` フラット = 15（global 6 + fx 5 + crypto 4）
  - `COMPARE_IDS` = 8
  - 全銘柄 = 43
- したがって **`16/16` はアプリが自動算出する指標ではなく、ユーザーが受入確認に用いる主要銘柄セット（手動/別管理）である。**
- **全銘柄43とは別の指標**として扱う。43は「登録されているすべて」、16/16は「今投資判断で見ている主要セットが揃っているか」の受入ライン。
- **将来の自動化提案（P1-VER 内）**: 明示的な `ACCEPTANCE_IDS`（16銘柄）リストをコードに持ち、ヘルス/受入エンドポイントで「16/16」を機械的に返すようにする。これにより「16/16」が再現可能な指標になる。

---

## 優先度定義

| 優先度 | 範囲 |
| --- | --- |
| **P0** | **現在の本番障害・重大な誤表示のみ**。ベースライン（16/16・9/9・Deploy経路）を崩す事象。 |
| **P1** | 投資判断価値の直接向上、または信頼の土台（バージョン/README 整合）。 |
| **P2** | P1 の調査前提・設計案・堅牢性・運用。 |
| **P3** | 拡張・QoL。 |

---

## P0 — 現在の本産障害・重大誤表示（厳格）

### P0 該当なし（2026-09-06 時点）
- 本番はベースラインを満たす（curl で FX/暗号/金属とも値取得確認）。
- 過去に観測された「FX/暗号＝未取得」表示は、本番再現が確認されない（現在は正常）ため**解消済み事象**として P2-VER に記録し、P0 から除外。

> 再発時（本番で FX/暗号/金属のいずれかが未取得・誤表示となった場合）は即座に P0 として起票。

---

## P1 — 投資判断価値の直接向上・信頼の土台

### P1-VER バージョン番号と README・現行 Cloudflare 構成の統一
- **状態**: Completed
- **実装日**: 2026-09-06
- **変更**:
  - `package.json` / `package-lock.json` を `4.0.0` に統一
  - `README.md` / `README.ja.md` を現行 Cloudflare Workers + Static Assets 構成へ更新
  - 旧 Node/Ubuntu/systemd 前提の本番記述を削除・ローカル参考として分離
- **確認結果**:
  - `npm test` 9/9 PASS
  - GitHub `main` push 成功
  - Cloudflare 自動 Deploy 確認済み
  - 本番 `/api/v1/dashboard` で `instruments: 43` を返却
- **備考**: `16/16` はアプリ内自動指標ではなくユーザー側受入確認セット。BACKLOG 定義のとおり維持。

### P1-CHG FX・暗号・金属の日次変動が常に「—」になる
- **状態**: Completed
- **実装日**: 2026-09-07
- **採用方針（承認済み）**:
  - **FX（A案・採用）**: Frankfurter ECB 現在値 vs `quote.asOf` より前の直近 ECB 営業日終値。`changeBasis=FRANKFURTER_ECB_PREV_BUSINESS_DAY`。表示「前営業日比」。
  - **暗号（B案・条件付き採用）**: Coinbase Spot 現在値 vs Yahoo Finance 直前確定 UTC 日終値（cross-provider）。`changeBasis=COINBASE_SPOT_VS_YAHOO_PREV_UTC_DAY`。表示「前UTC日比」。内部 metadata で `priceSource=COINBASE_PUBLIC_SPOT` / `basisSource=YAHOO_FINANCE_DAILY` を明示（COINGECKO_PUBLIC の内部互換IDを実態として表示しない）。
  - **金属（C案・今回実装せず）**: Metals.dev スポット vs Yahoo 先物を混ぜないため、日次変動は「—」維持。**別バックログ項目として残存**。
- **実装方式**: Backend A（dashboard から dailyBars を新呼び出し）は不採用。既存 `hydrateSparklines` が取得済みの `G.bars[id]` を利用する Frontend B を採用。P1-CHG のため `/dashboard` の外部 egress・初回応答時間は増やさず。
- **変更ファイル**: `public/js/adapters.js`（derivePreviousClose / changeProvenance 追加）、`public/js/widgets.js`（ラベル表示）、`public/js/dashboard.js`（詳細画面の provenance 注記）、`test/change-previous-close.mjs`（新規テスト）。
- **確認結果**: `npm test` 17/17 PASS（既存 9 + 新規 8）。GitHub main push 済み。Cloudflare 自動 Deploy 確認済み。本番 `instrumentCount: 43`・`UNAVAILABLE: FTSE` 維持。
- **金属の別バックログ項目**: 「P1-CHG-METAL: 金属の日次変動表示（先物系列のみで閉じる別指標『先物前営業日比』として分離設計）」として新規起票を推奨。

### P1-YEN 円相場影響の可視化（設計案提示→実装）
- **状態**: Completed
- **実装日**: 2026-09-07
- **採用方針（承認済み）**:
  - **対象**: ACWI のみ（最小実装）。米国株19銘柄への展開は別ステップ。
  - **表示**: 詳細ドロワーに「円換算参考変動（ACWI ETF・JPY参考）」を追加。資産要因(USD) / 為替要因(JPY) / 円換算参考 の3項目。
  - **式**: `(1 + assetReturn) × (1 + fxReturn) − 1`。Alpaca IEX と ECB reference rate の基準時刻が異なるため「近似・参考」として明示。
  - **期間一致ゲート**: `asset current date == USDJPY current date` **AND** `asset previousClose date == USDJPY previous basis date` の両方一致時のみ表示。一方でも不一致ならセクション非表示。
  - **provenance**: `assetSource` / `assetCurrentAsOf` / `assetPreviousCloseAsOf` / `fxSource` / `fxCurrentAsOf` / `fxPreviousCloseAsOf` / `formula` / `isReference` を保持。
  - **誤認防止**: 「オルカン投資信託の基準価額ではありません」「Alpaca IEX と ECB reference rate の基準時刻が異なるため参考値」を UI に明記。
- **previousCloseAsOf**: `server/providers/alpaca.mjs` で Alpaca snapshot の既存 `prevDailyBar.t` を `previousCloseAsOf` として保持（新規APIアクセスなし）。
- **basis 一元管理**: P1-CHG の `derivePreviousClose` を `derivePreviousBasis(item) → {close, day}` にリファクタ。変動率計算と P1-YEN 期間判定が同一 basis を参照（FX/暗号の既存動作は維持）。
- **変更ファイル**: `server/providers/alpaca.mjs`（previousCloseAsOf）、`public/js/adapters.js`（derivePreviousBasis / yenExposure）、`public/js/dashboard.js`（詳細画面セクション）、`test/yen-exposure.mjs`（新規）。
- **確認結果**: `npm test` 27/27 PASS（既存 17 + P1-CHG 8 + P1-YEN 10）。GitHub main push 済み。Cloudflare 自動 Deploy 確認済み。本番 ACWI に `previousCloseAsOf` 反映済み、期間一致時に円換算参考表示。
- **将来拡張**: 米国株19銘柄への展開、指数（要取得復旧）、EUR/GBP/HKD 経由の欧州・英国・香港・豪州市場の円影響。
- **見積**: S–M（設計承認含む）

### P1-FTSE FTSE 100 のカバー（調査→実装候補）
- **証拠**: `instruments.mjs` に `FTSE` 登録あり、`eodhd.mjs` の `INDEX_SYMBOLS` に FTSE なし（EODHD INDX リストで解決せず意図的省略）。結果 `UNAVAILABLE/COVERAGE_PENDING` が永続。
- **調査（実装前に確認）**:
  1. Yahoo Finance `^FTSE` fallback の実用性（他指数は既に Yahoo fallback 利用済み）。
  2. **Cloudflare Workers からの取得可否**（CoinGecko が Workers egress を IP ブロックした前例あり。Yahoo chart は coingecko/metal で動いているため見込み大だが確認要）。
  3. 表示上の provenance 分類（EOD? close-only? バッジ表記）。
- **実装候補化**: 上記3点確認後、`INDEX_SYMBOLS` に FTSE を追加し Yahoo fallback を有効化。
- **見積**: S（調査含む）

---

## P2 — 調査前提・堅牢性・運用

### P2-VER FX/暗号未取得表示の過去事例（解消済み・監視継続）
- **背景**: 初期調査でユーザー提示 UI に「FX5件・暗号4件＝未取得」があったが、本番 curl では値を返していた（矛盾）。
- **結論**: 現在の本番は正常（16/16 満たす）とみなし P0 除外。原因は「デプロイ直後/コールドスタートのタイムアウト」「一時的上流障害のスナップショット」「初回ロード時プレースホルダー固着」のいずれかと推定。
- **対応**: 障害時のリトライ/タイムアウト表示を強化し、再発を検知しやすくする。再発時は P0 起票。

### P2-VER2 `scripts/verify-provider.mjs` が実態と乖離（死コード化）
- **証拠**: `market-service.mjs` は `COINGECKO_PUBLIC, FRANKFURTER_ECB, METALS_DEV_SPOT, EODHD_EOD`(+TwelveData fxOnly) を組むが、`verify-provider.mjs` は Alpaca/EODHD/Metals のみ。実態の網羅チェックになっていない。
- **提案**: 実際の `providers` 構成へ合わせて検証対象を拡張、または `market-service` から健全性スナップショットを出力する形に統合。
- **見積**: S

### P2-TD Twelve Data の役割が曖昧・実質未使用
- **証拠**: 無料プロファイルでは `TWELVE_DATA_API_KEY` 未設定 → FX は Frankfurter が担う。Twelve Data コードは保守されるが実運用で火が付かない。
- **提案**: 公式ドキュメントで「FX は ECB(Frankfurter) が正本、Twelve Data は別契約時のみ」を明記。設定検証で `twelvedata` 利用時の表示権利チェックを強化。
- **見積**: S

### P2-HOL 祝日・短縮取引が世界市場時計に未反映
- **証拠**: `widgets.js` の `MARKETS` は固定セッションのみ。パネル注記「祝日・短縮取引は未反映」と自己申告。
- **提案**: 軽量な祝日カレンダー（主要市場の固定リストか keyless API）を追加しセッション状態へ反映。
- **見積**: M

### P2-ASOF 詳細ドロワーの `asOf` が前営業日で「新しさ」が判別困難
- **証拠**: EOD 指標の `asOf` は前営業日。休場日に「古い？最新？」が直感できない。
- **提案**: 「基準 2026-09-04（前営業日）」の相対表記追加、またはバッジに「前営業日終値」と明記。
- **見積**: S

---

## P3 — 拡張・QoL

### P3-LAY レイアウトが localStorage のみ（複数端末で非共有）
- **提案**: エクスポート/インポート（JSON）を追加し設定を GitHub に保存可能に。
- **見積**: S

### P3-CACHE 取得系列の永続キャッシュ不在（Worker は in-memory のみ）
- **証拠**: `market-service.mjs` はインメモリ。コールドスタートで毎回プロバイダ呼び出し。Quota 圧迫と障害時の即時 STALE 化。
- **提案**: KV/D1 などの軽量キャッシュ導入は拡張課題。
- **見積**: M

---

## 推奨実装1件（最初に着手すべき項目）

### → **P1-VER: バージョン番号・README・現行 Cloudflare 構成の統一**

**理由（ユーザー指示に基づく）**
1. **自己改善ループの前提条件**: 今後 Hermes が GitHub `main` を正本として継続的に改善していくため、まず**リポジトリ内の説明と実態を一致させる**ことが最優先。説明が実態と乖離していると、後の自動改善・レビュー・バックログ管理が誤った前提で進む。
2. **具体的な乖離（調査済み）**:
   - `package.json` = `3.2.0` / UI（`index.html`・`dashboard.js` boot）= `v4.0.0` → **バージョン番号の不整合**。
   - `README.md`（英語）は旧 Node 構成のまま: `server/server.mjs` 参照、`node server/worker.mjs` 起動説明、`127.0.0.1:8787`、systemd 前提。→ 実態は Cloudflare Worker + Static Assets・GitHub 自動 Deploy。
   - `README.ja.md` は既に Cloudflare 構成へ書き直し済み（line 58 等）。**日英でドキュメント実態が不一致**。
3. **低リスク**: ドキュメントと定数の修正のみ。動作・16/16・9/9 ベースラインに影響なし。

**手順（承認後）**
1. 単一バージョンソースを決定（推奨: `package.json` を正本とし `3.2.0` を実態に合わせるか、あるいは `v4.0.0` 系へ引き上げるか要決定）。UI の `v4.0.0` 表記と合わせる。
2. `README.md`（英語）の Architecture / Running / Deployment を Cloudflare Worker + Static Assets 実態へ書き直し。Ubuntu/systemd/旧 Node サーバー前提の記述を削除。
3. `ACCEPTANCE_IDS`（16/16 受入セット）の管理方針を決定（後述「受入指標の管理」比較）。
4. `npm test` → main Push → Cloudflare 自動 Deploy → 本番で 16/16・9/9 維持を確認 → Completed 更新。

### 受入指標（16/16）の管理方針 — 比較（P1-VER 内の設計判断）
- **案A: 製品コードへ固定実装（ACCEPTANCE_IDS を instruments 等に定数として持つ）**
  - メリット: ヘルス/受入エンドポイントが機械的に「16/16」を返し、再現性が高い。
  - デメリット: ユーザーの「監視したい16銘柄」が変わるたびコード修正が必要。製品の関心事（データ来歴）と受入確認（運用）を混在させる。
- **案B: 受入テスト／検証用途として管理（test または別検証スクリプトで16銘柄リストを保持）**
  - メリット: 製品コードを汚さず、受入確認を検証レイヤーに分離。リスト変更はテスト/設定ファイルのみ。
  - デメリット: ランタイムのヘルスが「16/16」を自動返さない（手動/CI 確認になる）。
- **推奨: 案B（検証用途）を基本とし、必要なら案Aは別の `acceptance` モジュールとして製品ロジックと分離**。現時点では急がず、P1-VER で「16/16 はユーザー側受入セット（アプリ内自動指標ではない）」と BACKLOG に定義済み。実装時にどちらで固定するか決定。

> 2件目: **P1-CHG**（日次変動「—」）。実装前に上記「比較基準の設計要件（現在値 vs 直前の有効な確定終値・週末/休場/24h市場の扱い）」を承認すること。

---

## P1-CHG-METAL — 金属の日次変動表示（別バックログ項目・未着手）

- **状態**: Proposed
- **背景**: P1-CHG では金属を「—」維持とした（Metals.dev スポット vs Yahoo 先物を混ぜない方針）。
- **方針（案）**: スポット/先物を混ぜず、**先物系列のみで閉じる別指標「先物前営業日比」** として分離表示。比較は `bars`（Yahoo 先物 `GC=F` 等）内で完結させ、quote.price（スポット）は使わない。
- **表示**: 「先物前営業日比 +x.xx%」と明記し、スポット現在値とは別レイヤーにする。
- **provenance**: `priceSource=YAHOO_FINANCE_FUTURES` / `basisSource=YAHOO_FINANCE_FUTURES` / `changeBasis=YAHOO_FUTURES_PREV_BUSINESS_DAY`。
- **リスク**: 先物とスポットの乖離を「同一商品」と誤認させない注記が必須。
- **見積**: S
