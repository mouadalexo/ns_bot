const fs = require("fs");
const path = require("path");

function loadDotEnv() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2];
    const dq = v.startsWith('"') && v.endsWith('"');
    const sq = v.startsWith("'") && v.endsWith("'");
    if (dq || sq) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}
loadDotEnv();

module.exports = {
  apps: [{
    name: "night-stars-bot",
    script: "pnpm",
    args: "--filter @workspace/discord-bot run start",
    interpreter: "none",
    cwd: "/home/ubuntu/NS_BOT_SYSTEM",
    instances: 1,
    exec_mode: "fork",
    autorestart: true,
    restart_delay: 5000,
    max_restarts: 50,
    watch: false,
    env: {
      NODE_ENV: "production",
      DATABASE_URL: process.env.DATABASE_URL,
      DISCORD_TOKEN: process.env.DISCORD_TOKEN,
    },
  }],
};
