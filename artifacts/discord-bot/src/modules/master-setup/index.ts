import { Client, Message, PermissionsBitField } from "discord.js";
import { db, botConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { isMainGuild } from "../../utils/guildFilter.js";
import { sendMasterSetupPanel } from "../../panels/master.js";

async function getSetupPrefix(guildId: string): Promise<string> {
  const rows = await db
    .select({ pvsPrefix: botConfigTable.pvsPrefix })
    .from(botConfigTable)
    .where(eq(botConfigTable.guildId, guildId))
    .limit(1);
  return rows[0]?.pvsPrefix ?? "=";
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function registerMasterSetupModule(client: Client) {
  client.on("messageCreate", async (message: Message) => {
    try {
      if (message.author.bot || !message.guild) return;
      if (!isMainGuild(message.guild.id)) return;
      const trimmed = message.content.trim();
      // Quick reject: must contain "setup" somewhere up front
      if (!/setup\b/i.test(trimmed)) return;
      const prefix = await getSetupPrefix(message.guild.id);
      const re = new RegExp("^" + escapeRegex(prefix) + "setup\\s*$", "i");
      if (!re.test(trimmed)) return;
      const isAdmin = message.member?.permissions.has(PermissionsBitField.Flags.Administrator);
      console.log(`[MasterSetup] matched. isAdmin=${isAdmin}`);
      await sendMasterSetupPanel(message);
    } catch (err) {
      console.error("[MasterSetup] messageCreate error:", err);
    }
  });
}
