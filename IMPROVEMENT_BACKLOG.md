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

## 正常ベースライン（固定・2026-09-07 確定）

以下は現在の「正常」の定義。これらが満たされている間は P0 障害とみなさない。

| 項目 | 基準 |
| --- | --- |
| 全登録銘柄 | **43 銘柄**（内部指標・`server/instruments.mjs`） |
| 自動テスト | `npm test` **53/53** 通過 |
| GitHub main | ローカルと `origin/main` が一致（正本は `main`） |
| 本番経路 | GitHub `main` → Cloudflare Builds → Workers（`https://global-market-terminal.matzoka.workers.dev/`） |
| 旧環境 | Ubuntu 旧本番・Tailscale `:8443` 経路は**完全撤去済み** |
| UNAVAILABLE | **SX5E のみ**（EuroStoxx 50・別バックログ P2-INDEX-SX5E で調査中）。それ以外の42銘柄はいずれかの provider から値を取得 |

現在の quote 状態（43銘柄）:

| 状態 | 銘柄 | 計 |
| --- | --- | --- |
| PARTIAL_REALTIME (ALPACA_IEX) | ACWI + 米国株19銘柄 | 20 |
| EOD (FRANKFURTER_ECB) | FX5 | 5 |
| DELAYED (COINGECKO_PUBLIC / METALS_DEV_SPOT) | 暗号4 + 金属スポット4 | 8 |
| UNVERIFIED (YAHOO_FINANCE_FTSE / YAHOO_FINANCE_INDEX) | FTSE + Yahoo index 8銘柄 | 9 |
| UNAVAILABLE (EODHD_EOD) | SX5E | 1 |

主要 provider 構成:

- 米国ETF・米国株: `ALPACA_IEX`
- FX: `FRANKFURTER_ECB`
- 暗号 quote: `COINGECKO_PUBLIC`（実態の spot source については既存 provenance 説明を維持）
- 金属 spot: `METALS_DEV_SPOT`
- FTSE: `YAHOO_FINANCE_FTSE`
- 8指数: `YAHOO_FINANCE_INDEX`（SPX=`^GSPC`、NDX=`^NDX`、DJI=`^DJI`、DAX=`^GDAXI`、N225=`^N225`、HSI=`^HSI`、ASX=`^AXJO`、SSE=`000001.SS`）
- 金属 bars: `YAHOO_FINANCE_METAL_FUTURES`（XAU=`GC=F`、XAG=`SI=F`、XPT=`PL=F`、XPD=`PA=F`）
- SX5E: `EODHD_EOD`（現在 UNAVAILABLE）

---

## 指標の定義（重要）

### 「43 銘柄」＝ 全登録銘柄数（内部指標）
- `server/instruments.mjs` に登録された全インストルメント。`npm test` も `instruments.length === 43` を検証。
- FTSE を含む。FTSE は `YAHOO_FINANCE_FTSE` でカバー済み（UNVERIFIED）。現在 UNAVAILABLE なのは SX5E（EuroStoxx 50）のみ、別バックログ P2-INDEX-SX5E で調査中。

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
| **P0** | **現在の本番障害・重大な誤表示のみ**。ベースライン（43銘柄・53/53・Deploy経路）を崩す事象。 |
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
- **金属の実装**: 「P1-CHG-METAL」として実装完了（スポット vs 先物を混ぜず、先物系列のみの別指標「先物前取引日比」を詳細画面に分離表示）。

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

### P1-FTSE FTSE 100 のカバー（調査→実装完了）
- **状態**: Completed
- **実装日**: 2026-09-07
- **採用方針（承認済み）**:
  - **対象**: FTSE 100 指数そのもののみ。ETF・先物への置換は禁止（provenance ガードで強制）。
  - **専用 provider**: `server/providers/yahoo-ftse.mjs`（`YAHOO_FINANCE_FTSE`）を新規作成。`market-service.mjs` に**常時登録**（EODHD_API_TOKEN の有無に非依存）。
  - **拒否理由（eodhd内fallback不採用）**: `market-service.mjs` は最終的に `quote.provider` を `provider.id` で上書きするため、EODHD内部でYahooを使うと provenance が `EODHD_EOD` になってしまう。Yahoo `^FTSE` は keyless なので token 依存にすべきではない。
  - **instrumentType 検証**: `meta.instrumentType === 'INDEX'` を必ず確認。非INDEXなら例外で reject（ETF/先物誤混入防止）。
  - **asOf**: `meta.regularMarketTime`（Unix秒）を使用。**latest daily bar の日付は代用しない**。
  - **status**: Yahoo metadata で遅延確認可能 → `DELAYED`、不可 → `UNVERIFIED`（EOD固定はしない）。
  - **deliveryLabel**: `YAHOO FINANCE — FTSE 100 INDEX`
  - **previousClose**: `regularMarketPrice` の quote日より前で直近に確定した daily bar close。`当日未確定barは previousClose にしない`。`previousCloseAsOf` も保持。
  - **daily bars**: 同一 Yahoo `^FTSE` chart 系列を使用。FTSE bars 初回取得時に外部リクエスト1件追加（既存15分キャッシュ対象）。「egress 0」とは扱わない。
  - **障害分離**: Yahoo FTSE 取得失敗時は FTSE のみ `STALE`/`UNAVAILABLE`。他指数(EODHD)へ影響なし。
