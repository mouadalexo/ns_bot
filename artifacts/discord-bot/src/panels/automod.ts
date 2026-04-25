import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelSelectMenuInteraction,
  ChannelType,
  ChatInputCommandInteraction,
  EmbedBuilder,
  ModalBuilder,
  ModalSubmitInteraction,
  RoleSelectMenuBuilder,
  RoleSelectMenuInteraction,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";

import {
  AutoModConfig,
  AutoResponse,
  createAutoResponse,
  deleteAutoResponse,
  DEFAULT_LINK_WHITELIST,
  getAutoModConfig,
  getAutoResponse,
  invalidateAutoModCache,
  listAutoResponses,
  setAutoModField,
  updateAutoResponse,
} from "../modules/auto-mod/index.js";

const COLOR = 0x5000ff;
const SUCCESS = 0x00c851;

// ---------------------------------------------------------------------------
// Per-user panel state
// ---------------------------------------------------------------------------

type View =
  | "root"
  | "config"
  | "links"
  | "spam"
  | "longmsg"
  | "imgonly"
  | "linkonly"
  | "ignored"
  | "responses"
  | "response_edit"
  | "autodelete"
  | "logs";

type State = {
  view: View;
  editingResponseId?: number;
  message?: {
    channelId: string;
    messageId: string;
  };
};

const panelState = new Map<string, State>();

function getState(userId: string): State {
  return panelState.get(userId) ?? { view: "root" };
}

function setState(userId: string, s: State) {
  panelState.set(userId, s);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusBadge(on: boolean): string {
  return on ? "🟢 Enabled" : "🔴 Disabled";
}

function formatList(items: string[], render: (s: string) => string, empty = "_none_"): string {
  if (!items.length) return empty;
  return items.map(render).join(", ");
}

function formatChannels(ids: string[]): string {
  return formatList(ids, (id) => `<#${id}>`);
}

function formatRoles(ids: string[]): string {
  return formatList(ids, (id) => `<@&${id}>`);
}

function trimList(items: string[], max = 12): string {
  if (items.length <= max) return items.join(", ");
  return items.slice(0, max).join(", ") + `, +${items.length - max} more`;
}

// ---------------------------------------------------------------------------
// Root view
// ---------------------------------------------------------------------------

function buildRootEmbed() {
  return new EmbedBuilder()
    .setColor(COLOR)
    .setTitle("🛡️  Auto-Mod  ·  Setup")
    .setDescription(
      "**Welcome to the Auto-Mod control panel.**\n" +
        "Pick a section below to **set things up**. Every change is saved instantly.\n\n" +
        "▸ Tap **View Configuration** at the bottom whenever you want to see the current settings.",
    )
    .addFields(
      {
        name: "▸ Protection",
        value:
          "🔗  **Anti-Link**  —  block links not on the whitelist\n" +
          "⚡  **Anti-Spam**  —  burst rule + 300-char rule\n" +
          "🖼️  **Image-Only**  —  enforce images in channels\n" +
          "🔗  **Link-Only**  —  enforce links in channels",
        inline: false,
      },
      {
        name: "▸ Customisation",
        value:
          "💬  **Auto-Responses**  —  trigger phrases & replies\n" +
          "🧹  **Auto-Delete**  —  word-block & per-channel rules\n" +
          "🛡️  **Bypass Roles**  —  exempt staff from auto-mod\n" +
          "📋  **Logs**  —  record every action to a channel",
        inline: false,
      },
    )
    .setFooter({ text: "Night Stars  •  Auto-Mod  •  Setup" });
}

function buildRootRows(): ActionRowBuilder<ButtonBuilder>[] {
  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("am_open_links").setLabel("Anti-Link").setEmoji("🔗").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("am_open_spam").setLabel("Anti-Spam").setEmoji("⚡").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("am_open_imgonly").setLabel("Image-Only").setEmoji("🖼️").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("am_open_linkonly").setLabel("Link-Only").setEmoji("🔗").setStyle(ButtonStyle.Primary),
  );
  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("am_open_responses").setLabel("Auto-Responses").setEmoji("💬").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("am_open_autodelete").setLabel("Auto-Delete").setEmoji("🧹").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("am_open_ignored").setLabel("Bypass Roles").setEmoji("🛡️").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("am_open_logs").setLabel("Logs").setEmoji("📋").setStyle(ButtonStyle.Secondary),
  );
  const row3 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("am_open_config").setLabel("View Configuration").setEmoji("📖").setStyle(ButtonStyle.Success),
  );
  return [row1, row2, row3];
}

async function renderRoot(interaction: any) {
  setState(interaction.user.id, { view: "root" });
  const payload = {
    embeds: [buildRootEmbed()],
    components: buildRootRows(),
  };
  await replyOrUpdate(interaction, payload);
}

// ---------------------------------------------------------------------------
// Configuration view (read-only, prettified)
// ---------------------------------------------------------------------------

const DIVIDER = "━━━━━━━━━━━━━━━━━━━━━━━━━━━";

function fmtBool(b: boolean): string {
  return b ? "🟢  **Enabled**" : "⚪  *Disabled*";
}

function bullet(label: string, value: string): string {
  return `\u2003•  **${label}** \u2003·\u2003 ${value}`;
}

function listOrNone(items: string[], formatter: (id: string) => string, max = 10): string {
  if (items.length === 0) return "_— none —_";
  const shown = items.slice(0, max).map(formatter).join(", ");
  const extra = items.length > max ? `,  *+${items.length - max} more*` : "";
  return shown + extra;
}

