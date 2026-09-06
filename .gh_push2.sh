#!/usr/bin/env bash
set -euo pipefail
cd /home/vm/projects/gmt1-market-terminal
git add -A
git -c user.name="matzoka" -c user.email="matzoka@outlook.jp" commit -m "docs: note verified GitHub auto-deploy on push to main" 2>&1 | tail -3
TOKEN="$(grep -E '^GITHUB_TOKEN=' ~/.hermes/.env | head -1 | cut -d= -f2-)"
echo "=== pushing main via temporary token URL ==="
git push "https://${TOKEN}@github.com/matzoka/global-market-terminal.git" main 2>&1 | tail -6
git remote set-url origin "https://github.com/matzoka/global-market-terminal.git"
echo "=== final remote ==="
git remote get-url origin
