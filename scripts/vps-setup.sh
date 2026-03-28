#!/bin/bash
set -e

echo "=============================="
echo "  Night Stars Bot - VPS Setup"
echo "=============================="
echo ""

read -p "Discord Token (Night Stars Bot): " -s NS_TOKEN && echo ""
read -p "Database URL (Neon PostgreSQL): " -s DB_URL && echo ""
read -p "Discord Token (Self Role Bot) [leave blank to skip]: " -s SR_TOKEN && echo ""
echo ""

echo "[1/5] Installing Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash - &>/dev/null
apt-get install -y nodejs &>/dev/null
echo "Done"

echo "[2/5] Installing pnpm and PM2..."
npm install -g pnpm pm2 &>/dev/null
echo "Done"

echo "[3/5] Cloning Night Stars Bot..."
git clone https://github.com/mouadalexo/NS_BOT_SYSTEM /root/NS_BOT_SYSTEM
cd /root/NS_BOT_SYSTEM
pnpm install
echo "Done"

if [ -n "$SR_TOKEN" ]; then
  echo "[3b] Cloning Self Role Bot..."
  git clone https://github.com/mouadalexo/Night-Stars-self-role-bot /root/self-role-bot
  cd /root/self-role-bot
  npm install
  echo "Done"
fi

echo "[4/5] Creating PM2 config..."

APPS="    {
      name: \"night-stars-bot\",
      script: \"pnpm\",
      args: \"--filter @workspace/discord-bot run start\",
      interpreter: \"none\",
      cwd: \"/root/NS_BOT_SYSTEM\",
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 50,
      watch: false,
      env: {
        NODE_ENV: \"production\",
        DATABASE_URL: \"$DB_URL\",
        DISCORD_TOKEN: \"$NS_TOKEN\"
      }
    }"

if [ -n "$SR_TOKEN" ]; then
  APPS="$APPS,
    {
      name: \"self-role-bot\",
      script: \"index.js\",
      cwd: \"/root/self-role-bot\",
      autorestart: true,
      restart_delay: 5000,
      watch: false,
      env: {
        NODE_ENV: \"production\",
        DISCORD_TOKEN: \"$SR_TOKEN\"
      }
    }"
fi

cat > /root/NS_BOT_SYSTEM/ecosystem.prod.config.cjs << PMEOF
module.exports = {
  apps: [
$APPS
  ]
};
PMEOF
echo "Done"

echo "[5/5] Starting bots with PM2..."
pm2 start /root/NS_BOT_SYSTEM/ecosystem.prod.config.cjs
pm2 save
pm2 startup systemd -u root --hp /root | tail -1 | bash
echo "Done"

echo ""
echo "=============================="
echo "  All bots are running"
echo "  pm2 list    - check status"
echo "  pm2 logs    - see logs"
echo "=============================="