function buildConfigEmbed(cfg: AutoModConfig, responseCount: number) {
  const linkSection =
    `${fmtBool(cfg.linksEnabled)}\n` +
    bullet("Whitelist", `\`${cfg.linksWhitelist.length}\` domain${cfg.linksWhitelist.length === 1 ? "" : "s"}`) + "\n" +
    bullet("Bypass roles", listOrNone(cfg.linksIgnoredRoleIds, (id) => `<@&${id}>`));

  const spamSection =
    `${fmtBool(cfg.spamEnabled)}  ·  burst rule (5 msgs / 5 s)\n` +
    `${fmtBool(cfg.longMsgEnabled)}  ·  long-message rule (max **300** chars / **5** line breaks)\n` +
    bullet("First offense", "delete") + "\n" +
    bullet("Repeat offense", "10-minute timeout") + "\n" +
    bullet("Burst — ignored categories", listOrNone(cfg.spamIgnoredCategoryIds, (id) => `<#${id}>`)) + "\n" +
    bullet("Long-msg — ignored categories", listOrNone(cfg.longMsgIgnoredCategoryIds, (id) => `<#${id}>`)) + "\n" +
    bullet("Long-msg — ignored channels", listOrNone(cfg.longMsgIgnoredChannelIds, (id) => `<#${id}>`)) + "\n" +
    bullet("Long-msg — ignored roles", listOrNone(cfg.longMsgIgnoredRoleIds, (id) => `<@&${id}>`));

  const imgSection = cfg.imageOnlyChannelIds.length
    ? cfg.imageOnlyChannelIds.map((id) => `\u2003•  <#${id}>`).join("\n")
    : "_— none configured —_";

  const linkOnlySection = cfg.linkOnlyChannelIds.length
    ? cfg.linkOnlyChannelIds.map((id) => `\u2003•  <#${id}>`).join("\n")
    : "_— none configured —_";

  const bypassSection = cfg.ignoredRoleIds.length
    ? cfg.ignoredRoleIds.map((id) => `\u2003•  <@&${id}>`).join("\n")
    : "_— none —_";

  const logsLine = cfg.logsChannelId
    ? `<#${cfg.logsChannelId}>`
    : "_— not set, moderation actions are **not** being recorded —_";

  return new EmbedBuilder()
    .setColor(COLOR)
    .setTitle("📖  Auto-Mod  ·  Current Configuration")
    .setDescription(
      `${DIVIDER}\n` +
        `**A snapshot of every Auto-Mod setting on this server.**\n` +
        `Use the buttons on the setup panel to make changes.\n` +
        `${DIVIDER}`,
    )
    .addFields(
      { name: "🔗  ANTI-LINK", value: linkSection, inline: false },
      { name: "\u200b", value: DIVIDER, inline: false },
      { name: "⚡  ANTI-SPAM", value: spamSection, inline: false },
      { name: "\u200b", value: DIVIDER, inline: false },
      {
        name: `🖼️  IMAGE-ONLY CHANNELS  ·  ${cfg.imageOnlyChannelIds.length}`,
        value: imgSection,
        inline: false,
      },
      {
        name: `🔗  LINK-ONLY CHANNELS  ·  ${cfg.linkOnlyChannelIds.length}`,
        value: linkOnlySection,
        inline: false,
      },
      { name: "\u200b", value: DIVIDER, inline: false },
      {
        name: `💬  AUTO-RESPONSES  ·  ${responseCount}`,
        value:
          responseCount === 0
            ? "_— none configured —_"
            : `\`${responseCount}\` trigger${responseCount === 1 ? "" : "s"} configured.  Open the **Auto-Responses** section for details.`,
        inline: false,
      },
      { name: "\u200b", value: DIVIDER, inline: false },
      { name: "🛡️  SERVER-WIDE BYPASS ROLES", value: bypassSection, inline: false },
      { name: "📋  LOGS CHANNEL", value: logsLine, inline: false },
    )
    .setFooter({ text: "Night Stars  •  Auto-Mod  •  Configuration snapshot" });
}

function buildConfigRows(): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("am_open_root").setLabel("← Back to Setup").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("am_open_config").setLabel("Refresh").setEmoji("🔄").setStyle(ButtonStyle.Primary),
    ),
  ];
}

async function renderConfig(interaction: any) {
  const guildId = interaction.guild!.id;
  const [cfg, responses] = await Promise.all([getAutoModConfig(guildId), listAutoResponses(guildId)]);
  setState(interaction.user.id, { view: "config" });
  await replyOrUpdate(interaction, {
    embeds: [buildConfigEmbed(cfg, responses.length)],
    components: buildConfigRows(),
  });
}

// ---------------------------------------------------------------------------
// Links view
// ---------------------------------------------------------------------------

function buildLinksEmbed(cfg: AutoModConfig) {
  return new EmbedBuilder()
    .setColor(COLOR)
    .setTitle("🔗 Anti-Link")
    .setDescription(
      "Block links that aren't on the whitelist. Members with bypass roles, " +
        "and members with the server-wide bypass roles, are not affected.",
    )
    .addFields(
      { name: "Status", value: statusBadge(cfg.linksEnabled), inline: true },
      {
        name: `Whitelist (${cfg.linksWhitelist.length})`,
        value: cfg.linksWhitelist.length
          ? "```\n" + trimList(cfg.linksWhitelist, 25) + "\n```"
          : "_empty — every link is blocked when enabled_",
        inline: false,
      },
      {
        name: "Bypass roles",
        value: cfg.linksIgnoredRoleIds.length ? formatRoles(cfg.linksIgnoredRoleIds) : "_none_",
        inline: false,
      },
    )
    .setFooter({ text: "Night Stars • Auto-Mod / Anti-Link" });
}

function buildLinksRows(cfg: AutoModConfig) {
  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("am_links_toggle")
      .setLabel(cfg.linksEnabled ? "Disable" : "Enable")
      .setStyle(cfg.linksEnabled ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder().setCustomId("am_links_wl_edit").setLabel("Edit Whitelist").setStyle(ButtonStyle.Primary),
  );
  const row2 = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId("am_links_roles")
      .setPlaceholder(cfg.linksIgnoredRoleIds.length ? "Bypass roles (set)" : "Select bypass roles…")
      .setMinValues(0)
      .setMaxValues(20),
  );
  const row3 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("am_open_root").setLabel("← Back").setStyle(ButtonStyle.Secondary),
  );
  return [row1, row2, row3];
}

