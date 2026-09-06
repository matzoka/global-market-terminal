#!/usr/bin/env bash
set -euo pipefail
cd /home/vm/projects/gmt1-market-terminal
git add -A
git -c user.name="matzoka" -c user.email="matzoka@outlook.jp" commit -m "Use Coinbase public API for crypto (CoinGecko blocks Workers egress)

- Replace CoinGecko fetch with Coinbase keyless spot/candles API
- CoinGecko public API rejects Cloudflare Workers shared egress IPs; Coinbase works
- Keeps provider id COINGECKO_PUBLIC for instrument-definition compatibility
- FX (Frankfurter ECB) already verified on production" 2>&1 | tail -3
TOKEN="$(grep -E '^GITHUB_TOKEN=' ~/.hermes/.env | head -1 | cut -d= -f2-)"
echo "=== pushing main (triggers Cloudflare auto-deploy) ==="
git push "https://${TOKEN}@github.com/matzoka/global-market-terminal.git" main 2>&1 | tail -6
git remote set-url origin "https://github.com/matzoka/global-market-terminal.git"
echo "=== final remote ==="
git remote get-url origin
