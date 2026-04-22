import {
  ButtonInteraction,
  RoleSelectMenuInteraction,
  ChannelSelectMenuInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  RoleSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
} from "discord.js";
import { db, pool } from "@workspace/db";
import { botConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";

interface GeneralPanelState {
  coreRoleId?: string;
  blockedChannels: string[];
  staffRoleIds: string[];
  eventHosterRoleId?: string;
  clearRoleIds: string[];
  moveRoleIds: string[];
  page: 1 | 2;
}

export const generalPanelState = new Map<string, GeneralPanelState>();

function emptyState(): GeneralPanelState {
  return {
    blockedChannels: [],
    staffRoleIds: [],
    clearRoleIds: [],
    moveRoleIds: [],
    page: 1,
  };
}

function buildPage1Embed(state: GeneralPanelState) {
  const blockedList = state.blockedChannels.length
    ? state.blockedChannels.map(id => `<#${id}>`).join(", ")
    : "none";

  const staffList = state.staffRoleIds.length
    ? state.staffRoleIds.map(id => `<@&${id}>`).join(", ")
    : "everyone (no restriction)";

  return new EmbedBuilder()
    .setColor(0x5000ff)
    .setTitle("\u2699\uFE0F General Setup \u2014 Page 1/2")
    .setDescription(
      `**Core Role** \u2014 ${state.coreRoleId ? `<@&${state.coreRoleId}>` : "not set"}\n` +
      "\u2514 Bypasses all permission checks across PVS\n\n" +
      `**Staff Role** \u2014 ${staffList}\n` +
      "\u2514 Only these roles can use `/help` (Admins and Core Role always bypass)\n\n" +
      `**Event Hoster Role** \u2014 ${state.eventHosterRoleId ? `<@&${state.eventHosterRoleId}>` : "not set"}\n` +
      "\u2514 Can use `=stagelock` / `=stageunlock` and host event announcements\n\n" +
      `**Blocked Channels** \u2014 ${blockedList}\n` +
      "\u2514 NS Bot text commands will not work in these channels\n\n" +
      "Click **Next \u25B6** to configure Clear & Move roles."
    )
    .setFooter({ text: "Night Stars \u2022 General Setup" });
}

function buildPage2Embed(state: GeneralPanelState) {
  const clearList = state.clearRoleIds.length
    ? state.clearRoleIds.map(id => `<@&${id}>`).join(", ")
    : "none (Admins only)";
  const moveList = state.moveRoleIds.length
    ? state.moveRoleIds.map(id => `<@&${id}>`).join(", ")
    : "none (Admins only)";

  return new EmbedBuilder()
    .setColor(0x5000ff)
    .setTitle("\u2699\uFE0F General Setup \u2014 Page 2/2")
    .setDescription(
      `**Clear Role** \u2014 ${clearList}\n` +
      "\u2514 Members with these roles can use `mse7 <1-99>` to clear messages\n\n" +
      `**Move Role** \u2014 ${moveList}\n` +
      "\u2514 Members with these roles can use `aji @user` to move members\n\n" +
      "Admins can always use both commands. Click **Save** to apply all changes."
    )
    .setFooter({ text: "Night Stars \u2022 General Setup" });
}

function hasAnyChange(state: GeneralPanelState): boolean {
  return !!(
    state.coreRoleId ||
    state.blockedChannels.length ||
    state.staffRoleIds.length ||
    state.eventHosterRoleId ||
    state.clearRoleIds.length ||
    state.moveRoleIds.length
  );
}

function buildPage1Components(state: GeneralPanelState) {
  const canSave = hasAnyChange(state);

  const row1 = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId("gp_staff_role")
      .setPlaceholder(state.coreRoleId ? "\u2705 Core Role (set)" : "Select Core Role\u2026")
      .setMinValues(1)
      .setMaxValues(1)
  );

  const row2 = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId("gp_help_roles")
      .setPlaceholder(
        state.staffRoleIds.length
          ? `\u2705 ${state.staffRoleIds.length} Staff Role(s) selected`
          : "Select Staff Role (can use /help)\u2026"
      )
      .setMinValues(0)
      .setMaxValues(10)
  );

  const row3 = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId("gp_event_hoster")
      .setPlaceholder(
        state.eventHosterRoleId
          ? "\u2705 Event Hoster Role (set)"
          : "Select Event Hoster Role\u2026"
      )
      .setMinValues(0)
      .setMaxValues(1)
  );

  const row4 = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("gp_blocked_ch")
      .setPlaceholder(
        state.blockedChannels.length
          ? `\u2705 ${state.blockedChannels.length} channel(s) blocked`
          : "Block channels (text commands won\u2019t work here)\u2026"
      )
      .addChannelTypes(ChannelType.GuildText)
      .setMinValues(0)
      .setMaxValues(25)
  );

  const row5 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("gp_save")
      .setLabel("Save")
      .setStyle(ButtonStyle.Success)
      .setDisabled(!canSave),
    new ButtonBuilder()
      .setCustomId("gp_reset")
      .setLabel("Reset")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("gp_next")
      .setLabel("Next \u25B6")
      .setStyle(ButtonStyle.Primary),
  );

  return [row1, row2, row3, row4, row5];
}

