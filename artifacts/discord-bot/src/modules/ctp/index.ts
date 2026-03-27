import { Client, Message, EmbedBuilder, ChannelType, TextChannel } from "discord.js";
import { db } from "@workspace/db";
import { ctpCategoriesTable, ctpCooldownsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const CTP_PREFIX = "-";

export function registerCTPModule(client: Client) {
  client.on("messageCreate", async (message: Message) => {
    if (message.author.bot) return;
    if (!message.guild) return;
    if (!message.content.startsWith(CTP_PREFIX)) return;

    const content = message.content.slice(CTP_PREFIX.length).trim();
    if (!content) return;

    const member = message.member;
    if (!member) return;

    const voiceChannel = member.voice.channel;
    if (!voiceChannel) return;

    const categoryId = voiceChannel.parentId;
    if (!categoryId) return;

    const ctpConfig = await db
      .select()
      .from(ctpCategoriesTable)
      .where(
        and(
          eq(ctpCategoriesTable.guildId, message.guild.id),
          eq(ctpCategoriesTable.categoryId, categoryId),
          eq(ctpCategoriesTable.enabled, 1)
        )
      )
      .limit(1);

    if (!ctpConfig.length) return;

    const config = ctpConfig[0];
    const now = new Date();

    const cooldownRecord = await db
      .select()
      .from(ctpCooldownsTable)
      .where(
        and(
          eq(ctpCooldownsTable.guildId, message.guild.id),
          eq(ctpCooldownsTable.categoryId, categoryId)
        )
      )
      .limit(1);

    if (cooldownRecord.length) {
      const lastUsed = cooldownRecord[0].lastUsedAt;
      const elapsed = (now.getTime() - lastUsed.getTime()) / 1000;
      if (elapsed < config.cooldownSeconds) {
        const remaining = Math.ceil(config.cooldownSeconds - elapsed);
        const minutes = Math.floor(remaining / 60);
        const seconds = remaining % 60;
        const timeStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

        const cooldownEmbed = new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle("⏳ Call to Play — Cooldown Active")
          .setDescription(
            `The **${config.gameName}** call was used recently.\n\n` +
            `Please wait **${timeStr}** before calling again.`
          )
          .setFooter({ text: `Cooldown: ${config.cooldownSeconds}s • Night Stars CTP` });

        await message.delete().catch(() => {});
        const notice = await message.channel.send({ embeds: [cooldownEmbed] });
        setTimeout(() => notice.delete().catch(() => {}), 8000);
        return;
      }
    }

    const pingText = config.pingMessage ?? content;

    const pingEmbed = new EmbedBuilder()
      .setColor(0x9b59b6)
      .setTitle(`🎮 ${config.gameName} — Call to Play`)
      .setDescription(
        `<@&${config.gameRoleId}>\n\n` +
        `**${member.displayName}** is calling:\n` +
        `> ${pingText}`
      )
      .addFields({
        name: "Voice Channel",
        value: `🔊 ${voiceChannel.name}`,
        inline: true,
      })
      .setFooter({ text: `Night Stars CTP • Cooldown resets in ${config.cooldownSeconds}s` })
      .setTimestamp();

    let targetChannel: TextChannel;
    if (config.outputChannelId) {
      const ch = message.guild.channels.cache.get(config.outputChannelId);
      targetChannel = (ch?.type === ChannelType.GuildText ? ch : message.channel) as TextChannel;
    } else {
      targetChannel = message.channel as TextChannel;
    }

    await message.delete().catch(() => {});
    await targetChannel.send({ embeds: [pingEmbed] });

    if (cooldownRecord.length) {
      await db
        .update(ctpCooldownsTable)
        .set({ lastUsedAt: now })
        .where(
          and(
            eq(ctpCooldownsTable.guildId, message.guild.id),
            eq(ctpCooldownsTable.categoryId, categoryId)
          )
        );
    } else {
      await db.insert(ctpCooldownsTable).values({
        guildId: message.guild.id,
        categoryId,
        lastUsedAt: now,
      });
    }
  });
}
