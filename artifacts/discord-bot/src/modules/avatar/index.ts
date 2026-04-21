import { Client, EmbedBuilder, Message } from "discord.js";
import { isMainGuild } from "../../utils/guildFilter.js";

const TRIGGER_RE = /^a\s+(.+)$/i;

function extractUserId(arg: string): string | null {
  const mention = arg.match(/^<@!?(\d{15,25})>$/);
  if (mention) return mention[1];
  if (/^\d{15,25}$/.test(arg)) return arg;
  return null;
}

export function registerAvatarModule(client: Client) {
  client.on("messageCreate", async (message: Message) => {
    try {
      if (!message.guild || message.author.bot) return;
      if (!isMainGuild(message.guild.id)) return;
      const match = message.content.trim().match(TRIGGER_RE);
      if (!match) return;
      const arg = match[1].trim().split(/\s+/)[0];
      const targetId = extractUserId(arg);
      if (!targetId) return;

      const member = await message.guild.members.fetch(targetId).catch(() => null);
      const user = member?.user ?? (await message.client.users.fetch(targetId).catch(() => null));
      if (!user) return;

      const globalAvatar = user.displayAvatarURL({ extension: "png", size: 1024, forceStatic: false });
      const serverAvatar = member?.displayAvatarURL({ extension: "png", size: 1024, forceStatic: false });
      const display = serverAvatar ?? globalAvatar;

      const links: string[] = [`[Global avatar](${globalAvatar})`];
      if (serverAvatar && serverAvatar !== globalAvatar) links.push(`[Server avatar](${serverAvatar})`);

      const embed = new EmbedBuilder()
        .setColor(0x5000ff)
        .setAuthor({ name: member?.displayName ?? user.username, iconURL: globalAvatar })
        .setTitle("Avatar Link")
        .setDescription(`**Global & Server Avatar**\n${links.join(" • ")}`)
        .setImage(display)
        .setFooter({ text: `Requested by ${message.author.username}`, iconURL: message.author.displayAvatarURL() })
        .setTimestamp();

      await message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } }).catch(() => {});
    } catch (err) {
      console.error("[Avatar] messageCreate error:", err);
    }
  });
}
