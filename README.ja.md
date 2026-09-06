# Global Market Terminal

[English](README.md) | 日本語

世界の株式・指数・為替・暗号資産・金銀プラチナパラジウムなどを、1画面で確認できる軽量な Web マーケットダッシュボードです。何よりも **データの来歴（プロバネンス）** を重視しており、表示される数値は「どこから来たか」「配信区分は何か」「基準時刻はいつか」が常に分かるようになっています。

> **旧称: GMT-1 Market Terminal**。コード内のコメントや設定に旧称がコードネームとして残る場合がありますが、公開プロジェクト名は **Global Market Terminal** です。

---

## 概要

Global Market Terminal は **閲覧専用の市場観察ダッシュボード** です。注文の発注、価格の生成、金融 consumer ページのスクレイピング、提供元のカバー範囲の偽装は一切行いません。ベンダー契約を申し込む前に、「どの市場データが本当に払う価値があるか」を評価するために作られています。

アプリはひとつの原則を中心に作られています。**部分的なフィードを全体市場と見間違えてはならない。また、参考値を約定可能な価格と見間違えてはならない。** すべての相場は、提供元・配信区分・基準時刻とともにタグ付けされており、一目で見分けられます。

主な設計方針:

- **来歴重視**: 各銘柄には `REALTIME` / `DELAYED` / `EOD` / `PARTIAL_REALTIME` / `UNVERIFIED` / `STALE` / `UNAVAILABLE` のいずれかのステータスと、提供元・基準時刻が付きます。
- **合成データなし**: 欠損や失敗は `STALE` または `UNAVAILABLE` として表示され、アプリが価格・レイアウト・時価総額をでっち上げることはありません。
- **ローカル優先**: 既定でループバックに束縛し、厳格な Content-Security-Policy を送信。ブラウザは同一オリジンの API ルートのみを呼び出します。

---

## スクリーンショット

![Global Market Terminal dashboard](docs/images/dashboard.png)

> 実際の稼働画面です。API キー・個人データ・内部 IP・プライベートホスト名は含まれない清潔な表示（提供元ステータスバッジ付き）を使用しています。

---

## 主な機能

現在のリリースで実装・提供されている機能:

- **世界の株式・指数** — 世界の指数（S&P 500、NASDAQ 100、日経 225、DAX、香港ハンセン、上海、ASX、EURO STOXX 50、無料ソースが解決しない FTSE 100 等は `UNAVAILABLE` と表示）に加え、米国株式ヒートマップ（NVIDIA、Microsoft、Apple、エネルギー、金融など）。
- **為替（FX）** — 主要通貨ペア（USD/JPY、EUR/USD、GBP/USD、AUD/USD、EUR/JPY）と ECB 日次リファレンス系列。
- **暗号資産** — BTC、ETH、SOL、XRP を JPY 建てで集計パブリックリファレンス経由で表示（取引所口座不要）。
- **金属** — 金・銀・プラチナ・パラジウムのスポットリファレンス（クォータキャッシュ）。
- **チャート** — 銘柄ごとの日足ローソク足 / 日次価格ライン。日足クローズのみの場合は正直に「close-only」とラベルします。
- **市場比較** — 選抜した銘柄を比較するストリップ。
- **市場タイミング** — 世界セッション時計（ニューヨーク、ロンドン、フランクフルト、香港、上海、東京、シドニー）の開場・閉場・昼休み状態。
- **ドラッグ＆ドロップ配置** — パネルの並べ替えとリサイズ。配置はブラウザの `localStorage` に保存。
- **詳細ドロワー** — 検証済み相場、提供元、配信区分、タイムスタンプ、タイル面積の根拠、提供元が返した価格履歴。
- **来歴バッジ** — 全銘柄に色分けされたステータスバッジ。

**実装されていない** 機能（存在すると思い込まないでください）: 注文入力、ポートフォリオ管理、アラート/通知、バックテスト、および設定した無料プロバイダーが返す範囲を超える有料データ集約。

