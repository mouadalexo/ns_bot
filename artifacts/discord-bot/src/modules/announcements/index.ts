import {
  Client,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  TextChannel,
  PermissionFlagsBits,
  Message,
} from "discord.js";
import { db } from "@workspace/db";
import { botConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { isMainGuild } from "../../utils/guildFilter.js";

const GOLD  = 0xffe500;
const BRAND = 0x5000ff;

// userId → channelId  (where to post the final event)
const pendingEventChannels = new Map<string, string>();

async function isAuthorized(message: Message): Promise<boolean> {
  const member = message.member;
  if (!member || !message.guildId) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  try {
    const [config] = await db
      .select()
      .from(botConfigTable)
      .where(eq(botConfigTable.guildId, message.guildId))
      .limit(1);
    if (config?.staffRoleId && member.roles.cache.has(config.staffRoleId)) return true;
    if (config?.verificatorsRoleId && member.roles.cache.has(config.verificatorsRoleId)) return true;
  } catch {}
  return false;
}

async function tempReply(message: Message, text: string, ms = 5000) {
  const r = await message.reply(text).catch(() => null);
  if (r) setTimeout(() => r.delete().catch(() => {}), ms);
}

export function registerAnnouncementsModule(client: Client): void {

  // ── Message commands ──────────────────────────────────────────────────────
  client.on("messageCreate", async (message) => {
    if (!message.guild || message.author.bot) return;
    if (!isMainGuild(message.guild.id)) return;

    const raw = message.content.trim();

    // ── !announce [text] (+ optional image attachment) ──
    if (raw.startsWith("!announce")) {
      if (!await isAuthorized(message)) {
        await tempReply(message, "❌ You don't have permission to use this command.");
        return;
      }

      const text = raw.slice("!announce".length).trim();
      const image = message.attachments.first();

      if (!text && !image) {
        await tempReply(message, "❌ Write your announcement text after `!announce`, or attach an image.");
        return;
      }

      const channel = message.channel as TextChannel;
      await message.delete().catch(() => {});

      const embed = new EmbedBuilder()
        .setColor(GOLD)
        .setAuthor({
          name: message.guild.name,
          iconURL: message.guild.iconURL() ?? undefined,
        })
        .setTimestamp()
        .setFooter({ text: "Night Stars  •  Announcement" });

      if (text) embed.setDescription(text);
      if (image) embed.setImage(image.url);

      await channel.send({ content: "@everyone", embeds: [embed] });
      return;
    }

    // ── !event ──
    if (raw === "!event") {
      if (!await isAuthorized(message)) {
        await tempReply(message, "❌ You don't have permission to use this command.");
        return;
      }

      const channel = message.channel as TextChannel;
      pendingEventChannels.set(message.author.id, channel.id);
      await message.delete().catch(() => {});

      const setupEmbed = new EmbedBuilder()
        .setColor(BRAND)
        .setTitle("🎉 Event Setup")
        .setDescription(
          "Click **Fill Event Details** to open the form.\n" +
          "The event will be posted in this channel once you confirm."
        )
        .setFooter({ text: `Setup by ${message.author.tag}` });

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`announce_fill_event:${message.author.id}`)
          .setLabel("📋 Fill Event Details")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`announce_cancel_event:${message.author.id}`)
          .setLabel("✕ Cancel")
          .setStyle(ButtonStyle.Danger),
      );

      await channel.send({ embeds: [setupEmbed], components: [row] });
      return;
    }
  });

  // ── Button interactions ───────────────────────────────────────────────────
  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isButton() || !interaction.guild) return;

    // Fill event details
    if (interaction.customId.startsWith("announce_fill_event:")) {
      const userId = interaction.customId.slice("announce_fill_event:".length);
      if (interaction.user.id !== userId) {
        await interaction.reply({ content: "❌ This button is not for you.", ephemeral: true });
        return;
      }

      const modal = new ModalBuilder()
        .setCustomId(`announce_event_modal:${interaction.message.id}`)
        .setTitle("🎉 New Event");

      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("event_name")
            .setLabel("Event Name")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("e.g. Night Stars Tournament")
            .setRequired(true)
            .setMaxLength(100)
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("event_datetime")
            .setLabel("Date & Time")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("e.g. Saturday 20 April at 8PM (GMT+1)")
            .setRequired(true)
            .setMaxLength(100)
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("event_description")
            .setLabel("Description")
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder("Describe the event, rules, prizes, etc.")
            .setRequired(true)
            .setMaxLength(1000)
        ),
      );

      await interaction.showModal(modal);
      return;
    }

    // Cancel event setup
    if (interaction.customId.startsWith("announce_cancel_event:")) {
      const userId = interaction.customId.slice("announce_cancel_event:".length);
      if (interaction.user.id !== userId) {
        await interaction.reply({ content: "❌ This button is not for you.", ephemeral: true });
        return;
      }

      pendingEventChannels.delete(userId);
      await interaction.message.delete().catch(() => {});
      await interaction.reply({ content: "✅ Event setup cancelled.", ephemeral: true });
      return;
    }
  });

  // ── Modal submit ──────────────────────────────────────────────────────────
  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isModalSubmit() || !interaction.guild) return;
    if (!interaction.customId.startsWith("announce_event_modal:")) return;

    const setupMessageId = interaction.customId.slice("announce_event_modal:".length);
    const channelId = pendingEventChannels.get(interaction.user.id);

    const eventName        = interaction.fields.getTextInputValue("event_name").trim();
    const eventDatetime    = interaction.fields.getTextInputValue("event_datetime").trim();
    const eventDescription = interaction.fields.getTextInputValue("event_description").trim();

    // Delete the temporary setup message
    try {
      const targetCh = channelId
        ? await interaction.guild.channels.fetch(channelId) as TextChannel
        : interaction.channel as TextChannel;
      const setupMsg = await targetCh.messages.fetch(setupMessageId).catch(() => null);
      await setupMsg?.delete().catch(() => {});
    } catch {}

    pendingEventChannels.delete(interaction.user.id);

    // Resolve the channel to post the event in
    const postChannel = channelId
      ? (await interaction.guild.channels.fetch(channelId).catch(() => null) as TextChannel | null)
      : (interaction.channel as TextChannel);

    if (!postChannel) {
      await interaction.reply({ content: "❌ Could not find the target channel.", ephemeral: true });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(GOLD)
      .setAuthor({
        name: interaction.guild.name,
        iconURL: interaction.guild.iconURL() ?? undefined,
      })
      .setTitle(`🎉  ${eventName}`)
      .addFields(
        { name: "📅  Date & Time",  value: eventDatetime,    inline: false },
        { name: "📝  Description",  value: eventDescription, inline: false },
      )
      .setTimestamp()
      .setFooter({ text: "Night Stars  •  Events" });

    await postChannel.send({ content: "@everyone", embeds: [embed] });
    await interaction.reply({ content: "✅ Event posted successfully!", ephemeral: true });
  });
}
