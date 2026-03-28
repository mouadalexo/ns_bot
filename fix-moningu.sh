#!/bin/bash
set -e

echo "Fixing Moningu bot..."

# Add start script to package.json
python3 -c "
import json
pkg = json.load(open('/root/moningu/artifacts/discord-bot/package.json'))
pkg['scripts']['start'] = 'node --loader tsx src/index.ts'
json.dump(pkg, open('/root/moningu/artifacts/discord-bot/package.json', 'w'), indent=2)
print('start script added')
"

# Read token and write ecosystem config
python3 -c "
import re
token = re.search(r'DISCORD_TOKEN=(.+)', open('/root/moningu/.env').read()).group(1).strip()
db = 'postgresql://neondb_owner:npg_zgAlO1dfU2Dy@ep-withered-resonance-alm3wmjl-pooler.c-3.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require'
cfg = \"module.exports={apps:[{name:'moningu',script:'pnpm',args:'--filter @workspace/discord-bot run start',interpreter:'none',cwd:'/root/moningu',autorestart:true,env:{NODE_ENV:'production',DISCORD_TOKEN:'\" + token + \"',DATABASE_URL:'\" + db + \"'}}]};\"
open('/root/moningu/ecosystem.config.cjs','w').write(cfg)
print('ecosystem config written')
"

# Restart PM2
pm2 delete moningu 2>/dev/null || true
pm2 start /root/moningu/ecosystem.config.cjs
pm2 save

echo "Done! Moningu should be online now."