async function renderLinks(interaction: any) {
  const cfg = await getAutoModConfig(interaction.guild!.id);
  setState(interaction.user.id, { view: "links" });
  await replyOrUpdate(interaction, {
    embeds: [buildLinksEmbed(cfg)],
    components: buildLinksRows(cfg),
  });
}

// ---------------------------------------------------------------------------
// Spam view
// ---------------------------------------------------------------------------

function buildSpamEmbed(cfg: AutoModConfig) {
  return new EmbedBuilder()
    .setColor(COLOR)
    .setTitle("⚡  Anti-Spam")
    .setDescription(
      "**Two independent rules** — toggle each one separately.\n\n" +
        "▸ **Burst rule** — 5 messages within 5 seconds.\n" +
        "▸ **Long-message rule** — single message over **300 characters** *or* **5 line breaks**.\n\n" +
        "**1st offense** → message(s) deleted.\n" +
        "**Repeat offense** → 10-minute timeout.\n\n" +
        "Admins and members with server-wide bypass roles are exempt.\n" +
        "Use **Long-Message Settings** to manage its own ignored categories, channels, and roles.",
    )
    .addFields(
      { name: "Burst rule (5 / 5s)", value: statusBadge(cfg.spamEnabled), inline: true },
      { name: "Long-message rule (>300 chars / >5 line breaks)", value: statusBadge(cfg.longMsgEnabled), inline: true },
      {
        name: "Burst rule — ignored categories",
        value: cfg.spamIgnoredCategoryIds.length ? formatChannels(cfg.spamIgnoredCategoryIds) : "_none_",
        inline: false,
      },
    )
    .setFooter({ text: "Night Stars  •  Auto-Mod  /  Anti-Spam" });
}

function buildSpamRows(cfg: AutoModConfig) {
  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("am_spam_toggle")
      .setLabel(cfg.spamEnabled ? "Disable Burst Rule" : "Enable Burst Rule")
      .setEmoji("⚡")
      .setStyle(cfg.spamEnabled ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("am_longmsg_toggle")
      .setLabel(cfg.longMsgEnabled ? "Disable Long-Msg Rule" : "Enable Long-Msg Rule")
      .setEmoji("📏")
      .setStyle(cfg.longMsgEnabled ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("am_open_longmsg")
      .setLabel("Long-Msg Settings")
      .setEmoji("⚙️")
      .setStyle(ButtonStyle.Secondary),
  );
  const row2 = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("am_spam_cats")
      .setPlaceholder(cfg.spamIgnoredCategoryIds.length ? "Burst rule ignored categories (replace selection)" : "Burst rule — select categories to ignore…")
      .addChannelTypes(ChannelType.GuildCategory)
      .setMinValues(0)
      .setMaxValues(15),
  );
  const row3 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("am_open_root").setLabel("← Back").setStyle(ButtonStyle.Secondary),
  );
  return [row1, row2, row3];
}

async function renderSpam(interaction: any) {
  const cfg = await getAutoModConfig(interaction.guild!.id);
  setState(interaction.user.id, { view: "spam" });
  await replyOrUpdate(interaction, {
    embeds: [buildSpamEmbed(cfg)],
    components: buildSpamRows(cfg),
  });
}

// ---------------------------------------------------------------------------
// Long-Message sub-view (per-rule ignored category / channel / role)
// ---------------------------------------------------------------------------

function buildLongMsgEmbed(cfg: AutoModConfig) {
  return new EmbedBuilder()
    .setColor(COLOR)
    .setTitle("📏  Long-Message Rule")
    .setDescription(
      "Removes any single message over **300 characters** *or* **5 line breaks**.\n\n" +
        "**1st offense** → message deleted.\n" +
        "**Repeat offense** → 10-minute timeout.\n\n" +
        "Use the selectors below to add per-rule exceptions. " +
        "These bypasses are **separate** from the global Auto-Mod bypass and from the burst-rule list.",
    )
    .addFields(
      { name: "Status", value: statusBadge(cfg.longMsgEnabled), inline: true },
      { name: "Limits", value: "`300 chars` · `5 line breaks`", inline: true },
      {
        name: "Ignored categories",
        value: cfg.longMsgIgnoredCategoryIds.length ? formatChannels(cfg.longMsgIgnoredCategoryIds) : "_none_",
        inline: false,
      },
      {
        name: "Ignored channels",
        value: cfg.longMsgIgnoredChannelIds.length ? formatChannels(cfg.longMsgIgnoredChannelIds) : "_none_",
        inline: false,
      },
      {
        name: "Ignored roles",
        value: cfg.longMsgIgnoredRoleIds.length ? formatRoles(cfg.longMsgIgnoredRoleIds) : "_none_",
        inline: false,
      },
    )
    .setFooter({ text: "Night Stars  •  Auto-Mod  /  Long-Message" });
}

function buildLongMsgRows(cfg: AutoModConfig) {
  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("am_longmsg_toggle")
      .setLabel(cfg.longMsgEnabled ? "Disable Rule" : "Enable Rule")
      .setEmoji("📏")
      .setStyle(cfg.longMsgEnabled ? ButtonStyle.Danger : ButtonStyle.Success),
  );
  const row2 = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("am_longmsg_cats")
      .setPlaceholder(cfg.longMsgIgnoredCategoryIds.length ? "Ignored categories (replace selection)" : "Select ignored categories…")
      .addChannelTypes(ChannelType.GuildCategory)
      .setMinValues(0)
      .setMaxValues(15),
  );
  const row3 = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("am_longmsg_channels")
      .setPlaceholder(cfg.longMsgIgnoredChannelIds.length ? "Ignored channels (replace selection)" : "Select ignored channels…")
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.PublicThread, ChannelType.PrivateThread)
      .setMinValues(0)
      .setMaxValues(20),
  );
  const row4 = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId("am_longmsg_roles")
      .setPlaceholder(cfg.longMsgIgnoredRoleIds.length ? "Ignored roles (replace selection)" : "Select ignored roles…")
      .setMinValues(0)
      .setMaxValues(15),
  );
  const row5 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("am_open_spam").setLabel("← Back to Anti-Spam").setStyle(ButtonStyle.Secondary),
  );
  return [row1, row2, row3, row4, row5];
}

