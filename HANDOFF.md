# Night Stars Discord Bot - Handoff Document

## Project Status
- **Night Stars Bot**: Running 24/7 on AWS EC2 VPS via PM2
- **Star Guide Bot (moningu)**: Active
- **GitHub**: Code synced and protected
- **Database**: Neon PostgreSQL (EU Central)

## VPS Server Details
- **Host**: 16.170.108.54
- **OS**: Ubuntu 22.04
- **Username**: ubuntu
- **Provider**: AWS EC2
- **Tools Installed**: Node.js 20, pnpm, PM2
- **SSH**: PEM key auth (Nightstarsvps_1776264757878.pem)

## GitHub Repositories
1. **Night Stars Bot**: https://github.com/mouadalexo/ns_bot
   - Monorepo with discord-bot in `artifacts/discord-bot/`
   - Startup: `pnpm --filter @workspace/discord-bot run start`
   - Database: Neon PostgreSQL

2. **Star Guide Bot**: https://github.com/mouadalexo/moningu
   - Similar monorepo structure
   - Startup: `pnpm --filter @workspace/discord-bot run start`
   - No database required

## Database
- **Provider**: Neon
- **Project**: ancient-paper-52174799
- **Region**: EU Central
- **Connection String**: `postgresql://neondb_owner:npg_zgAlO1dfU2Dy@ep-withered-resonance-alm3wmjl-pooler.c-3.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require`

## PM2 Configuration
Location: `/home/ubuntu/NS_BOT_SYSTEM/ecosystem.prod.config.cjs`
- Manages Night Stars Bot (PM2 name: ns-bot)
- Auto-restart enabled
- Startup on reboot configured

## Environment Variables (on VPS)
File: `/home/ubuntu/NS_BOT_SYSTEM/.env`
```
DATABASE_URL=postgresql://...
DISCORD_TOKEN=YOUR_TOKEN_HERE
```

File: `/home/ubuntu/moningu-real/artifacts/discord-bot/.env`
```
DISCORD_TOKEN=YOUR_SG_TOKEN_HERE
```

## Key Modifications Made
1. **dotenv support**: Added to both bots' index.ts to load .env files
2. **start script**: Added `"start"` script to package.json for PM2
3. **Self-ping**: Bot pings itself every 4 min to prevent inactivity timeout
4. **Reconnection logging**: Logs discord.js connection/resume events
5. **Git history cleaned**: Removed sensitive data from commits

## Common Commands on VPS
```
pm2 status              # Check bot status
pm2 logs ns-bot             # View Night Stars logs
pm2 logs moningu            # View Moningu logs
pm2 restart all         # Restart all bots
pm2 stop all            # Stop all bots
pm2 start ecosystem.prod.config.cjs  # Start all bots
```

## Update Workflow
1. Make code changes in Replit
2. Push to GitHub
3. On VPS: `cd /home/ubuntu/NS_BOT_SYSTEM && git pull && pm2 restart ns-bot`
4. For moningu: `cd /home/ubuntu/moningu-real && git pull && pm2 restart moningu`

## Important Notes
- Both bots use same pnpm workspace structure
- Both use `@workspace/discord-bot` naming
- Database only used by Night Stars Bot
- Discord tokens are secrets and stored in .env on VPS
- PM2 ecosystem config on VPS is NOT committed to git (contains secrets)
- GitHub push protection enabled to prevent accidental token commits
- Old VPS (93.189.95.218 / Clouding.io) is DECOMMISSIONED — do not use
