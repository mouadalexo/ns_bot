import { Client, GuildMember } from "discord.js";
import { db } from "@workspace/db";
import { botConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { isMainGuild } from "../../utils/guildFilter.js";

export function registerAutoRoleModule(client: Client): void {
  client.on("guildMemberAdd", async (member: GuildMember) => {
    if (!isMainGuild(member.guild.id)) return;

    const [cfg] = await db
      .select({ autoMemberRoleId: botConfigTable.autoMemberRoleId, autoBotRoleId: botConfigTable.autoBotRoleId })
      .from(botConfigTable)
      .where(eq(botConfigTable.guildId, member.guild.id))
      .limit(1);

    if (!cfg) return;

    if (member.user.bot) {
      if (cfg.autoBotRoleId) {
        await member.roles.add(cfg.autoBotRoleId).catch((err) => {
          console.error(`[Stargate] Failed to assign bot role to ${member.user.tag}:`, err.message);
        });
      }
    } else {
      if (cfg.autoMemberRoleId) {
        await member.roles.add(cfg.autoMemberRoleId).catch((err) => {
          console.error(`[Stargate] Failed to assign member role to ${member.user.tag}:`, err.message);
        });
      }
    }
  });
}