function buildPage2Components(state: GeneralPanelState) {
  const canSave = hasAnyChange(state);

  const row1 = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId("gp_clear_roles")
      .setPlaceholder(
        state.clearRoleIds.length
          ? `\u2705 ${state.clearRoleIds.length} Clear Role(s) selected`
          : "Select Clear Role (can use mse7)\u2026"
      )
      .setMinValues(0)
      .setMaxValues(10)
  );

  const row2 = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId("gp_move_roles")
      .setPlaceholder(
        state.moveRoleIds.length
          ? `\u2705 ${state.moveRoleIds.length} Move Role(s) selected`
          : "Select Move Role (can use aji)\u2026"
      )
      .setMinValues(0)
      .setMaxValues(10)
  );

  const row3 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("gp_back")
      .setLabel("\u25C0 Back")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("gp_save")
      .setLabel("Save")
      .setStyle(ButtonStyle.Success)
      .setDisabled(!canSave),
    new ButtonBuilder()
      .setCustomId("gp_reset")
      .setLabel("Reset")
      .setStyle(ButtonStyle.Danger),
  );

  return [row1, row2, row3];
}

function renderPanel(state: GeneralPanelState) {
  if (state.page === 2) {
    return { embeds: [buildPage2Embed(state)], components: buildPage2Components(state) };
  }
  return { embeds: [buildPage1Embed(state)], components: buildPage1Components(state) };
}

function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((v): v is string => typeof v === "string");
    }
  } catch {}
  return [];
}

async function loadExtraRoles(guildId: string): Promise<{ clear: string[]; move: string[] }> {
  const result = await pool.query<{ clear_role_ids_json: string | null; move_role_ids_json: string | null }>(
    "select clear_role_ids_json, move_role_ids_json from bot_config where guild_id = $1 limit 1",
    [guildId],
  );
  const row = result.rows[0];
  return {
    clear: parseJsonArray(row?.clear_role_ids_json),
    move: parseJsonArray(row?.move_role_ids_json),
  };
}

export async function openGeneralSetupPanel(interaction: ButtonInteraction) {
  const userId = interaction.user.id;

  const config = await db
    .select()
    .from(botConfigTable)
    .where(eq(botConfigTable.guildId, interaction.guild!.id))
    .limit(1);

  const row = config[0];
  let blocked: string[] = [];
  if (row?.blockedChannelsJson) {
    try { blocked = JSON.parse(row.blockedChannelsJson); } catch {}
  }

  let staffRoles: string[] = [];
  if (row?.helpRoleIdsJson) {
    try { staffRoles = JSON.parse(row.helpRoleIdsJson); } catch {}
  }

  const extra = await loadExtraRoles(interaction.guild!.id);

  const state: GeneralPanelState = {
    coreRoleId: row?.staffRoleId ?? undefined,
    blockedChannels: blocked,
    staffRoleIds: staffRoles,
    eventHosterRoleId: row?.eventHosterRoleId ?? undefined,
    clearRoleIds: extra.clear,
    moveRoleIds: extra.move,
    page: 1,
  };
  generalPanelState.set(userId, state);

  const payload = renderPanel(state);

  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(payload);
  } else {
    await interaction.reply({ ...payload, ephemeral: true });
  }
}

function getOrInitState(userId: string): GeneralPanelState {
  const existing = generalPanelState.get(userId);
  if (existing) return existing;
  const fresh = emptyState();
  generalPanelState.set(userId, fresh);
  return fresh;
}

export async function handleGeneralStaffRoleSelect(interaction: RoleSelectMenuInteraction) {
  const state = getOrInitState(interaction.user.id);
  state.coreRoleId = interaction.values[0];
  await interaction.update(renderPanel(state));
}

export async function handleGeneralHelpRolesSelect(interaction: RoleSelectMenuInteraction) {
  const state = getOrInitState(interaction.user.id);
  state.staffRoleIds = interaction.values;
  await interaction.update(renderPanel(state));
}

export async function handleGeneralEventHosterSelect(interaction: RoleSelectMenuInteraction) {
  const state = getOrInitState(interaction.user.id);
  state.eventHosterRoleId = interaction.values[0];
  await interaction.update(renderPanel(state));
}

export async function handleGeneralBlockedChSelect(interaction: ChannelSelectMenuInteraction) {
  const state = getOrInitState(interaction.user.id);
  state.blockedChannels = interaction.values;
  await interaction.update(renderPanel(state));
}

export async function handleGeneralClearRolesSelect(interaction: RoleSelectMenuInteraction) {
  const state = getOrInitState(interaction.user.id);
  state.clearRoleIds = [...new Set(interaction.values)];
  await interaction.update(renderPanel(state));
}

export async function handleGeneralMoveRolesSelect(interaction: RoleSelectMenuInteraction) {
  const state = getOrInitState(interaction.user.id);
  state.moveRoleIds = [...new Set(interaction.values)];
  await interaction.update(renderPanel(state));
}