async function renderLongMsg(interaction: any) {
  const cfg = await getAutoModConfig(interaction.guild!.id);
  setState(interaction.user.id, { view: "longmsg" });
  await replyOrUpdate(interaction, {
    embeds: [buildLongMsgEmbed(cfg)],
    components: buildLongMsgRows(cfg),
  });
}

// ---------------------------------------------------------------------------
// Image-Only view
// ---------------------------------------------------------------------------

function buildImgOnlyEmbed(cfg: AutoModConfig, interaction: any) {
  const lines = cfg.imageOnlyChannelIds.length
    ? cfg.imageOnlyChannelIds
        .map((id, i) => {
          const name = interaction.guild?.channels.cache.get(id)?.name;
          return `\`${String(i + 1).padStart(2, " ")}.\`  <#${id}>${name ? `  *(#${name})*` : ""}`;
        })
        .join("\n")
    : "_— none configured yet —_";

  return new EmbedBuilder()
    .setColor(COLOR)
    .setTitle("🖼️  Image-Only Channels")
    .setDescription(
      "In these channels every message must contain an **image attachment** or an **embedded image**. " +
        "Plain-text messages are deleted with a private warning.\n\n" +
        "▸ Use **Add a channel** to add channels **one at a time** — the existing list is preserved.\n" +
        "▸ Use **Remove a channel** to take a single channel off the list.\n" +
        "▸ Use **Clear all** to wipe the entire list.",
    )
    .addFields({
      name: `Active channels  ·  ${cfg.imageOnlyChannelIds.length}`,
      value: lines,
      inline: false,
    })
    .setFooter({ text: "Night Stars  •  Auto-Mod  /  Image-Only" });
}

function buildImgOnlyRows(cfg: AutoModConfig, interaction: any) {
  const rows: ActionRowBuilder<any>[] = [];

  rows.push(
    new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId("am_imgonly_add")
        .setPlaceholder("➕  Add a channel (search by name)…")
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMinValues(1)
        .setMaxValues(1),
    ),
  );

  if (cfg.imageOnlyChannelIds.length > 0) {
    const opts = cfg.imageOnlyChannelIds.slice(0, 25).map((id) => {
      const name = interaction.guild?.channels.cache.get(id)?.name ?? id;
      return { label: `#${name}`.slice(0, 100), value: id, description: id };
    });
    rows.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("am_imgonly_remove")
          .setPlaceholder("➖  Remove a channel from the list…")
          .addOptions(opts),
      ),
    );
  }

  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("am_open_root").setLabel("← Back").setStyle(ButtonStyle.Secondary),
  );
  if (cfg.imageOnlyChannelIds.length > 0) {
    buttons.addComponents(
      new ButtonBuilder().setCustomId("am_imgonly_clear").setLabel("Clear all").setEmoji("🗑️").setStyle(ButtonStyle.Danger),
    );
  }
  rows.push(buttons);

  return rows;
}

async function renderImgOnly(interaction: any) {
  const cfg = await getAutoModConfig(interaction.guild!.id);
  setState(interaction.user.id, { view: "imgonly" });
  await replyOrUpdate(interaction, {
    embeds: [buildImgOnlyEmbed(cfg, interaction)],
    components: buildImgOnlyRows(cfg, interaction),
  });
}

// ---------------------------------------------------------------------------
// Link-Only view
// ---------------------------------------------------------------------------

function buildLinkOnlyEmbed(cfg: AutoModConfig, interaction: any) {
  const lines = cfg.linkOnlyChannelIds.length
    ? cfg.linkOnlyChannelIds
        .map((id, i) => {
          const name = interaction.guild?.channels.cache.get(id)?.name;
          return `\`${String(i + 1).padStart(2, " ")}.\`  <#${id}>${name ? `  *(#${name})*` : ""}`;
        })
        .join("\n")
    : "_— none configured yet —_";

  return new EmbedBuilder()
    .setColor(COLOR)
    .setTitle("🔗  Link-Only Channels")
    .setDescription(
      "In these channels every message must contain **at least one link**. " +
        "Plain-text messages are deleted with a private warning.\n\n" +
        "▸ Use **Add a channel** to add channels **one at a time** — the existing list is preserved.\n" +
        "▸ Use **Remove a channel** to take a single channel off the list.\n" +
        "▸ Use **Clear all** to wipe the entire list.",
    )
    .addFields({
      name: `Active channels  ·  ${cfg.linkOnlyChannelIds.length}`,
      value: lines,
      inline: false,
    })
    .setFooter({ text: "Night Stars  •  Auto-Mod  /  Link-Only" });
}

function buildLinkOnlyRows(cfg: AutoModConfig, interaction: any) {
  const rows: ActionRowBuilder<any>[] = [];

  rows.push(
    new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId("am_linkonly_add")
        .setPlaceholder("➕  Add a channel (search by name)…")
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMinValues(1)
        .setMaxValues(1),
    ),
  );

  if (cfg.linkOnlyChannelIds.length > 0) {
    const opts = cfg.linkOnlyChannelIds.slice(0, 25).map((id) => {
      const name = interaction.guild?.channels.cache.get(id)?.name ?? id;
      return { label: `#${name}`.slice(0, 100), value: id, description: id };
    });
    rows.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("am_linkonly_remove")
          .setPlaceholder("➖  Remove a channel from the list…")
          .addOptions(opts),
      ),
    );
  }

  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("am_open_root").setLabel("← Back").setStyle(ButtonStyle.Secondary),
  );
  if (cfg.linkOnlyChannelIds.length > 0) {
    buttons.addComponents(
      new ButtonBuilder().setCustomId("am_linkonly_clear").setLabel("Clear all").setEmoji("🗑️").setStyle(ButtonStyle.Danger),
    );
  }
  rows.push(buttons);

  return rows;
}

