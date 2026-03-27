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
import { botConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";

interface VerifyPanelState {
  verificatorsRoleId?: string;
  logsChannelId?: string;
  verifyCategoryId?: string;
  assistCategoryId?: string;
  verifiedRoleId?: string;
  unverifiedRoleId?: string;
  jailRoleId?: string;
}

export const verifyPanelState = new Map<string, VerifyPanelState>();

const DEFAULT_QUESTIONS = [
  "Wach nta mghribi ?",
  "Mnin dkhlti l server ?",
  "3lach dkhlti l server ?",
  "Ch7al f3mrk ?",
  "Chno lhaja libghiti tl9aha f server ?",
];

function buildVerifyPanelEmbed(state: VerifyPanelState) {
  const allRequired = !!(state.verificatorsRoleId && state.logsChannelId);

  return new EmbedBuilder()
    .setColor(allRequired ? 0x2ecc71 : 0x5865f2)
    .setTitle("🛡️ NSV — Night Stars Verification Setup")
    .addFields(
      {
        name: "Verificators Role `required`",
        value: state.verificatorsRoleId
          ? `<@&${state.verificatorsRoleId}>`
          : "Staff who can accept, deny or jail members.",
        inline: true,
      },
      {
        name: "Logs Channel `required`",
        value: state.logsChannelId
          ? `<#${state.logsChannelId}>`
          : "Where verification requests are sent for review.",
        inline: true,
      },
      { name: "\u200B", value: "\u200B", inline: false },
      {
        name: "Verified Role `optional`",
        value: state.verifiedRoleId
          ? `<@&${state.verifiedRoleId}>`
          : "Granted when a member is accepted.",
        inline: true,
      },
      {
        name: "Unverified Role `optional`",
        value: state.unverifiedRoleId
          ? `<@&${state.unverifiedRoleId}>`
          : "Removed when a member is accepted.",
        inline: true,
      },
      {
        name: "Jail Role `optional`",
        value: state.jailRoleId
          ? `<@&${state.jailRoleId}>`
          : "Assigned when a member is jailed.",
        inline: true,
      },
      { name: "\u200B", value: "\u200B", inline: false },
      {
        name: "Verification Category `optional`",
        value: state.verifyCategoryId
          ? `<#${state.verifyCategoryId}>`
          : "Category for verification channels.",
        inline: true,
      },
      {
        name: "Assistance Category `optional`",
        value: state.assistCategoryId
          ? `<#${state.assistCategoryId}>`
          : "Category where ticket channels are created.",
        inline: true,
      }
    )
    .setFooter({
      text: allRequired
        ? "Ready to save — click Save Configuration."
        : "Fill in the required fields to enable saving.",
    });
}

function buildVerifyPanelComponents(state: VerifyPanelState) {
  const canSave = !!(state.verificatorsRoleId && state.logsChannelId);

  const row1 = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId("vp_verificators_role")
      .setPlaceholder(state.verificatorsRoleId ? "✅ Verificators Role — click to change" : "Select Verificators Role...")
      .setMinValues(1).setMaxValues(1)
  );

  const row2 = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("vp_logs_channel")
      .setPlaceholder(state.logsChannelId ? "✅ Logs Channel — click to change" : "Select Logs Channel...")
      .addChannelTypes(ChannelType.GuildText)
      .setMinValues(1).setMaxValues(1)
  );

  const row3 = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId("vp_roles_group")
      .setPlaceholder(
        [state.verifiedRoleId && "✅ Verified", state.unverifiedRoleId && "✅ Unverified", state.jailRoleId && "✅ Jail"]
          .filter(Boolean).join(" • ") || "Select Verified / Unverified / Jail Role..."
      )
      .setMinValues(1).setMaxValues(3)
  );

  const row4 = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("vp_verify_category")
      .setPlaceholder(state.verifyCategoryId ? "✅ Verification Category — click to change" : "Verification Category (optional)...")
      .addChannelTypes(ChannelType.GuildCategory)
      .setMinValues(0).setMaxValues(1)
  );

  const row5 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("vp_save")
      .setLabel(canSave ? "Save Configuration" : "Save (fill required fields first)")
      .setEmoji(canSave ? "💾" : "🔒")
      .setStyle(canSave ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setDisabled(!canSave),
    new ButtonBuilder()
      .setCustomId("vp_edit_questions")
      .setLabel("Edit Questions")
      .setEmoji("📝")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("vp_reset")
      .setLabel("Reset")
      .setEmoji("🔄")
      .setStyle(ButtonStyle.Danger)
  );

  return [row1, row2, row3, row4, row5];
}

