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
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
} from "discord.js";
import { db } from "@workspace/db";
import { ctpCategoriesTable, ctpCooldownsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

interface CtpPanelState {
  categoryId?: string;
  gameRoleId?: string;
  gameName?: string;
  cooldown?: string;
  pingMessage?: string;
  outputChannelId?: string;
}

export const ctpPanelState = new Map<string, CtpPanelState>();

function buildCtpPanelEmbed(state: CtpPanelState) {
  const canSave = !!(state.categoryId && state.gameRoleId && state.gameName);

  return new EmbedBuilder()
    .setColor(canSave ? 0x2ecc71 : 0xe67e22)
    .setTitle("🎮 CTP — Call to Play Setup")
    .addFields(
      {
        name: "Game Name `required`",
        value: state.gameName ?? "Set via **Game Details** button below.",
        inline: true,
      },
      {
        name: "Role `required`",
        value: state.gameRoleId ? `<@&${state.gameRoleId}>` : "The role that gets pinged.",
        inline: true,
      },
      {
        name: "Category `required`",
        value: state.categoryId
          ? `<#${state.categoryId}>`
          : "Category with your game voice channels.",
        inline: true,
      },
      { name: "\u200B", value: "\u200B", inline: false },
      {
        name: "Cooldown",
        value: state.cooldown ? `${state.cooldown}s` : "60s (default)",
        inline: true,
      },
      {
        name: "Custom Ping Message",
        value: state.pingMessage ?? "Uses the member's own message.",
        inline: true,
      },
      {
        name: "Output Channel",
        value: state.outputChannelId ? `<#${state.outputChannelId}>` : "Same channel as the command.",
        inline: true,
      }
    )
    .setFooter({
      text: canSave
        ? "Ready to save — click Save."
        : "Fill in Game Name, Role and Category to continue.",
    });
}

function buildCtpPanelComponents(state: CtpPanelState) {
  const canSave = !!(state.categoryId && state.gameRoleId && state.gameName);

  const row1 = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("cp_category")
      .setPlaceholder(state.categoryId ? "✅ Category — click to change" : "Select Game Category...")
      .addChannelTypes(ChannelType.GuildCategory)
      .setMinValues(1)
      .setMaxValues(1)
  );

  const row2 = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId("cp_game_role")
      .setPlaceholder(state.gameRoleId ? "✅ Role — click to change" : "Select Role to ping...")
      .setMinValues(1)
      .setMaxValues(1)
  );

  const row3 = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("cp_output_channel")
      .setPlaceholder(state.outputChannelId ? "✅ Output Channel — click to change" : "Output Channel (optional)...")
      .addChannelTypes(ChannelType.GuildText)
      .setMinValues(0)
      .setMaxValues(1)
  );

  const row4 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("cp_open_details")
      .setLabel(state.gameName ? `Game Details — ${state.gameName}` : "Set Game Name & Cooldown")
      .setEmoji("📝")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("cp_save")
      .setLabel(canSave ? "Save" : "Save (fill required fields first)")
      .setEmoji(canSave ? "💾" : "🔒")
      .setStyle(canSave ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setDisabled(!canSave),
    new ButtonBuilder()
      .setCustomId("cp_reset")
      .setLabel("Reset")
      .setEmoji("🔄")
      .setStyle(ButtonStyle.Danger)
  );

  return [row1, row2, row3, row4];
}

export async function openCtpPanel(interaction: ButtonInteraction) {
  const userId = interaction.user.id;
  const state: CtpPanelState = {};
  ctpPanelState.set(userId, state);

  await interaction.reply({
    embeds: [buildCtpPanelEmbed(state)],
    components: buildCtpPanelComponents(state),
    ephemeral: true,
  });
}

export async function handleCtpPanelSelect(
  interaction: RoleSelectMenuInteraction | ChannelSelectMenuInteraction
) {
  const userId = interaction.user.id;
  const state = ctpPanelState.get(userId) ?? {};

  if (interaction.customId === "cp_category") {
    state.categoryId = (interaction as ChannelSelectMenuInteraction).values[0];
  } else if (interaction.customId === "cp_game_role") {
    state.gameRoleId = (interaction as RoleSelectMenuInteraction).values[0];
  } else if (interaction.customId === "cp_output_channel") {
    state.outputChannelId = (interaction as ChannelSelectMenuInteraction).values[0] ?? undefined;
  }

  ctpPanelState.set(userId, state);

  await interaction.update({
    embeds: [buildCtpPanelEmbed(state)],
    components: buildCtpPanelComponents(state),
  });
}