async function renderLinkOnly(interaction: any) {
  const cfg = await getAutoModConfig(interaction.guild!.id);
  setState(interaction.user.id, { view: "linkonly" });
  await replyOrUpdate(interaction, {
    embeds: [buildLinkOnlyEmbed(cfg, interaction)],
    components: buildLinkOnlyRows(cfg, interaction),
  });
}

// ---------------------------------------------------------------------------
// Ignored Roles view
// ---------------------------------------------------------------------------

function buildIgnoredEmbed(cfg: AutoModConfig) {
  return new EmbedBuilder()
    .setColor(COLOR)
    .setTitle("🛡️ Server-Wide Bypass Roles")
    .setDescription(
      "Members with any of these roles are exempt from **all** auto-mod features:\n" +
        "anti-link, anti-spam, image-only and link-only channels.",
    )
    .addFields({
      name: "Bypass roles",
      value: cfg.ignoredRoleIds.length ? formatRoles(cfg.ignoredRoleIds) : "_none_",
      inline: false,
    })
    .setFooter({ text: "Night Stars • Auto-Mod / Bypass Roles" });
}

function buildIgnoredRows(cfg: AutoModConfig) {
  const row1 = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId("am_ignored_roles")
      .setPlaceholder(cfg.ignoredRoleIds.length ? "Bypass roles (set)" : "Select bypass roles…")
      .setMinValues(0)
      .setMaxValues(20),
  );
  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("am_open_root").setLabel("← Back").setStyle(ButtonStyle.Secondary),
  );
  return [row1, row2];
}

async function renderIgnored(interaction: any) {
  const cfg = await getAutoModConfig(interaction.guild!.id);
  setState(interaction.user.id, { view: "ignored" });
  await replyOrUpdate(interaction, {
    embeds: [buildIgnoredEmbed(cfg)],
    components: buildIgnoredRows(cfg),
  });
}

// ---------------------------------------------------------------------------
// Auto-Delete pointer view (existing /auto-delete panel keeps its own UI)
// ---------------------------------------------------------------------------

function buildAutoDeleteEmbed() {
  return new EmbedBuilder()
    .setColor(COLOR)
    .setTitle("🧹 Auto-Delete")
    .setDescription(
      "Auto-Delete handles word-block lists and per-channel content rules " +
        "(e.g. delete messages with images in #general, delete attachments in #voice-chat).\n\n" +
        "It has its own dedicated panel — use `/auto-delete` to open it.",
    )
    .setFooter({ text: "Night Stars • Auto-Mod / Auto-Delete" });
}

function buildAutoDeleteRows() {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("am_open_root").setLabel("← Back").setStyle(ButtonStyle.Secondary),
  );
  return [row];
}

async function renderAutoDelete(interaction: any) {
  setState(interaction.user.id, { view: "autodelete" });
  await replyOrUpdate(interaction, {
    embeds: [buildAutoDeleteEmbed()],
    components: buildAutoDeleteRows(),
  });
}

// ---------------------------------------------------------------------------
// Logs view
// ---------------------------------------------------------------------------

function buildLogsEmbed(cfg: AutoModConfig) {
  return new EmbedBuilder()
    .setColor(COLOR)
    .setTitle("📋 Mod-Action Logs")
    .setDescription(
      "Pick a text channel where every Auto-Mod action will be recorded as an embed. " +
        "Logged events: link removed, image-only / link-only deletions, spam burst removed, " +
        "spam timeouts, and auto-response triggers.",
    )
    .addFields({
      name: "Current Logs Channel",
      value: cfg.logsChannelId ? `<#${cfg.logsChannelId}>` : "_not set_",
      inline: false,
    })
    .setFooter({ text: "Night Stars • Auto-Mod / Logs" });
}

function buildLogsRows() {
  const rowSelect = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("am_logs_channel")
      .setPlaceholder("Select logs channel…")
      .addChannelTypes(ChannelType.GuildText)
      .setMinValues(1)
      .setMaxValues(1),
  );
  const rowButtons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("am_logs_clear").setLabel("Clear").setEmoji("🗑️").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("am_back_root").setLabel("Back").setStyle(ButtonStyle.Secondary),
  );
  return [rowSelect, rowButtons];
}

async function renderLogs(interaction: any) {
  setState(interaction.user.id, { view: "logs" });
  const cfg = await getAutoModConfig(interaction.guild!.id);
  await replyOrUpdate(interaction, {
    embeds: [buildLogsEmbed(cfg)],
    components: buildLogsRows(),
  });
}

// ---------------------------------------------------------------------------
// Auto-Responses list view
// ---------------------------------------------------------------------------

function buildResponsesListEmbed(responses: AutoResponse[]) {
  const desc = responses.length
    ? responses
        .slice(0, 25)
        .map((r) => {
          const status = r.enabled ? "🟢" : "⚪";
          const matchTag = r.matchType === "exact" ? "=" : r.matchType === "starts_with" ? "→" : "∋";
          return `${status} \`${matchTag}\` **${r.triggerText}** — ${r.responseText.slice(0, 60)}${r.responseText.length > 60 ? "…" : ""}`;
        })
        .join("\n")
    : "_no auto-responses configured yet_";
  return new EmbedBuilder()
    .setColor(COLOR)
    .setTitle("💬 Auto-Responses")
    .setDescription(
      "Trigger phrases that the bot replies to. Each response has its own allowed roles and channels. " +
        "Use `;emoji_name` to insert a server emoji and `{user}` to mention the sender.",
    )
    .addFields({ name: `Configured (${responses.length})`, value: desc.slice(0, 1024), inline: false })
    .setFooter({ text: "Night Stars • Auto-Mod / Auto-Responses" });
}

