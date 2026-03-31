import {
  ButtonInteraction,
  RoleSelectMenuInteraction,
  ChannelSelectMenuInteraction,
  ModalSubmitInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  RoleSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { db } from "@workspace/db";
import { botConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";

interface AnnPanelState {
  announcementsRoleId?: string;
  eventHosterRoleId?: string;
  annLogsChannelId?: string;
}

export const annPanelState = new Map<string, AnnPanelState>();

function buildAnnPanelEmbed(state: AnnPanelState) {
  return new EmbedBuilder()
    .setColor(0x5000ff)
    .setTitle("\uD83D\uDCE3 Announcements Setup")
    .setDescription(
      `**Ann Role** \u2014 ${state.announcementsRoleId ? `<@&${state.announcementsRoleId}>` : "not set"}\n` +
      "\u2514 Can post announcements and events\n\n" +
      `**Event Hoster Role** \u2014 ${state.eventHosterRoleId ? `<@&${state.eventHosterRoleId}>` : "not set"}\n` +
      "\u2514 Can post in event mode only\n\n" +
      `**Logs Channel** \u2014 ${state.annLogsChannelId ? `<#${state.annLogsChannelId}>` : "not set"}\n` +
      "\u2514 Receives a log for every announcement/event posted"
    )
    .setFooter({ text: "Night Stars \u2022 Announcements" });
}

function buildAnnPanelComponents(state: AnnPanelState) {
  const canSave = !!(state.announcementsRoleId || state.eventHosterRoleId || state.annLogsChannelId);

  const row1 = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId("ap_ann_role")
      .setPlaceholder(state.announcementsRoleId ? "\u2705 Ann Role (set)" : "Select Ann Role\u2026")
      .setMinValues(1)
      .setMaxValues(1)
  );

  const row2 = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId("ap_event_role")
      .setPlaceholder(state.eventHosterRoleId ? "\u2705 Event Hoster Role (set)" : "Select Event Hoster Role\u2026")
      .setMinValues(1)
      .setMaxValues(1)
  );

  const row3 = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("ap_logs_channel")
      .setPlaceholder(state.annLogsChannelId ? "\u2705 Logs Channel (set)" : "Select Logs Channel\u2026")
      .addChannelTypes(ChannelType.GuildText)
      .setMinValues(1)
      .setMaxValues(1)
  );

  const row4 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("ap_save").setLabel("Save").setStyle(ButtonStyle.Success).setDisabled(!canSave),
    new ButtonBuilder().setCustomId("ap_reset").setLabel("Reset").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("ap_event_color_open").setLabel("\uD83C\uDFA8 Event Color").setStyle(ButtonStyle.Secondary),
  );

  return [row1, row2, row3, row4];
}

function buildColorPanelEmbed() {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("\uD83C\uDFA8 Event Embed Colors")
    .setDescription(
      "Set the color for each part of the event embed.\n" +
      "Click a button and type a hex code (e.g. `5865F2`).\n\n" +
      "**Title / Time** \u2014 the heading or time embed \u2014 default `5865F2` (blurple)\n" +
      "**Description** \u2014 the main body embed \u2014 default `5865F2` (blurple)\n" +
      "**Additional** \u2014 the extra bottom embed \u2014 default `5865F2` (blurple)"
    )
    .setFooter({ text: "Night Stars \u2022 Announcements" });
}

function buildColorPanelComponents() {
  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("ap_color_event_title").setLabel("Title / Time Color").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("ap_color_event_desc").setLabel("Description Color").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("ap_color_event_add").setLabel("Additional Color").setStyle(ButtonStyle.Primary),
  );
  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("ap_back").setLabel("\u2190 Back").setStyle(ButtonStyle.Secondary),
  );
  return [row1, row2];
}

export async function openAnnPanel(interaction: ButtonInteraction | any) {
  const userId = interaction.user.id;
  const config = await db.select().from(botConfigTable).where(eq(botConfigTable.guildId, interaction.guild!.id)).limit(1);
  const row = config[0];
  const state: AnnPanelState = {
    announcementsRoleId: row?.announcementsRoleId ?? undefined,
    eventHosterRoleId:   row?.eventHosterRoleId   ?? undefined,
    annLogsChannelId:    row?.annLogsChannelId     ?? undefined,
  };
  annPanelState.set(userId, state);
  if (typeof interaction.update === "function") {
    await interaction.update({ embeds: [buildAnnPanelEmbed(state)], components: buildAnnPanelComponents(state) });
  } else {
    await interaction.editReply({ embeds: [buildAnnPanelEmbed(state)], components: buildAnnPanelComponents(state) });
  }
}

export async function handleAnnAnnRoleSelect(interaction: RoleSelectMenuInteraction) {
  const userId = interaction.user.id;
  const state = annPanelState.get(userId) ?? {};
  state.announcementsRoleId = interaction.values[0];
  annPanelState.set(userId, state);
  if (typeof interaction.update === "function") {
    await interaction.update({ embeds: [buildAnnPanelEmbed(state)], components: buildAnnPanelComponents(state) });
  } else {
    await interaction.editReply({ embeds: [buildAnnPanelEmbed(state)], components: buildAnnPanelComponents(state) });
  }
}

export async function handleAnnEventRoleSelect(interaction: RoleSelectMenuInteraction) {
  const userId = interaction.user.id;
  const state = annPanelState.get(userId) ?? {};
  state.eventHosterRoleId = interaction.values[0];
  annPanelState.set(userId, state);
  if (typeof interaction.update === "function") {
    await interaction.update({ embeds: [buildAnnPanelEmbed(state)], components: buildAnnPanelComponents(state) });
  } else {
    await interaction.editReply({ embeds: [buildAnnPanelEmbed(state)], components: buildAnnPanelComponents(state) });
  }
}