- **変更ファイル**: `server/providers/yahoo-ftse.mjs`（新規）、`server/market-service.mjs`（常時登録 + bars deliveryLabel マッピング追加）、`test/yahoo-ftse.test.mjs`（新規）。
- **テスト**: `YAHOO_FINANCE_FTSE supports FTSE only`（他指数 false）、`^FTSE` 利用、`instrumentType INDEX` 検証、`regularMarketPrice` 正常、`asOf` が `regularMarketTime` 由来、`previousClose` が直前確定日足、`previousCloseAsOf` 正常、当日未確定barをpreviousCloseにしない、Yahoo障害時FTSEのみ失敗、他指数routing回帰なし、provenance `YAHOO_FINANCE_FTSE`、FTSE bars 取得可能。
- **確認結果**: `npm test` 36/36 PASS（既存27 + P1-FTSE 9）。GitHub main push 済み（`4421002`）。Cloudflare 自動 Deploy 確認済み。本番 `/api/v1/dashboard`: `instrumentCount 43`、`FTSE` が `UNAVAILABLE` から `UNVERIFIED` に変化、`provider=YAHOO_FINANCE_FTSE`、`price=10831.09`、`asOf=2026-09-04T15:35:30Z`、`prevClose=10831.5`、`prevCloseAsOf=2026-09-03`、`deliveryLabel=YAHOO FINANCE — FTSE 100 INDEX`。FTSE 詳細 bars 正常（7本、同一 Yahoo 系列）。既存42銘柄に回帰なし。
- **見積**: S（調査含む）

---

### P2-INDEX 9指数 quote の UNAVAILABLE 解消（調査→Phase A 実装完了）

- **状態**: Phase A Completed（SX5E は別バックログ P2-INDEX-SX5E として残留）
- **調査結果（原因）**: 9指数は全て `reason=provider_request_failed`。EODHD `.INDX` エンドポイントは基本プランに含まれず追加有料アドオン（Indices Historical Constituents: $29.99/mo）が必要。認証なし/demo は `Unauthenticated`/`Forbidden`。したがって「EODHD にシンボルが存在しない」のではなく、**リクエスト失敗（認証/plan制約）** が真因。
- **Phase A 採用方針（承認済み）**:
  - 新規 `server/providers/yahoo-index.mjs`（`YAHOO_FINANCE_INDEX`）を作成。P1-FTSE と同じ設計原則（instrumentType INDEX ガード、regularMarketTime を asOf、status=DELAYED/UNVERIFIED、deliveryLabel `YAHOO FINANCE — INDEX REFERENCE`）。
  - 8指数を Yahoo 指数そのものから取得: SPX=`^GSPC`、NDX=`^NDX`、DJI=`^DJI`、DAX=`^GDAXI`、N225=`^N225`、HSI=`^HSI`、ASX=`^AXJO`、SSE=`000001.SS`（**`^SSE` は使用禁止**、誤値110.33が返るため）。
  - **provider ownership 重複回避**: EODHD_EOD の `INDEX_SYMBOLS` から8指数を削除し `YAHOO_FINANCE_INDEX` を唯一の quote/bars owner に。EODHD は SX5E のみ保持（Yahoo で EuroStoxx50 指数を安全に取得できる symbol なしのため）。
  - bars も `YAHOO_FINANCE_INDEX` が担当、`providerSymbol` = 実際の Yahoo symbol。EODHD の Yahoo fallback を削除（provenance 誤認防止）。
