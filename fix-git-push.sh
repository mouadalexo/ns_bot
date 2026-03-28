#!/bin/bash
echo "Cleaning git history..."
git filter-branch --force --index-filter \
  'git rm --cached --ignore-unmatch \
    "attached_assets/Pasted--PM2-Spawning-PM2-daemon-with-pm2-home-root-pm2--177466_1774660348870.txt" \
    "attached_assets/Pasted-SyntaxError-Invalid-or-unexpected-token--1774660397478_1774660397479.txt"' \
  --prune-empty HEAD

echo ""
read -p "Paste your GitHub token then press Enter: " TOKEN
echo ""
echo "Pushing to GitHub..."
git push https://mouadalexo:$TOKEN@github.com/mouadalexo/NS_BOT_SYSTEM.git main --force
echo "Done"