export async function openCtpDetailsModal(interaction: ButtonInteraction) {
  const state = ctpPanelState.get(interaction.user.id) ?? {};

  const modal = new ModalBuilder()
    .setCustomId("cp_details_modal")
    .setTitle("Game Details");

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("cp_game_name")
        .setLabel("Game Name (e.g. Valorant, CSGO, eFootball)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(50)
        .setValue(state.gameName ?? "")
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("cp_cooldown")
        .setLabel("Cooldown in seconds (default: 60)")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(6)
        .setValue(state.cooldown ?? "60")
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("cp_ping_msg")
        .setLabel("Custom Ping Message (optional)")
        .setPlaceholder("Leave empty to use the member's own message")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(200)
        .setValue(state.pingMessage ?? "")
    )
  );

  await interaction.showModal(modal);
}

export async function handleCtpDetailsModalSubmit(interaction: ModalSubmitInteraction) {
  const userId = interaction.user.id;
  const state = ctpPanelState.get(userId) ?? {};

  state.gameName = interaction.fields.getTextInputValue("cp_game_name").trim();
  const cooldownRaw = interaction.fields.getTextInputValue("cp_cooldown").trim();
  state.cooldown = cooldownRaw || "60";
  const pingMsg = interaction.fields.getTextInputValue("cp_ping_msg").trim();
  state.pingMessage = pingMsg || undefined;

  ctpPanelState.set(userId, state);

  await interaction.update({
    embeds: [buildCtpPanelEmbed(state)],
    components: buildCtpPanelComponents(state),
  });
}

export async function handleCtpPanelSave(interaction: ButtonInteraction) {
  const userId = interaction.user.id;
  const state = ctpPanelState.get(userId) ?? {};

  if (!state.categoryId || !state.gameRoleId || !state.gameName) {
    await interaction.reply({
      embeds: [new EmbedBuilder().setColor(0xe74c3c).setDescription("❌ Please fill in all required fields before saving.")],
      ephemeral: true,
    });
    return;
  }

  const guildId = interaction.guild!.id;
  const cooldown = parseInt(state.cooldown ?? "60", 10);

  const existing = await db
    .select()
    .from(ctpCategoriesTable)
    .where(and(eq(ctpCategoriesTable.guildId, guildId), eq(ctpCategoriesTable.categoryId, state.categoryId)))
    .limit(1);

  if (existing.length) {
    await db.update(ctpCategoriesTable).set({
      gameName: state.gameName,
      gameRoleId: state.gameRoleId,
      cooldownSeconds: cooldown,
      pingMessage: state.pingMessage ?? null,
      outputChannelId: state.outputChannelId ?? null,
      enabled: 1,
    }).where(and(eq(ctpCategoriesTable.guildId, guildId), eq(ctpCategoriesTable.categoryId, state.categoryId)));
  } else {
    await db.insert(ctpCategoriesTable).values({
      guildId,
      categoryId: state.categoryId,
      gameName: state.gameName,
      gameRoleId: state.gameRoleId,
      cooldownSeconds: cooldown,
      pingMessage: state.pingMessage ?? null,
      outputChannelId: state.outputChannelId ?? null,
    });
  }

  await db.delete(ctpCooldownsTable).where(
    and(eq(ctpCooldownsTable.guildId, guildId), eq(ctpCooldownsTable.categoryId, state.categoryId))
  );

  ctpPanelState.delete(userId);

  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle("✅ CTP Saved")
        .addFields(
          { name: "Game Name", value: state.gameName, inline: true },
          { name: "Role", value: `<@&${state.gameRoleId}>`, inline: true },
          { name: "Category", value: `<#${state.categoryId}>`, inline: true },
          { name: "Cooldown", value: `${cooldown}s`, inline: true },
          { name: "Custom Message", value: state.pingMessage ?? "Member's message", inline: true },
          { name: "Output Channel", value: state.outputChannelId ? `<#${state.outputChannelId}>` : "Same channel", inline: true }
        )
        .setFooter({ text: "Night Stars • CTP" }),
    ],
    components: [],
  });
}

export async function handleCtpPanelReset(interaction: ButtonInteraction) {
  const state: CtpPanelState = {};
  ctpPanelState.set(interaction.user.id, state);
  await interaction.update({
    embeds: [buildCtpPanelEmbed(state)],
    components: buildCtpPanelComponents(state),
  });
}