---

## アーキテクチャ

```
Browser (HTML/CSS/JS)
        │  same-origin fetch, /api/v1/*
        ▼
Cloudflare Worker (server/worker.mjs) + Static Assets
        │  reads provider credentials from environment (Worker Secrets)
        ▼
Market data providers (pluggable adapters under server/providers/)
```

- ブラウザはベンダー API を直接呼ばず、プロバイダーの認証情報も保持しません。
- Worker はプロバイダーキーをプロセス環境（ローカル開発は `.env`、Cloudflare では Worker Secrets）から読み込み、全ベンダー通信をプロキシします。
- プロバイダー応答は短い TTL でメモリ内キャッシュに保持され、上流障害時は最後に取得成功した値を `STALE` として表示します（Cloudflare 版はディスクを使用しません）。

---

## 使用技術

- **Node.js** (>= 22、ネイティブ ES modules) — アプリケーションサーバーおよびプロバイダーアダプター。バックエンドフレームワークはなく、組み込みの `node:http` サーバーを使用。
- **HTML** — 単一の静的 `index.html`。
- **CSS** — 手書きの `css/terminal.css`（CRT 風ダークテーマ、フレームワーク・外部 CDN/フォントなし）。
- **JavaScript** — バニラブラウザ JS（`js/*.js`）、バンドラーなし、SPA フレームワークなし。

React/Vue/Svelte なし、ビルドステップなし、データベースなし。

---

## データプロバイダー

| Provider | Coverage | API key required? |
| --- | --- | --- |
| **Alpaca** (IEX feed) | 米国上場株式・ETF（単一取引所の IEX フィード） | **Yes**（無料 paper-trading キー） |
| **EODHD** | 原指数の日次終値リファレンス | **Yes**（無料ティア token） |
| **Metals.dev** | 金/銀/プラチナ/パラジウム スポットリファレンス | **Yes**（無料 API key） |
| **Twelve Data** | オプションのライセンス付き FX / 一般相場 | **Yes**（有料/ライセンスプラン） |
| **CoinGecko** (public) | 集計済み暗号資産リファレンス（BTC/ETH/SOL/XRP を JPY 建て） | **No**（パブリックエンドポイント） |
| **Frankfurter** (ECB) | ECB 日次 FX リファレンス系列 | **No**（パブリックエンドポイント） |

補足:

- 無料スタート構成は **Alpaca (IEX) + EODHD + Metals.dev + キー不要の 2 つのパブリックソース（CoinGecko、Frankfurter）**。Twelve Data は正式なライセンスプラン向けに残されており、既定ではオフ。
- Alpaca の IEX フィードは **米国の単一取引所** であり、統合市場フィードではありません。これを経由する銘柄は `IEX PARTIAL` とラベルされ、ヘッダーは `IEX DATA — PARTIAL MARKET` と表示されます。全体市場の最新価格として読んではいけません。
- Metals.dev の無料ティアはクォータ制限あり（月約 100 リクエスト）。Global Market Terminal は取得を 1 日 3 回までに制限します。
- プロバイダーキーをブラウザ側 JS に埋め込んではいけません。キーはサーバープロセス環境のみに存在します。

---

## インストール

前提: **Node.js >= 22**。

```sh
git clone https://github.com/<your-org>/global-market-terminal.git
cd global-market-terminal
npm install
cp .env.example .env
```

