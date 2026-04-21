import {
  Client,
  EmbedBuilder,
  Message,
  PermissionsBitField,
  ChannelType,
} from "discord.js";
import type { GuildMember, VoiceBasedChannel } from "discord.js";
import { db, botConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { isMainGuild } from "../../utils/guildFilter.js";

const PREFIX = "=";
const BRAND = 0x5000ff;

function reply(message: Message, color: number, title: string, description: string) {
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: "Night Stars • Stage Lock" })
    .setTimestamp();
  return message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } }).catch(() => {});
}

async function isAuthorized(member: GuildMember): Promise<boolean> {
  if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;
  if (member.guild.ownerId === member.id) return true;
  const cfg = await db
    .select({ eventHosterRoleId: botConfigTable.eventHosterRoleId })
    .from(botConfigTable)
    .where(eq(botConfigTable.guildId, member.guild.id))
    .limit(1);
  const hosterId = cfg[0]?.eventHosterRoleId;
  if (hosterId && member.roles.cache.has(hosterId)) return true;
  return false;
}

async function getMemberRoleId(guildId: string): Promise<string | null> {
  const cfg = await db
    .select({ memberRoleId: botConfigTable.memberRoleId })
    .from(botConfigTable)
    .where(eq(botConfigTable.guildId, guildId))
    .limit(1);
  return cfg[0]?.memberRoleId ?? null;
}

function getTargetChannel(member: GuildMember): VoiceBasedChannel | null {
  const ch = member.voice.channel;
  if (!ch) return null;
  if (ch.type !== ChannelType.GuildVoice && ch.type !== ChannelType.GuildStageVoice) return null;
  return ch;
}

async function applyLock(message: Message, lock: boolean) {
  if (!message.guild || !message.member) return;
  if (!(await isAuthorized(message.member))) {
    await reply(message, 0xff5555, "❌ Not Authorized", "You need Administrator or the Event Hoster role to use this.");
    return;
  }

  const channel = getTargetChannel(message.member);
  if (!channel) {
    await reply(message, 0xff5555, "❌ No Voice Channel", "Join a voice or stage channel first, then run this command there.");
    return;
  }

  const memberRoleId = await getMemberRoleId(message.guild.id);
  if (!memberRoleId) {
    await reply(
      message,
      0xff5555,
      "❌ Member Role Not Configured",
      "Set the Member Role first via `/setup-jail` (member role field).",
    );
    return;
  }

  const memberRole = message.guild.roles.cache.get(memberRoleId)
    ?? (await message.guild.roles.fetch(memberRoleId).catch(() => null));
  if (!memberRole) {
    await reply(message, 0xff5555, "❌ Member Role Missing", "The configured member role no longer exists.");
    return;
  }

  const me = message.guild.members.me;
  if (!me?.permissionsIn(channel).has(PermissionsBitField.Flags.ManageChannels)) {
    await reply(
      message,
      0xff5555,
      "❌ Missing Permissions",
      "I need **Manage Channels** permission on this channel to update overrides.",
    );
    return;
  }

  try {
    if (lock) {
      // Lock: deny CONNECT for member role
      await channel.permissionOverwrites.edit(
        memberRole.id,
        { Connect: false },
        { reason: `Stage locked by ${message.author.tag}` },
      );
      await reply(
        message,
        BRAND,
        "🔒 Stage Locked",
        `Members with <@&${memberRole.id}> can no longer **connect** to **${channel.name}**.`,
      );
    } else {
      // Unlock: allow CONNECT for member role
      await channel.permissionOverwrites.edit(
        memberRole.id,
        { Connect: true },
        { reason: `Stage unlocked by ${message.author.tag}` },
      );
      await reply(
        message,
        BRAND,
        "🔓 Stage Unlocked",
        `Members with <@&${memberRole.id}> can now **connect** to **${channel.name}**.`,
      );
    }
  } catch (err) {
    console.error("[StageLock] Failed to update permissions:", err);
    await reply(message, 0xff5555, "❌ Failed", "Could not update channel permissions. Check role hierarchy.");
  }
}

export function registerStageLockModule(client: Client) {
  client.on("messageCreate", async (message: Message) => {
    try {
      if (!message.guild || message.author.bot) return;
      if (!isMainGuild(message.guild.id)) return;
      if (!message.content.startsWith(PREFIX)) return;

      const cmd = message.content.slice(PREFIX.length).trim().split(/\s+/)[0]?.toLowerCase();
      if (cmd === "stagelock") {
        await applyLock(message, true);
      } else if (cmd === "stageunlock") {
        await applyLock(message, false);
      }
    } catch (err) {
      console.error("[StageLock] messageCreate error:", err);
    }
  });
}
