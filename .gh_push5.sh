#!/usr/bin/env bash
set -euo pipefail
cd /home/vm/projects/gmt1-market-terminal
git rm -q .gh_push4.sh
git add -A
git -c user.name="matzoka" -c user.email="matzoka@outlook.jp" commit -m "Remove stray .gh_push4.sh from tracking" 2>&1 | tail -2
TOKEN="$(grep -E '^GITHUB_TOKEN=' ~/.hermes/.env | head -1 | cut -d= -f2-)"
echo "=== pushing main ==="
git push "https://${TOKEN}@github.com/matzoka/global-market-terminal.git" main 2>&1 | tail -5
git remote set-url origin "https://github.com/matzoka/global-market-terminal.git"
echo "=== final remote ==="
git remote get-url origin
echo "=== verify no stray scripts tracked ==="
git ls-files | grep -E '\.gh_|\.sh$' || echo "clean: no stray .sh tracked"