その後 `.env` を編集し、利用したいプロバイダーの認証情報を入力します（[設定](#設定) 参照）。`MARKET_DATA_PROVIDER=none` のままなら、デモ値ではなく何も価格を表示せずに安全に起動します。

> `npm install` は任意です。本プロジェクトは **ランタイム依存関係なし**（Node.js 組み込みのみ）のため、ローカル Node 実行なしでも Wrangler で動きます。Wrangler は devDependency として追加されています。

---

## 設定

`.env.example` を `.env` にコピーし、以下の変数を設定します。**`.env` をコミットしてはいけません。** 使わないプロバイダーは値を空のままにします。

| Variable | Required / Optional | Provider | Purpose |
| --- | --- | --- | --- |
| `HOST` | Optional | — | バインドアドレス（既定 `127.0.0.1`）。 |
| `PORT` | Optional | — | リスンport（既定 `8787`）。 |
| `MARKET_DATA_PROVIDER` | Required* | — | `none` \| `alpaca` \| `twelvedata`。キーを設定するまで `none` を使用。 |
| `ALPACA_API_KEY_ID` | Optional | Alpaca | Alpaca API key ID。 |
| `ALPACA_API_SECRET_KEY` | Optional | Alpaca | Alpaca API secret key。 |
| `TWELVE_DATA_API_KEY` | Optional | Twelve Data | API key（ライセンスプランのみ）。 |
| `EODHD_API_TOKEN` | Optional | EODHD | EOD 指数リファレンス用 token。 |
| `METALS_DEV_API_KEY` | Optional | Metals.dev | スポット金属用 API key。 |
| `MARKET_DATA_REALTIME_IDS` | Optional | — | リアルタイムと明示承認された銘柄 ID（カンマ区切り）。 |
| `MARKET_DATA_DELAYED_IDS` | Optional | — | 遅延と分類された銘柄 ID（カンマ区切り）。 |
| `MARKET_DATA_EOD_IDS` | Optional | — | 日次終値と分類された銘柄 ID（カンマ区切り）。 |
| `QUOTE_CACHE_SECONDS` | Optional | — | スナップショットキャッシュ TTL（既定 `60`）。 |

\* `MARKET_DATA_PROVIDER` は既知の値である必要があり、`none` は価格を表示しない安全な既定値です。

### ヘッドレス / デプロイ時のシークレット

アプリケーションは変数を **プロセス環境** からのみ読み込みます。ヘッドレスデプロイ（例: systemd user service）の場合、同じ変数を **リポジトリの外側** にある環境ファイルから注入します。例:

```
EnvironmentFile=%h/.config/global-market-terminal/runtime.env
```

**Cloudflare Workers** では、同じ変数名を **Worker Secrets** として設定します（`wrangler secret put <名前>` または Cloudflare ダッシュボード）。Secrets は実行時に自動的に `process.env` へ注入され、`.env` ファイルは読み込まれません。

`runtime.env` およびあらゆる `.env` はバージョン管理外に置かなければなりません。アプリはプロセス環境以外のシークレットをファイルシステムから読み取りません。

---

## セキュリティ

- **API キーをコミットしてはいけません。** プロバイダー認証情報は実行時に環境から読み込まれます。
- **`.env` は Git から除外** されています（`.gitignore` 参照）。
- **`runtime.env` その他の本番シークレットはリポジトリの外側に置く必要があります。**
- **シークレット API キーをブラウザ側 JavaScript に埋め込まないでください。** ブラウザは同一オリジンの `/api/v1/*` ルートのみを呼び出します。
- 認証情報には環境変数またはプラットフォームのシークレットストレージを使用してください。
- サーバーは既定で `127.0.0.1` に束縛し、厳格な CSP を送信します。
- これは **取引システムではありません。** 公開され認証なしの API として公開しないでください。
- インターネット公開する場合は HTTPS と認証付きプライベートアクセスの背後に置き、アプリケーションポートはループバック束縛を維持し、認証済みフロントエンドのみをプロキシしてください。

---

## ディレクトリ構成

```
.
├── public/                 # Cloudflare Static Assets で配信される静的資産
│   ├── index.html          # 静的ダッシュボードシェル
│   ├── css/
│   │   └── terminal.css    # CRT 風テーマ（フレームワーク/CDN なし）
│   ├── js/
│   │   ├── adapters.js     # ブラウザデータクライアント（同一オリジン API）
│   │   ├── widgets.js      # リサーチウィジェット（universe, chart, radar, compare, clocks）
│   │   └── dashboard.js    # 起動、配置永続化、データ状態
│   └── assets/
│       └── fonts/          # 同梱 M PLUS 1 Code（SIL OFL 1.1）
├── server/
│   ├── worker.mjs          # Cloudflare Worker エントリ（fetch handler + API ルート）
│   ├── config.mjs          # 環境駆動の設定
│   ├── market-service.mjs  # 相場/ローソク足オーケストレーション + メモリ内キャッシュ
│   ├── instruments.mjs     # 銘柄レジストリ
│   └── providers/          # プラガブルなプロバイダーアダプター
│       ├── alpaca.mjs
│       ├── eodhd.mjs
│       ├── metals-dev.mjs
│       ├── twelvedata.mjs
│       ├── coingecko.mjs
│       └── frankfurter.mjs
├── scripts/
│   └── verify-provider.mjs # 読み取り専用のプロバイダー事前確認
├── test/
│   └── market-service.test.mjs
├── wrangler.jsonc          # Cloudflare Workers 設定
├── .env.example            # テンプレート（シークレットなし）
├── .gitignore
└── README.md
```

補足:

- `data/` と `output/` は Cloudflare 版では使用しません（Worker はメモリ内キャッシュのみ）。ローカル Node 実行では作成される場合があり、Git から除外されます。
- `node_modules/` は実行時には不要（ランタイム依存ゼロ）ですが、念のため除外されています。`wrangler` はローカル開発/デプロイ用の devDependency として追加されています。

---

## 起動方法

Wrangler でのローカル開発（推奨）:

```sh
npm install          # wrangler をインストール（devDependency）
npm start            # wrangler dev — Worker + 静的資産をローカルで配信
```

その後 Wrangler が表示するローカル URL（既定 <http://127.0.0.1:8787>）を開きます。
ローカルのシークレットはプロジェクトルートの `.env`（Git 除外）から供給でき、Wrangler が `process.env` に注入します。

レガシーなローカル Node 実行（Wrangler なし、参考用）:

```sh
node server/worker.mjs   # Cloudflare では使用しません
```

ウォッチモード（変更で自動再起動）:

```sh
npm run dev
```

新しく追加したプロバイダーキーを繰り返しクォータを消費せずに確認:

```sh
npm run verify:provider
```

---

## テスト

プロジェクトはデータ整合性テストを同梱しています（Node.js 組み込みテストランナー、フレームワークなし）:

```sh
npm test
```

テストは銘柄レジストリ（合成価格なし）、プロバイダーアダプターの範囲（例: Alpaca は米国株式に限定）、EODHD/EOD マッピング、Metals.dev クォータ制限、およびブラウザコードにベンダーエンドポイントや乱数価格生成が含まれないことのアサーションをカバーします。

---

## デプロイ

Global Market Terminal は **Static Assets** 付きの単一 **Cloudflare Worker** として稼働します。ビルド工程・フレームワーク・データベースは不要です。

### 前提条件

- Cloudflare アカウント（Free プランで十分）。
- ローカルに `wrangler` をインストール（`npm install` で devDependency として追加）。
- Cloudflare 認証済み（`wrangler login` または `wrangler login --device`）。

### シークレットの設定

`.env.example` と同じ変数名を **Worker Secrets** として設定します。Secrets は実行時に `process.env` へ注入され、コミットしてはいけません。

```sh
wrangler secret put ALPACA_API_KEY_ID
wrangler secret put ALPACA_API_SECRET_KEY
wrangler secret put EODHD_API_TOKEN
wrangler secret put METALS_DEV_API_KEY
wrangler secret put MARKET_DATA_PROVIDER   # 例: "alpaca"
```

`TWELVE_DATA_API_KEY` は任意（ライセンスプランのみ）。

### 手動デプロイ

```sh
wrangler deploy
```

これにより `public/` が Static Assets として、`server/worker.mjs` が fetch handler としてアップロードされます。Worker は `https://<worker-name>.<subdomain>.workers.dev` で利用可能になります。

### GitHub からの自動デプロイ

GitHub リポジトリを Cloudflare Workers Builds に接続します:

1. Cloudflare Dashboard → **Workers & Pages** → 該当 Worker → **Settings** →
   **Builds**（または **Git integration**）。
2. GitHub App をインストールし、`matzoka/global-market-terminal` リポジトリを承認します。
3. 本番ブランチを **`main`** に設定します。
4. Build command: _（なし — ビルド工程不要）_; Deploy command: `wrangler deploy`。

接続後、 `main` への push ごとに Cloudflare が自動でビルド・デプロイします。GitHub Actions ワークフローは不要です — Cloudflare のネイティブな Git 連携が CI/CD を担います。

### 補足

- Worker は相場/ローソク足を **メモリ内キャッシュ** に保持します（TTL は `QUOTE_CACHE_SECONDS` で制御）。ディスク・KV・D1 は使用しません。
- アプリは厳格な CSP を送信し、Cloudflare 上では Worker の `fetch` handler のみに束縛されます。公開すべきループバック port はありません。
- 代わりに自前ホストの Node デプロイを行う場合は、上記のヘッドレスシークレットの注意を参照し、`node server/worker.mjs` を認証付きリバースプロキシ配下で起動してください。

---

## トラブルシューティング

- **価格が表示されない / `configuration_required`**
  `MARKET_DATA_PROVIDER` を設定済みプロバイダーにし、その認証情報を `.env` に入れます。`none` のままならダッシュボードは意図的に何も表示しません。

- **プロバイダーがデータを返さない / `quote_refresh_failed`**
  キーが正しく期限切れでないこと、無料プランが要求銘柄をカバーしていることを確認します。一部のプロバイダー（例: EODHD）は意図的に特定の指数を除外します。それらは設計上 `UNAVAILABLE` と表示されます。

- **Port が使用中**
  別プロセスが port を占有しています。Wrangler の場合は別 port を指定してください（`wrangler dev --port <other>`）。

- **プロバイダー側障害**
  該当銘柄は最後のキャッシュ値を `STALE` としてフォールバック、あるいは取得履歴がなければ `UNAVAILABLE` になります。残りのダッシュボードは動作し続けます。

- **ネットワーク障害**
  上記と同様: キャッシュ値が `STALE` として表示され、アプリが価格を合成することはありません。接続を復旧して更新してください。

---

## 免責事項

- **本プロジェクトは投資助言を提供しません。**
- 市場データは **遅延・不完全・不正確** である場合があります。
- **投資決定の責任は利用者自身にあります。**
- ここにあるものは約定可能な価格や注文ではありません。数値は行動する前に、ご自身の正規の提供元で必ず照合してください。

---

## Credits / Acknowledgements

- **市場データ**: [Alpaca](https://alpaca.markets)、
  [Twelve Data](https://twelvedata.com)、
  [EODHD](https://eodhd.com)、
  [Metals.dev](https://metals.dev)、
  [CoinGecko](https://www.coingecko.com)、
  [Frankfurter](https://frankfurter.dev)（ECB リファレンスレート）。
- **フォント**: [M PLUS 1 Code](https://github.com/coz-m/MPLUS_FONTS)（M+ FONTS Project Authors、SIL Open Font License 1.1 でライセンス、[`public/assets/fonts/OFL.txt`](public/assets/fonts/OFL.txt) 参照）。フォントは OFL の下で再配布され、アプリケーションコードは別ライセンスです（[LICENSE](LICENSE) 参照）。

---

## License

[LICENSE](LICENSE) を参照してください（MIT）。