function buildResponsesListRows(responses: AutoResponse[]) {
  const rows: ActionRowBuilder<any>[] = [];

  if (responses.length > 0) {
    const opts = responses.slice(0, 25).map((r) => ({
      label: r.triggerText.slice(0, 80) || "(empty)",
      value: String(r.id),
      description: (r.responseText || "").slice(0, 90),
      emoji: r.enabled ? "🟢" : "⚪",
    }));
    rows.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("am_resp_pick")
          .setPlaceholder("Edit an auto-response…")
          .addOptions(opts),
      ),
    );
  }

  rows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("am_resp_new").setLabel("Add new").setEmoji("➕").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("am_open_root").setLabel("← Back").setStyle(ButtonStyle.Secondary),
    ),
  );

  return rows;
}

async function renderResponses(interaction: any) {
  const list = await listAutoResponses(interaction.guild!.id);
  setState(interaction.user.id, { view: "responses" });
  await replyOrUpdate(interaction, {
    embeds: [buildResponsesListEmbed(list)],
    components: buildResponsesListRows(list),
  });
}

// ---------------------------------------------------------------------------
// Auto-Response edit view
// ---------------------------------------------------------------------------

function buildResponseEditEmbed(r: AutoResponse) {
  const matchLabel =
    r.matchType === "exact" ? "Exact match" : r.matchType === "starts_with" ? "Starts with" : "Contains";
  return new EmbedBuilder()
    .setColor(COLOR)
    .setTitle("💬 Edit Auto-Response")
    .addFields(
      { name: "Status", value: r.enabled ? "🟢 Enabled" : "⚪ Disabled", inline: true },
      { name: "Match type", value: matchLabel, inline: true },
      { name: "Cooldown", value: r.cooldownSeconds > 0 ? `${r.cooldownSeconds}s per user` : "_none_", inline: true },
      { name: "Trigger", value: "```\n" + (r.triggerText || "(empty)") + "\n```", inline: false },
      { name: "Response", value: r.responseText.slice(0, 1024) || "_empty_", inline: false },
      {
        name: "Allowed roles",
        value: r.enabledRoleIds.length ? formatRoles(r.enabledRoleIds) : "_anyone_",
        inline: false,
      },
      {
        name: "Allowed channels",
        value: r.allowedChannelIds.length ? formatChannels(r.allowedChannelIds) : "_all channels_",
        inline: false,
      },
    )
    .setFooter({ text: "Night Stars • Auto-Mod / Response Editor" });
}

function buildResponseEditRows(r: AutoResponse) {
  const id = r.id;
  const row1 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`am_resp_match_${id}`)
      .setPlaceholder("Match type…")
      .addOptions(
        { label: "Contains (default)", value: "contains", default: r.matchType === "contains" },
        { label: "Exact match", value: "exact", default: r.matchType === "exact" },
        { label: "Starts with", value: "starts_with", default: r.matchType === "starts_with" },
      ),
  );
  const row2 = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId(`am_resp_roles_${id}`)
      .setPlaceholder(r.enabledRoleIds.length ? "Allowed roles (set)" : "Allowed roles (empty = anyone)")
      .setMinValues(0)
      .setMaxValues(20),
  );
  const row3 = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId(`am_resp_chs_${id}`)
      .setPlaceholder(r.allowedChannelIds.length ? "Allowed channels (set)" : "Allowed channels (empty = all)")
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setMinValues(0)
      .setMaxValues(20),
  );
  const row4 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`am_resp_text_${id}`).setLabel("Edit Trigger / Reply").setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`am_resp_toggle_${id}`)
      .setLabel(r.enabled ? "Disable" : "Enable")
      .setStyle(r.enabled ? ButtonStyle.Secondary : ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`am_resp_delete_${id}`).setLabel("Delete").setStyle(ButtonStyle.Danger),
  );
  const row5 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("am_open_responses").setLabel("← Back to list").setStyle(ButtonStyle.Secondary),
  );
  return [row1, row2, row3, row4, row5];
}

async function renderResponseEdit(interaction: any, id: number) {
  const r = await getAutoResponse(id);
  if (!r) {
    await renderResponses(interaction);
    return;
  }
  setState(interaction.user.id, { view: "response_edit", editingResponseId: id });
  await replyOrUpdate(interaction, {
    embeds: [buildResponseEditEmbed(r)],
    components: buildResponseEditRows(r),
  });
}

// ---------------------------------------------------------------------------
// Modals
// ---------------------------------------------------------------------------

function openWhitelistModal(cfg: AutoModConfig, interaction: ButtonInteraction) {
  const current = cfg.linksWhitelist.join("\n");
  const placeholder = DEFAULT_LINK_WHITELIST.slice(0, 8).join("\n");
  const modal = new ModalBuilder().setCustomId("am_links_wl_modal").setTitle("Edit Link Whitelist");
  const input = new TextInputBuilder()
    .setCustomId("am_links_wl_value")
    .setLabel("One entry per line (host or host/path)")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(4000)
    .setPlaceholder(placeholder)
    .setValue(current.slice(0, 4000));
  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
  return interaction.showModal(modal);
}

function openResponseTextModal(r: AutoResponse | null, interaction: ButtonInteraction) {
  const id = r?.id ?? "new";
  const modal = new ModalBuilder()
    .setCustomId(`am_resp_text_modal_${id}`)
    .setTitle(r ? "Edit Auto-Response" : "New Auto-Response");
  const trigger = new TextInputBuilder()
    .setCustomId("am_resp_trigger")
    .setLabel("Trigger phrase")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(200)
    .setValue(r?.triggerText ?? "");
  const reply = new TextInputBuilder()
    .setCustomId("am_resp_reply")
    .setLabel("Reply (use ;emoji_name and {user})")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(2000)
    .setValue(r?.responseText ?? "");
  const cooldown = new TextInputBuilder()
    .setCustomId("am_resp_cooldown")
    .setLabel("Per-user cooldown in seconds (optional)")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(5)
    .setValue(r ? String(r.cooldownSeconds ?? 0) : "0");
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(trigger),
    new ActionRowBuilder<TextInputBuilder>().addComponents(reply),
    new ActionRowBuilder<TextInputBuilder>().addComponents(cooldown),
  );
  return interaction.showModal(modal);
}

