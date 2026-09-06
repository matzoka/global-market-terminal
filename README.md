# GMT-1 // Global Market Terminal

GMT-1 is a **self-hosted, read-only market-observation dashboard** for evaluating
what market data is actually useful before paying for it. It does not place
orders, create prices, scrape consumer-finance pages, or hide a source's
coverage limits. It runs locally (loopback) and renders a CRT-style trading
"radar": world indices, a sector heatmap, an AAPL daily chart, a metals panel,
and world-session clocks.

Every value shown is tagged with its **provenance** — the provider, the delivery
classification (`REALTIME` / `DELAYED` / `EOD` / `PARTIAL_REALTIME` /
`UNVERIFIED` / `STALE` / `UNAVAILABLE`), and the reference timestamp — so you
never mistake a single-exchange feed for a full market, or a reference price for
an execution price.

## Free evaluation configuration

The recommended free starting point is an **Alpaca Basic personal account**. Its
IEX feed provides U.S.-listed stock/ETF data, which powers the equity heatmap
and the AAPL daily chart. The heatmap tile area is the latest verified **IEX
daily dollar volume** (daily-bar close × IEX daily volume), never an invented
static layout or an implied market-cap value. IEX is a **single exchange**, not a
consolidated U.S. market feed: every affected item is labelled `IEX PARTIAL`,
and the header says `IEX DATA — PARTIAL MARKET`. It must never be read as a
full-market last price.

Two extra personal-use free sources extend this profile without pretending to be
an execution feed. EODHD supplies end-of-day reference data for nine of the ten
displayed underlying indices; each is cached for 24 hours. FTSE 100 remains
`UNAVAILABLE` because its free index list did not provide the underlying index,
and an ETF is not substituted. Metals.Dev supplies a single four-metal
USD/troy-ounce spot-reference batch; GMT-1 limits retrieval to three times per
day so its 100-request monthly free quota is not exhausted. Neither source is
used as a synthetic or relabelled-live substitute.

### Start it

1. Create a free personal Alpaca account yourself. In its **Paper Trading** home
   screen, use **API Keys → Generate New Keys** to obtain an API key ID and
   secret. Do not open a Live account, deposit funds, or upgrade a plan for
   GMT-1.
2. Create free personal accounts at EODHD and Metals.Dev, then obtain one API
   key from each dashboard. Do not enter payment information or select an
   upgrade.
3. Create `.env` by copying `.env.example`. On Windows PowerShell:

   ```powershell
   Copy-Item .env.example .env
   ```

   On macOS / Linux:

   ```sh
   cp .env.example .env
   ```

4. Open `.env` and replace the blank values with the three providers'
   credentials:

   ```ini
   MARKET_DATA_PROVIDER=alpaca
   ALPACA_API_KEY_ID=your_key_id
   ALPACA_API_SECRET_KEY=your_secret_key
   EODHD_API_TOKEN=your_eodhd_token
   METALS_DEV_API_KEY=your_metals_dev_key
   ```

5. Run `npm run verify:provider` once after adding or rotating a key. It makes
   read-only requests, checks each configured provider, and explicitly lists the
   dashboard instruments outside the configured coverage. Do not run it
   repeatedly: it consumes the free providers' quota.
6. Run `npm start`, then open `http://127.0.0.1:8787`. If that port is already
   in use, start with `PORT=8788 npm start` (PowerShell:
   `$env:PORT='8788'; npm start`) and open `http://127.0.0.1:8788` instead.

No API credential belongs in source code, browser storage, a chat, or a Git
commit. Keep `MARKET_DATA_PROVIDER=none` until the free account is ready; that
safe first run displays no prices rather than demo values.

> **Note on secrets.** `.env` is git-ignored and never committed. For a
> headless deployment (e.g. a systemd user service), the same variables can be
> injected from an out-of-tree environment file outside the repo, e.g.
> `EnvironmentFile=%h/.config/gmt1-market-terminal/runtime.env`. The application
> only ever reads values from the process environment.

## Data states

| State | Meaning |
| --- | --- |
| `IEX PARTIAL` | Alpaca IEX data from one U.S. exchange. It is not the consolidated market. |
| `REALTIME` | Explicitly approved exchange entitlement for this instrument. |
| `DELAYED` | Verified provider quote with known delay. |
| `EOD` | EODHD end-of-day reference value, not an intraday quote or execution price. |
| `UNVERIFIED` | Provider response exists, but delivery rights/classification were not approved. |
| `STALE` | Last verified provider value; the current refresh failed. |
| `UNAVAILABLE` | No approved source is configured or available for this instrument. |

The application never creates a substitute price. AAPL's daily candles and the
index histories are provider-returned OHLCV data; they are never generated,
rebased, or simulated.

## What remains from the terminal

- CRT design, five widgets, drag-and-drop layout, and width controls.
- Browser-only layout persistence (`localStorage`).
- Global index coverage panel, sector heatmap, AAPL chart, metals panel, and
  world-session clocks.
- A tap/click detail drawer: verified quote, source, delivery classification,
  timestamps, tile-area basis, and only provider-returned price history. Close
  it with `CLOSE [ESC]` or Escape.

## Optional licensed data later

The server still contains a Twelve Data adapter for a formally licensed plan. Do
not set a symbol to `REALTIME` until the current plan, exchange entitlement, and
display permission have been checked. A cheap/free API tier is not automatically
licensed for a dashboard display.

Before any paid step, first use the free profile for a while and decide which
missing coverage is genuinely useful: consolidated U.S. data, a specific global
index region, or metals. Buy only the one that proves necessary.

## Security and operation

- Keys live only in the environment (`.env`, or an out-of-tree env file),
  excluded from version control.
- The server binds to `127.0.0.1` by default and sends a restrictive CSP.
- The browser calls only same-origin `/api/v1/*` routes.
- A short cache and persisted last-verified values support honest `STALE`
  handling during an upstream failure.
- This is not a trading system. Do not expose it as a public unauthenticated
  API.

For internet deployment, place it behind HTTPS and authenticated private access;
retain loopback binding for the application port and proxy only the
authenticated frontend.

## Fonts

The bundled `M PLUS 1 Code` font (`assets/fonts/MPLUS1Code.ttf`) is licensed
under the **SIL Open Font License, Version 1.1** (see `assets/fonts/OFL.txt`).
It is redistributable under the terms of that license; the OFL notice must
accompany the font.

## Validation

Run `npm test` for data-integrity checks, then `npm run verify:provider` after
adding a provider. The normal workflow is:

`dashboard load -> provider response -> source/status shown -> refresh -> stale or unavailable on failure`