export async function handleAnnLogsChannelSelect(interaction: ChannelSelectMenuInteraction) {
  const userId = interaction.user.id;
  const state = annPanelState.get(userId) ?? {};
  state.annLogsChannelId = interaction.values[0];
  annPanelState.set(userId, state);
  if (typeof interaction.update === "function") {
    await interaction.update({ embeds: [buildAnnPanelEmbed(state)], components: buildAnnPanelComponents(state) });
  } else {
    await interaction.editReply({ embeds: [buildAnnPanelEmbed(state)], components: buildAnnPanelComponents(state) });
  }
}

export async function handleAnnPanelSave(interaction: ButtonInteraction) {
  const userId = interaction.user.id;
  const state = annPanelState.get(userId);
  if (!state) { await interaction.reply({ content: "\u274C No changes to save.", ephemeral: true }); return; }

  const guildId = interaction.guild!.id;
  const existing = await db.select().from(botConfigTable).where(eq(botConfigTable.guildId, guildId)).limit(1);

  const updateData = {
    announcementsRoleId: state.announcementsRoleId ?? null,
    eventHosterRoleId:   state.eventHosterRoleId   ?? null,
    annLogsChannelId:    state.annLogsChannelId     ?? null,
    updatedAt: new Date(),
  };

  if (existing.length) {
    await db.update(botConfigTable).set(updateData).where(eq(botConfigTable.guildId, guildId));
  } else {
    await db.insert(botConfigTable).values({ guildId, ...updateData });
  }

  await interaction.update({
    embeds: [buildAnnPanelEmbed(state).setFooter({ text: "\u2705 Saved \u2014 Night Stars \u2022 Announcements" })],
    components: buildAnnPanelComponents(state),
  });
}

export async function handleAnnPanelReset(interaction: ButtonInteraction) {
  const userId = interaction.user.id;
  const guildId = interaction.guild!.id;
  const existing = await db.select().from(botConfigTable).where(eq(botConfigTable.guildId, guildId)).limit(1);
  if (existing.length) {
    await db.update(botConfigTable).set({
      announcementsRoleId: null,
      eventHosterRoleId:   null,
      annLogsChannelId:    null,
      updatedAt: new Date(),
    }).where(eq(botConfigTable.guildId, guildId));
  }
  const state: AnnPanelState = {};
  annPanelState.set(userId, state);
  await interaction.update({ embeds: [buildAnnPanelEmbed(state)], components: buildAnnPanelComponents(state) });
}

export async function openAnnColorPanel(interaction: ButtonInteraction) {
  if (typeof interaction.update === "function") {
    await interaction.update({ embeds: [buildColorPanelEmbed()], components: buildColorPanelComponents() });
  } else {
    await interaction.editReply({ embeds: [buildColorPanelEmbed()], components: buildColorPanelComponents() });
  }
}

export async function openAnnColorModal(interaction: ButtonInteraction, type: string) {
  const labels: Record<string, string> = {
    event_title: "Title / Time Color (hex, e.g. 5865F2)",
    event_desc:  "Description Color (hex, e.g. 5865F2)",
    event_add:   "Additional Color (hex, e.g. 5865F2)",
  };
  const modal = new ModalBuilder()
    .setCustomId(`ap_modal_${type}`)
    .setTitle("Set Event Color");
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("hex_color")
        .setLabel(labels[type] ?? "Color hex code")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder("5865F2")
        .setMaxLength(7)
    )
  );
  await interaction.showModal(modal);
}

export async function handleAnnColorModalSubmit(interaction: ModalSubmitInteraction, type: string) {
  const raw = interaction.fields.getTextInputValue("hex_color").trim().replace(/^#/, "");
  const num = parseInt(raw, 16);
  if (isNaN(num) || raw.length < 3 || raw.length > 6) {
    await interaction.reply({
      embeds: [new EmbedBuilder().setColor(0x5000ff).setDescription("\u274C Invalid hex color. Use something like `5865F2` or `#5865F2`.")],
      ephemeral: true,
    });
    return;
  }
  const guildId = interaction.guild!.id;
  const updateData =
    type === "event_title" ? { eventColor:     raw, updatedAt: new Date() } :
    type === "event_desc"  ? { eventDescColor: raw, updatedAt: new Date() } :
                             { eventAddColor:  raw, updatedAt: new Date() };
  const insertData =
    type === "event_title" ? { guildId, eventColor:     raw } :
    type === "event_desc"  ? { guildId, eventDescColor: raw } :
                             { guildId, eventAddColor:  raw };
  const existing = await db.select().from(botConfigTable).where(eq(botConfigTable.guildId, guildId)).limit(1);
  if (existing.length) {
    await db.update(botConfigTable).set(updateData).where(eq(botConfigTable.guildId, guildId));
  } else {
    await db.insert(botConfigTable).values(insertData);
  }
  const labels: Record<string, string> = {
    event_title: "Event \u2014 Title / Time",
    event_desc:  "Event \u2014 Description",
    event_add:   "Event \u2014 Additional",
  };
  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(num)
        .setDescription(`\u2705 **${labels[type] ?? type}** color set to \`#${raw}\``)
        .setFooter({ text: "Night Stars \u2022 Announcements" }),
    ],
    ephemeral: true,
  });
}

export async function handleAnnColorBack(interaction: ButtonInteraction) {
  const state = annPanelState.get(interaction.user.id) ?? {};
  if (typeof interaction.update === "function") {
    await interaction.update({ embeds: [buildAnnPanelEmbed(state)], components: buildAnnPanelComponents(state) });
  } else {
    await interaction.editReply({ embeds: [buildAnnPanelEmbed(state)], components: buildAnnPanelComponents(state) });
  }
}