// ---------------------------------------------------------------------------
// Reply / update helper — works for slash command, button, select & modal
// ---------------------------------------------------------------------------

async function replyOrUpdate(interaction: any, payload: any) {
  if (interaction.isButton?.() || interaction.isAnySelectMenu?.() || interaction.isStringSelectMenu?.() || interaction.isRoleSelectMenu?.() || interaction.isChannelSelectMenu?.()) {
    if (interaction.deferred || interaction.replied) {
      return interaction.editReply(payload);
    }
    return interaction.update(payload);
  }
  if (interaction.isModalSubmit?.()) {
    if (interaction.deferred || interaction.replied) {
      return interaction.editReply(payload);
    }
    return interaction.update(payload);
  }
  // ChatInput / fallback
  if (interaction.deferred || interaction.replied) {
    return interaction.editReply(payload);
  }
  return interaction.reply({ ...payload, ephemeral: true });
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

export async function openAutoModPanel(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
) {
  await renderRoot(interaction);
}

// ---------------------------------------------------------------------------
// Dispatchers — called from panels/index.ts
// ---------------------------------------------------------------------------

export function isAutoModButton(customId: string): boolean {
  return customId.startsWith("am_");
}

export function isAutoModSelect(customId: string): boolean {
  return customId.startsWith("am_");
}

export function isAutoModModal(customId: string): boolean {
  return customId.startsWith("am_");
}

export async function handleAutoModButton(interaction: ButtonInteraction) {
  const id = interaction.customId;
  const guildId = interaction.guild!.id;

  // Navigation
  if (id === "am_open_root") return renderRoot(interaction);
  if (id === "am_open_links") return renderLinks(interaction);
  if (id === "am_open_spam") return renderSpam(interaction);
  if (id === "am_open_longmsg") return renderLongMsg(interaction);
  if (id === "am_open_imgonly") return renderImgOnly(interaction);
  if (id === "am_open_linkonly") return renderLinkOnly(interaction);
  if (id === "am_open_ignored") return renderIgnored(interaction);
  if (id === "am_open_responses") return renderResponses(interaction);
  if (id === "am_open_autodelete") return renderAutoDelete(interaction);
  if (id === "am_open_logs") return renderLogs(interaction);
  if (id === "am_open_config") return renderConfig(interaction);
  if (id === "am_back_root") return renderRoot(interaction);
  if (id === "am_logs_clear") {
    await setAutoModField(guildId, "logsChannelId", null as any);
    invalidateAutoModCache(guildId);
    return renderLogs(interaction);
  }
  if (id === "am_imgonly_clear") {
    await setAutoModField(guildId, "imageOnlyChannelIds", []);
    invalidateAutoModCache(guildId);
    return renderImgOnly(interaction);
  }
  if (id === "am_linkonly_clear") {
    await setAutoModField(guildId, "linkOnlyChannelIds", []);
    invalidateAutoModCache(guildId);
    return renderLinkOnly(interaction);
  }
  if (id === "am_longmsg_toggle") {
    const cfg = await getAutoModConfig(guildId);
    await setAutoModField(guildId, "longMsgEnabled", !cfg.longMsgEnabled);
    invalidateAutoModCache(guildId);
    return getState(interaction.user.id).view === "longmsg"
      ? renderLongMsg(interaction)
      : renderSpam(interaction);
  }

  // Links
  if (id === "am_links_toggle") {
    const cfg = await getAutoModConfig(guildId);
    await setAutoModField(guildId, "linksEnabled", !cfg.linksEnabled);
    invalidateAutoModCache(guildId);
    return renderLinks(interaction);
  }
  if (id === "am_links_wl_edit") {
    const cfg = await getAutoModConfig(guildId);
    return openWhitelistModal(cfg, interaction);
  }

  // Spam
  if (id === "am_spam_toggle") {
    const cfg = await getAutoModConfig(guildId);
    await setAutoModField(guildId, "spamEnabled", !cfg.spamEnabled);
    invalidateAutoModCache(guildId);
    return renderSpam(interaction);
  }

  // Responses
  if (id === "am_resp_new") {
    return openResponseTextModal(null, interaction);
  }
  if (id.startsWith("am_resp_text_")) {
    const rid = Number(id.slice("am_resp_text_".length));
    const r = await getAutoResponse(rid);
    return openResponseTextModal(r, interaction);
  }
  if (id.startsWith("am_resp_toggle_")) {
    const rid = Number(id.slice("am_resp_toggle_".length));
    const r = await getAutoResponse(rid);
    if (r) {
      await updateAutoResponse(rid, { enabled: !r.enabled });
      invalidateAutoModCache(guildId);
    }
    return renderResponseEdit(interaction, rid);
  }
  if (id.startsWith("am_resp_delete_")) {
    const rid = Number(id.slice("am_resp_delete_".length));
    await deleteAutoResponse(rid);
    invalidateAutoModCache(guildId);
    return renderResponses(interaction);
  }
}

export async function handleAutoModRoleSelect(interaction: RoleSelectMenuInteraction) {
  const id = interaction.customId;
  const guildId = interaction.guild!.id;
  const values = [...interaction.values];

  if (id === "am_links_roles") {
    await setAutoModField(guildId, "linksIgnoredRoleIds", values);
    invalidateAutoModCache(guildId);
    return renderLinks(interaction);
  }
  if (id === "am_ignored_roles") {
    await setAutoModField(guildId, "ignoredRoleIds", values);
    invalidateAutoModCache(guildId);
    return renderIgnored(interaction);
  }
  if (id === "am_longmsg_roles") {
    await setAutoModField(guildId, "longMsgIgnoredRoleIds", values);
    invalidateAutoModCache(guildId);
    return renderLongMsg(interaction);
  }
  if (id.startsWith("am_resp_roles_")) {
    const rid = Number(id.slice("am_resp_roles_".length));
    await updateAutoResponse(rid, { enabledRoleIds: values });
    invalidateAutoModCache(guildId);
    return renderResponseEdit(interaction, rid);
  }
}

export async function handleAutoModChannelSelect(interaction: ChannelSelectMenuInteraction) {
  const id = interaction.customId;
  const guildId = interaction.guild!.id;
  const values = [...interaction.values];

  if (id === "am_spam_cats") {
    await setAutoModField(guildId, "spamIgnoredCategoryIds", values);
    invalidateAutoModCache(guildId);
    return renderSpam(interaction);
  }
  if (id === "am_longmsg_cats") {
    await setAutoModField(guildId, "longMsgIgnoredCategoryIds", values);
    invalidateAutoModCache(guildId);
    return renderLongMsg(interaction);
  }
  if (id === "am_longmsg_channels") {
    await setAutoModField(guildId, "longMsgIgnoredChannelIds", values);
    invalidateAutoModCache(guildId);
    return renderLongMsg(interaction);
  }
  if (id === "am_imgonly_add") {
    const cfg = await getAutoModConfig(guildId);
    const merged = Array.from(new Set([...cfg.imageOnlyChannelIds, ...values]));
    await setAutoModField(guildId, "imageOnlyChannelIds", merged);
    invalidateAutoModCache(guildId);
    return renderImgOnly(interaction);
  }
  if (id === "am_linkonly_add") {
    const cfg = await getAutoModConfig(guildId);
    const merged = Array.from(new Set([...cfg.linkOnlyChannelIds, ...values]));
    await setAutoModField(guildId, "linkOnlyChannelIds", merged);
    invalidateAutoModCache(guildId);
    return renderLinkOnly(interaction);
  }
  if (id === "am_logs_channel") {
    await setAutoModField(guildId, "logsChannelId", (values[0] ?? null) as any);
    invalidateAutoModCache(guildId);
    return renderLogs(interaction);
  }
  if (id.startsWith("am_resp_chs_")) {
    const rid = Number(id.slice("am_resp_chs_".length));
    await updateAutoResponse(rid, { allowedChannelIds: values });
    invalidateAutoModCache(guildId);
    return renderResponseEdit(interaction, rid);
  }
}

export async function handleAutoModStringSelect(interaction: StringSelectMenuInteraction) {
  const id = interaction.customId;
  const guildId = interaction.guild!.id;

  if (id === "am_resp_pick") {
    const rid = Number(interaction.values[0]);
    return renderResponseEdit(interaction, rid);
  }
  if (id.startsWith("am_resp_match_")) {
    const rid = Number(id.slice("am_resp_match_".length));
    const v = interaction.values[0] as "contains" | "exact" | "starts_with";
    await updateAutoResponse(rid, { matchType: v });
    invalidateAutoModCache(guildId);
    return renderResponseEdit(interaction, rid);
  }
  if (id === "am_imgonly_remove") {
    const cfg = await getAutoModConfig(guildId);
    const removed = new Set(interaction.values);
    const next = cfg.imageOnlyChannelIds.filter((c) => !removed.has(c));
    await setAutoModField(guildId, "imageOnlyChannelIds", next);
    invalidateAutoModCache(guildId);
    return renderImgOnly(interaction);
  }
  if (id === "am_linkonly_remove") {
    const cfg = await getAutoModConfig(guildId);
    const removed = new Set(interaction.values);
    const next = cfg.linkOnlyChannelIds.filter((c) => !removed.has(c));
    await setAutoModField(guildId, "linkOnlyChannelIds", next);
    invalidateAutoModCache(guildId);
    return renderLinkOnly(interaction);
  }
}

export async function handleAutoModModal(interaction: ModalSubmitInteraction) {
  const id = interaction.customId;
  const guildId = interaction.guild!.id;

  if (id === "am_links_wl_modal") {
    const raw = interaction.fields.getTextInputValue("am_links_wl_value");
    const list = raw
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const dedup = [...new Set(list.map((s) => s.toLowerCase()))];
    await setAutoModField(guildId, "linksWhitelist", dedup);
    invalidateAutoModCache(guildId);
    return renderLinks(interaction);
  }

  if (id.startsWith("am_resp_text_modal_")) {
    const tail = id.slice("am_resp_text_modal_".length);
    const trigger = interaction.fields.getTextInputValue("am_resp_trigger").trim();
    const reply = interaction.fields.getTextInputValue("am_resp_reply").trim();
    const cdRaw = (interaction.fields.getTextInputValue("am_resp_cooldown") ?? "0").trim();
    const cooldown = Math.max(0, Math.min(86400, Number(cdRaw) || 0));
    if (!trigger || !reply) {
      await interaction.reply({
        embeds: [new EmbedBuilder().setColor(COLOR).setDescription("⚠️ Trigger and reply are both required.")],
        ephemeral: true,
      });
      return;
    }
    if (tail === "new") {
      const created = await createAutoResponse(guildId, trigger, reply);
      await updateAutoResponse(created.id, { cooldownSeconds: cooldown });
      invalidateAutoModCache(guildId);
      return renderResponseEdit(interaction, created.id);
    } else {
      const rid = Number(tail);
      await updateAutoResponse(rid, {
        triggerText: trigger,
        responseText: reply,
        cooldownSeconds: cooldown,
      });
      invalidateAutoModCache(guildId);
      return renderResponseEdit(interaction, rid);
    }
  }
}

// success toast (used elsewhere if needed)
export function buildSavedEmbed(text: string) {
  return new EmbedBuilder().setColor(SUCCESS).setDescription(`✅ ${text}`);
}