- **変更ファイル**: `server/providers/yahoo-index.mjs`（新規）、`server/providers/eodhd.mjs`（INDEX_SYMBOLS を SX5E のみに削減 + fallback 削除）、`server/market-service.mjs`（常時登録 + bars deliveryLabel 追加）、`test/yahoo-index.test.mjs`（新規）、`test/market-service.test.mjs` / `test/provider_bars.mjs` / `test/yahoo-ftse.test.mjs`（既存テスト修正）。
- **テスト**: 8指数→正しい Yahoo symbol・instrumentType INDEX 検証・非INDEX reject・asOf=regularMarketTime・previousClose=直前確定bar・providerSymbol 正常・YAHOO_FINANCE_INDEX が8指数の quote/bars owner・EODHD が8指数を ownership しない・SX5E は変更されない・FTSE/金属 bars は別 provider 維持・既存 FX/crypto/equity 回帰なし。
- **確認結果**: `npm test` 53/53 PASS（既存45 + P2-INDEX 8）。GitHub main push 済み（`f745bbb`）。Cloudflare 自動 Deploy 確認済み。本番: 8指数すべて `UNAVAILABLE` から `UNVERIFIED` に変化、`provider=YAHOO_FINANCE_INDEX`、`providerSymbol` 正常（SSE=`000001.SS`）。`instrumentCount 43`、SX5E のみ `UNAVAILABLE`（EODHD_EOD）として既知の未取得で残存。既存銘柄に回帰なし。
- **見積**: M（調査+設計+実装）

#### P2-INDEX-SX5E — EuroStoxx 50 (SX5E) のカバー（別バックログ・未着手）

- **状態**: Proposed
- **背景**: Phase A で SPX/NDX/DJI/DAX/N225/HSI/ASX/SSE は Yahoo 指数でカバー完了。SX5E（EuroStoxx 50）のみ Yahoo で指数そのものを安全に取得できる symbol を確認できず（^SX5E / STOXX50E.F / SX5E.F いずれも取得不可、^STOXX50 は MUTUALFUND）残留。
- **方針（案）**: ETF / mutual fund / futures への置換は禁止（provenance 犠牲にして 43/43 を目指さない）。以下を調査:
  - Stooq（`^stoxx50` 等 keyless）
  - その他 keyless index source
  - EODHD 有料 INDX アドオン購入
  - 公式/準公式ソース
- **見積**: S–M（調査含む）

---

## P2 — 調査前提・堅牢性・運用

### P2-VER FX/暗号未取得表示の過去事例（解消済み・監視継続）
- **背景**: 初期調査でユーザー提示 UI に「FX5件・暗号4件＝未取得」があったが、本番 curl では値を返していた（矛盾）。
- **結論**: 現在の本番は正常（43銘柄・53/53 満たす）とみなし P0 除外。原因は「デプロイ直後/コールドスタートのタイムアウト」「一時的上流障害のスナップショット」「初回ロード時プレースホルダー固着」のいずれかと推定。
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

### P2 残タスク整理（Proposed / Pending 一覧・2026-09-07 時点）

以下は P2 フェーズとして未着手・提案段階のもの。明示的な承認後に着手。

1. **P2-INDEX-SX5E** — EuroStoxx 50 (SX5E) の正しい index source 調査（Stooq / keyless / EODHD 有料 INDX / 公式ソース）。現在唯一の `UNAVAILABLE` 銘柄。`^SX5E`/`STOXX50E.F`/`SX5E.F` は取得不可、`^STOXX50` は MUTUALFUND のため指数置換不可。ETF/先物への置換は禁止（provenance 犠牲にして 43/43 を目指さない）。
2. **P2-HOLIDAY** — 営業日・祝日判定精度向上。主要市場の軽量祝日カレンダー（固定リスト or keyless API）を `MARKETS` セッション状態へ反映。FX/暗号/先物の「前営業日」選択精度向上。
3. **P2-PROVENANCE-UI** — カード表面での出所・基準時刻の一覧性向上。現在は詳細ドロワー内のみ provenance を表示。一覧・カードでも軽量に表示。
4. **P2-ALERT** — STALE / UNAVAILABLE 発生時の Discord アラート。P2-VER2 で `verify-provider.mjs` の死コード化を指摘済み。健全性スナップショット出力と組み合わせて通知。
5. **P2-YEN-EXPAND** — ACWI 円換算参考（P1-YEN）の米国株19銘柄への展開。P1-YEN で温存した拡張案。期間一致ゲート・provenance 設計を流用。
6. **P2-ACCEPTANCE** — 「16/16 受入セット」の機械判定化。`ACCEPTANCE_IDS`（16銘柄）をコード化し、ヘルス/受入エンドポイントで受入ラインを機械的に返す。16/16 は引き続きユーザー側受入確認セット（アプリ内定数なし）の定義を維持。実装は行わず、将来の自動化案として保持。

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

