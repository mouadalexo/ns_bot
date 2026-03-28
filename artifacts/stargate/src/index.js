import dotenv from "dotenv";
dotenv.config({ path: "../../.env" });
import { Client, GatewayIntentBits, Partials, ActivityType, } from "discord.js";
import { createServer } from "http";
import { registerVerificationModule } from "./modules/verification/index.js";
import { registerAutoRoleModule } from "./modules/autorole/index.js";
import { registerPanelCommands } from "./panels/index.js";
process.on("unhandledRejection", (reason) => {
    console.error("[Stargate] Unhandled promise rejection:", reason);
});
process.on("uncaughtException", (err) => {
    console.error("[Stargate] Uncaught exception:", err);
});
const port = process.env.PORT ? parseInt(process.env.PORT) : 3001;
createServer((_, res) => {
    res.writeHead(200);
    res.end("OK");
}).listen(port, () => {
    console.log(`[Stargate] Health check listening on port ${port}`);
});
const token = process.env.STARGATE_TOKEN?.trim();
if (!token) {
    console.error("[Stargate] ERROR: STARGATE_TOKEN is not set. Bot cannot connect.");
    console.error("[Stargate] Waiting for token — add STARGATE_TOKEN to environment secrets.");
}
else {
    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMembers,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
            GatewayIntentBits.DirectMessages,
        ],
        partials: [
            Partials.Channel,
            Partials.Message,
            Partials.GuildMember,
        ],
    });
    client.once("clientReady", async () => {
        console.log(`[Stargate] Online as ${client.user?.tag}`);
        console.log(`[Stargate] Serving ${client.guilds.cache.size} guild(s)`);
        try {
            client.user?.setPresence({
                activities: [{ name: "Night Stars Verification", type: ActivityType.Watching }],
                status: "online",
            });
        }
        catch { }
        registerVerificationModule(client);
        registerAutoRoleModule(client);
        await registerPanelCommands(client);
        console.log("[Stargate] All systems ready.");
    });
    client.on("error", (err) => {
        console.error("[Stargate] Client error:", err);
    });
    client.login(token).catch((err) => {
        console.error("[Stargate] Login failed:", err.message);
    });
}