export async function openVerifyPanel(interaction: ButtonInteraction) {
  const userId = interaction.user.id;

  const config = await db
    .select()
    .from(botConfigTable)
    .where(eq(botConfigTable.guildId, interaction.guild!.id))
    .limit(1);

  const existing = config[0];
  const state: VerifyPanelState = {
    verificatorsRoleId: existing?.verificatorsRoleId ?? undefined,
    logsChannelId: existing?.verificationLogsChannelId ?? undefined,
    verifyCategoryId: existing?.verificationCategoryId ?? undefined,
    assistCategoryId: existing?.assistanceCategoryId ?? undefined,
    verifiedRoleId: existing?.verifiedRoleId ?? undefined,
    unverifiedRoleId: existing?.unverifiedRoleId ?? undefined,
    jailRoleId: existing?.jailRoleId ?? undefined,
  };
  verifyPanelState.set(userId, state);

  await interaction.reply({
    embeds: [buildVerifyPanelEmbed(state)],
    components: buildVerifyPanelComponents(state),
    ephemeral: true,
  });
}

export async function openEditQuestionsModal(interaction: ButtonInteraction) {
  const guildId = interaction.guild!.id;
  const config = await db.select().from(botConfigTable).where(eq(botConfigTable.guildId, guildId)).limit(1);
  let questions = DEFAULT_QUESTIONS;
  try {
    if (config[0]?.verificationQuestions) {
      questions = JSON.parse(config[0].verificationQuestions);
    }
  } catch {}

  const modal = new ModalBuilder()
    .setCustomId("vp_questions_modal")
    .setTitle("Edit Verification Questions");

  for (let i = 0; i < 5; i++) {
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(`vq${i + 1}`)
          .setLabel(`Question ${i + 1}`)
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(100)
          .setValue(questions[i] ?? "")
      )
    );
  }

  await interaction.showModal(modal);
}

export async function handleEditQuestionsSubmit(interaction: ModalSubmitInteraction) {
  const guildId = interaction.guild!.id;

  const questions = [
    interaction.fields.getTextInputValue("vq1").trim(),
    interaction.fields.getTextInputValue("vq2").trim(),
    interaction.fields.getTextInputValue("vq3").trim(),
    interaction.fields.getTextInputValue("vq4").trim(),
    interaction.fields.getTextInputValue("vq5").trim(),
  ];

  const existing = await db.select().from(botConfigTable).where(eq(botConfigTable.guildId, guildId)).limit(1);

  if (existing.length) {
    await db.update(botConfigTable).set({
      verificationQuestions: JSON.stringify(questions),
      updatedAt: new Date(),
    }).where(eq(botConfigTable.guildId, guildId));
  } else {
    await db.insert(botConfigTable).values({
      guildId,
      verificationQuestions: JSON.stringify(questions),
    });
  }

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle("✅ Questions Updated")
        .setDescription("The 5 verification questions have been saved. New members will see the updated questions.")
        .addFields(questions.map((q, i) => ({ name: `Q${i + 1}`, value: q, inline: false })))
        .setFooter({ text: "Night Stars • NSV" }),
    ],
    ephemeral: true,
  });
}