## P1-CHG-METAL — 金属の日次変動表示（先物系列のみ・別指標として実装完了）

- **状態**: Completed
- **実装日**: 2026-09-07
- **採用方針（承認済み）**:
  - **スポット vs 先物の絶対分離**: Metals.dev スポット現在値と Yahoo Finance 先物系列を一つの変化率に混ぜない。スポット価格横の日次変動「—」は維持。
  - **専用 provider 分離**: `server/providers/yahoo-metal-futures.mjs`（`YAHOO_FINANCE_METAL_FUTURES`）を新規作成。`metals-dev.mjs` は `supportsDailyBars` を `false` にし、Yahoo 先物呼び出しを削除（bars provenance が `METALS_DEV_SPOT` と誤認されるのを防止）。
  - **routing**: quote routing は引き続き `METALS_DEV_SPOT`、bars routing のみ `YAHOO_FINANCE_METAL_FUTURES` が担当。`market-service.mjs` に常時登録。
  - **シンボル**: XAU→`GC=F`、XAG→`SI=F`、XPT→`PL=F`、XPD→`PA=F`。いずれも `instrumentType === 'FUTURE'` を検証、非FUTUREは reject。
  - **算出（Frontend B）**: 既存 Yahoo 先物日足系列のみ使用。`current = 最新bar.close`（当日未確定barでも可）、`previous = その直前bar.close`（未確定barは previous にしない）、`change = (current/previous - 1)*100`。`/bars` API 契約の変更なし（regularMarketPrice 等の追加なし）。
  - **表示**: 詳細画面のみ「先物前取引日比（別系列・参考）」を別セクション表示。スポットメイン表示は変更なし。
  - **限月ロール**: 日付間隔からの自動判定・自動「—」化は行わない。常に「限月切替により不連続になる可能性があります」注意書きを表示。
  - **egress**: 追加 egress 0（既存 Yahoo 先物 bars キャッシュを流用、新規 quote リクエストなし、15分キャッシュ維持）。
  - **provenance**: `provider=YAHOO_FINANCE_METAL_FUTURES`、`deliveryLabel=YAHOO FINANCE — METAL FUTURES REFERENCE`。exchange名（COMEX/NYMEX等）は Yahoo metadata で実際に確認できる場合のみ表示（推測表現不使用）。
- **変更ファイル**: `server/providers/yahoo-metal-futures.mjs`（新規）、`server/providers/metals-dev.mjs`（`supportsDailyBars=false` + Yahoo 先物削除）、`server/market-service.mjs`（常時登録 + bars deliveryLabel 追加）、`public/js/adapters.js`（`metalFuturesChange` 追加）、`public/js/dashboard.js`（詳細セクション追加）、`test/yahoo-metal-futures.test.mjs`（新規）、`test/provider_bars.mjs`（修正）。
- **テスト**: 4銘柄→`GC=F`/`SI=F`/`PL=F`/`PA=F`、`instrumentType FUTURE` 検証、非FUTURE reject、`YAHOO_FINANCE_METAL_FUTURES` が bars provider、`METALS_DEV_SPOT` は quote provider のまま、最新barをcurrent・直前barをprevious、先物変動率算出、bars不足時非表示、スポット日次変動「—」維持、金属以外に先物セクション非表示、P1-CHG/YEN/FTSE 回帰なし。
- **確認結果**: `npm test` 44/44 PASS（既存36 + P1-CHG-METAL 8）。GitHub main push 済み（`ab4d6c5`）。Cloudflare 自動 Deploy 確認済み。本番: 金属4銘柄スポット `METALS_DEV_SPOT` 維持・`prevClose=null`（「—」）、`/bars` provider 全4銘柄 `YAHOO_FINANCE_METAL_FUTURES`、`deliveryLabel=YAHOO FINANCE — METAL FUTURES REFERENCE`、詳細チャート正常（XAU 最新4476.6/前4429.8 等）、既存43銘柄に回帰なし。
- **見積**: S
