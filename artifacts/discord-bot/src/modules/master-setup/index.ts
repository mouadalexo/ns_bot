import { Client, Message } from "discord.js";
import { isMainGuild } from "../../utils/guildFilter.js";
import { sendMasterSetupPanel } from "../../panels/master.js";

const TRIGGER_RE = /^=setup\s*$/i;

export function registerMasterSetupModule(client: Client) {
  client.on("messageCreate", async (message: Message) => {
    try {
      if (message.author.bot || !message.guild) return;
      if (!isMainGuild(message.guild.id)) return;
      if (!TRIGGER_RE.test(message.content.trim())) return;
      await sendMasterSetupPanel(message);
    } catch (err) {
      console.error("[MasterSetup] messageCreate error:", err);
    }
  });
}