export async function handleVerifyPanelSelect(
  interaction: RoleSelectMenuInteraction | ChannelSelectMenuInteraction
) {
  const userId = interaction.user.id;
  const state = verifyPanelState.get(userId) ?? {};

  if (interaction.customId === "vp_verificators_role") {
    state.verificatorsRoleId = (interaction as RoleSelectMenuInteraction).values[0];
  } else if (interaction.customId === "vp_logs_channel") {
    state.logsChannelId = (interaction as ChannelSelectMenuInteraction).values[0];
  } else if (interaction.customId === "vp_verify_category") {
    state.verifyCategoryId = (interaction as ChannelSelectMenuInteraction).values[0] ?? undefined;
    state.assistCategoryId = (interaction as ChannelSelectMenuInteraction).values[0] ?? undefined;
  } else if (interaction.customId === "vp_roles_group") {
    const values = (interaction as RoleSelectMenuInteraction).values;
    if (values.length >= 1) state.verifiedRoleId = values[0];
    if (values.length >= 2) state.unverifiedRoleId = values[1];
    if (values.length >= 3) state.jailRoleId = values[2];
  }

  verifyPanelState.set(userId, state);

  await interaction.update({
    embeds: [buildVerifyPanelEmbed(state)],
    components: buildVerifyPanelComponents(state),
  });
}

export async function handleVerifyPanelSave(interaction: ButtonInteraction) {
  const userId = interaction.user.id;
  const state = verifyPanelState.get(userId) ?? {};

  if (!state.verificatorsRoleId || !state.logsChannelId) {
    await interaction.reply({
      embeds: [new EmbedBuilder().setColor(0xe74c3c).setDescription("❌ Please fill in all required fields before saving.")],
      ephemeral: true,
    });
    return;
  }

  const guildId = interaction.guild!.id;
  const existing = await db.select().from(botConfigTable).where(eq(botConfigTable.guildId, guildId)).limit(1);

  if (existing.length) {
    await db.update(botConfigTable).set({
      verificatorsRoleId: state.verificatorsRoleId,
      verificationLogsChannelId: state.logsChannelId,
      verificationCategoryId: state.verifyCategoryId ?? null,
      assistanceCategoryId: state.assistCategoryId ?? null,
      verifiedRoleId: state.verifiedRoleId ?? null,
      unverifiedRoleId: state.unverifiedRoleId ?? null,
      jailRoleId: state.jailRoleId ?? null,
      updatedAt: new Date(),
    }).where(eq(botConfigTable.guildId, guildId));
  } else {
    await db.insert(botConfigTable).values({
      guildId,
      verificatorsRoleId: state.verificatorsRoleId,
      verificationLogsChannelId: state.logsChannelId,
      verificationCategoryId: state.verifyCategoryId ?? null,
      assistanceCategoryId: state.assistCategoryId ?? null,
      verifiedRoleId: state.verifiedRoleId ?? null,
      unverifiedRoleId: state.unverifiedRoleId ?? null,
      jailRoleId: state.jailRoleId ?? null,
    });
  }

  verifyPanelState.delete(userId);

  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle("✅ NSV Saved")
        .addFields(
          { name: "Verificators Role", value: `<@&${state.verificatorsRoleId}>`, inline: true },
          { name: "Logs Channel", value: `<#${state.logsChannelId}>`, inline: true },
          { name: "Verified Role", value: state.verifiedRoleId ? `<@&${state.verifiedRoleId}>` : "Not set", inline: true },
          { name: "Unverified Role", value: state.unverifiedRoleId ? `<@&${state.unverifiedRoleId}>` : "Not set", inline: true },
          { name: "Jail Role", value: state.jailRoleId ? `<@&${state.jailRoleId}>` : "Not set", inline: true },
        )
        .setDescription("Configuration saved. Use **Post Verification Panel** from the main panel to deploy the join button.")
        .setFooter({ text: "Night Stars • NSV" }),
    ],
    components: [],
  });
}

export async function handleVerifyPanelReset(interaction: ButtonInteraction) {
  const state: VerifyPanelState = {};
  verifyPanelState.set(interaction.user.id, state);
  await interaction.update({
    embeds: [buildVerifyPanelEmbed(state)],
    components: buildVerifyPanelComponents(state),
  });
}