export async function handleGeneralPanelNext(interaction: ButtonInteraction) {
  const state = getOrInitState(interaction.user.id);
  state.page = 2;
  await interaction.update(renderPanel(state));
}

export async function handleGeneralPanelBack(interaction: ButtonInteraction) {
  const state = getOrInitState(interaction.user.id);
  state.page = 1;
  await interaction.update(renderPanel(state));
}

export async function handleGeneralPanelSave(interaction: ButtonInteraction) {
  const userId = interaction.user.id;
  const state = getOrInitState(userId);
  const guildId = interaction.guild!.id;

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (state.coreRoleId) updateData.staffRoleId = state.coreRoleId;
  updateData.blockedChannelsJson = JSON.stringify(state.blockedChannels);
  updateData.helpRoleIdsJson = JSON.stringify(state.staffRoleIds);
  updateData.eventHosterRoleId = state.eventHosterRoleId ?? null;

  const existing = await db.select().from(botConfigTable).where(eq(botConfigTable.guildId, guildId)).limit(1);
  if (existing.length) {
    await db.update(botConfigTable).set(updateData as Parameters<typeof db.update>[0]).where(eq(botConfigTable.guildId, guildId));
  } else {
    await db.insert(botConfigTable).values({
      guildId,
      staffRoleId: state.coreRoleId,
      blockedChannelsJson: JSON.stringify(state.blockedChannels),
      helpRoleIdsJson: JSON.stringify(state.staffRoleIds),
      eventHosterRoleId: state.eventHosterRoleId ?? null,
    });
  }

  // Clear & Move role lists live in raw columns not in the drizzle schema.
  await pool.query(
    `insert into bot_config (guild_id, clear_role_ids_json, move_role_ids_json, updated_at)
     values ($1, $2, $3, now())
     on conflict (guild_id) do update set
       clear_role_ids_json = excluded.clear_role_ids_json,
       move_role_ids_json = excluded.move_role_ids_json,
       updated_at = now()`,
    [guildId, JSON.stringify(state.clearRoleIds), JSON.stringify(state.moveRoleIds)],
  );

  generalPanelState.delete(userId);

  const blockedList = state.blockedChannels.length
    ? state.blockedChannels.map(id => `<#${id}>`).join(", ")
    : "none";

  const staffList = state.staffRoleIds.length
    ? state.staffRoleIds.map(id => `<@&${id}>`).join(", ")
    : "everyone (no restriction)";

  const clearList = state.clearRoleIds.length
    ? state.clearRoleIds.map(id => `<@&${id}>`).join(", ")
    : "none (Admins only)";

  const moveList = state.moveRoleIds.length
    ? state.moveRoleIds.map(id => `<@&${id}>`).join(", ")
    : "none (Admins only)";

  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setColor(0x00c851)
        .setTitle("\u2705 General Setup Saved")
        .setDescription(
          `**Core Role** \u2014 ${state.coreRoleId ? `<@&${state.coreRoleId}>` : "not set"}\n` +
          `**Staff Role** \u2014 ${staffList}\n` +
          `**Event Hoster Role** \u2014 ${state.eventHosterRoleId ? `<@&${state.eventHosterRoleId}>` : "not set"}\n` +
          `**Blocked Channels** \u2014 ${blockedList}\n` +
          `**Clear Role (mse7)** \u2014 ${clearList}\n` +
          `**Move Role (aji)** \u2014 ${moveList}`
        )
        .setFooter({ text: "Night Stars \u2022 General Setup" }),
    ],
    components: [],
  });
}

export async function handleGeneralPanelReset(interaction: ButtonInteraction) {
  const state = emptyState();
  generalPanelState.set(interaction.user.id, state);
  await interaction.update(renderPanel(state));
}

export async function isChannelBlocked(guildId: string, channelId: string): Promise<boolean> {
  const [cfg] = await db
    .select({ blockedChannelsJson: botConfigTable.blockedChannelsJson })
    .from(botConfigTable)
    .where(eq(botConfigTable.guildId, guildId))
    .limit(1);
  if (!cfg?.blockedChannelsJson) return false;
  try {
    const list = JSON.parse(cfg.blockedChannelsJson) as string[];
    return list.includes(channelId);
  } catch { return false; }
}

export async function getHelpRoleIds(guildId: string): Promise<string[]> {
  const [cfg] = await db
    .select()
    .from(botConfigTable)
    .where(eq(botConfigTable.guildId, guildId))
    .limit(1);
  if (!cfg?.helpRoleIdsJson) return [];
  try { return JSON.parse(cfg.helpRoleIdsJson) as string[]; } catch { return []; }
}

export async function getStaffRoleId(guildId: string): Promise<string | null> {
  const [cfg] = await db
    .select({ staffRoleId: botConfigTable.staffRoleId })
    .from(botConfigTable)
    .where(eq(botConfigTable.guildId, guildId))
    .limit(1);
  return cfg?.staffRoleId ?? null;
}
