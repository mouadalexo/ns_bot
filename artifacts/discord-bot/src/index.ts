import {
  Client,
  GatewayIntentBits,
  Partials,
  ActivityType,
} from "discord.js";
import { createServer } from "http";
import { registerVerificationModule } from "./modules/verification/index.js";
import { registerPVSModule } from "./modules/pvs/index.js";
import { registerCTPModule } from "./modules/ctp/index.js";
import { registerSlashCommands } from "./commands.js";
import { registerPanelCommands } from "./panels/index.js";

const port = process.env.PORT ? parseInt(process.env.PORT) : 3000;
createServer((_, res) => {
  res.writeHead(200);
  res.end("OK");
}).listen(port, () => {
  console.log(`Health check server listening on port ${port}`);
});

const token = process.env.DISCORD_TOKEN?.trim();
if (!token) {
  console.error("DISCORD_TOKEN is not set — bot will not connect.");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [
    Partials.Channel,
    Partials.Message,
    Partials.GuildMember,
  ],
});

registerVerificationModule(client);
registerPVSModule(client);
registerCTPModule(client);

client.once("clientReady", async () => {
  console.log(`Night Stars Bot is online as ${client.user?.tag}`);
  console.log(`Serving ${client.guilds.cache.size} guild(s)`);

  client.user?.setPresence({
    activities: [{ name: "Night Stars", type: ActivityType.Watching }],
    status: "online",
  });

  await registerSlashCommands(client);
  await registerPanelCommands(client);
});

client.on("error", (err) => {
  console.error("Discord client error:", err);
});

async function connectWithRetry(retryDelay = 30000) {
  try {
    await client.login(token);
  } catch (err: any) {
    if (err?.code === "TokenInvalid") {
      console.error("Token is invalid — update DISCORD_TOKEN and redeploy.");
    } else {
      console.error("Login failed:", err?.message ?? err);
      console.log(`Retrying in ${retryDelay / 1000}s...`);
      setTimeout(() => connectWithRetry(retryDelay), retryDelay);
    }
  }
}

connectWithRetry();
