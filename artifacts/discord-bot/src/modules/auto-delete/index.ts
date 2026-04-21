import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelSelectMenuInteraction,
  ChannelType,
  ChatInputCommandInteraction,
  Client,
  EmbedBuilder,
  GuildMember,
  Message,
  ModalBuilder,
  ModalSubmitInteraction,
  PermissionsBitField,
  REST,
  RoleSelectMenuBuilder,
  RoleSelectMenuInteraction,
  Routes,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { pool } from "@workspace/db";
import { isMainGuild } from "../../utils/guildFilter.js";

const BRAND = 0x5000ff;

const CONTENT_TYPES = [
  { key: "links", label: "Links" },
  { key: "images", label: "Images" },
  { key: "gifs", label: "GIFs" },
  { key: "videos", label: "Videos" },
  { key: "attachments", label: "Attachments" },
  { key: "invites", label: "Invites" },
] as const;

type ContentTypeKey = (typeof CONTENT_TYPES)[number]["key"];

type AutoDeleteRule = {
  id: number;
  guild_id: string;
  scope: "channel" | "category";
  target_id: string;
  delete_links: boolean;
  delete_images: boolean;
  delete_gifs: boolean;
  delete_videos: boolean;
  delete_attachments: boolean;
  delete_invites: boolean;
  applied_role_ids_json: string | null;
  ignored_role_ids_json: string | null;
};

type ServerWords = {
  guild_id: string;
  words_json: string;
  ignored_role_ids_json: string | null;
};

type DraftRule = {
  scope: "channel" | "category";
  targetId: string;
  deleteLinks: boolean;
  deleteImages: boolean;
  deleteGifs: boolean;
  deleteVideos: boolean;
  deleteAttachments: boolean;
  deleteInvites: boolean;
  appliedRoleIds: string[];
  ignoredRoleIds: string[];
  editingId?: number;
};

type DraftWords = {
  words: string[];
  ignoredRoleIds: string[];
};

const ruleDrafts = new Map<string, DraftRule>();
const wordDrafts = new Map<string, DraftWords>();

function draftKey(guildId: string, userId: string) {
  return `${guildId}:${userId}`;
}

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS auto_delete_rules (
      id SERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      target_id TEXT NOT NULL,
      delete_links BOOLEAN NOT NULL DEFAULT FALSE,
      delete_images BOOLEAN NOT NULL DEFAULT FALSE,
      delete_gifs BOOLEAN NOT NULL DEFAULT FALSE,
      delete_videos BOOLEAN NOT NULL DEFAULT FALSE,
      delete_attachments BOOLEAN NOT NULL DEFAULT FALSE,
      delete_invites BOOLEAN NOT NULL DEFAULT FALSE,
      applied_role_ids_json TEXT,
      ignored_role_ids_json TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS auto_delete_rules_guild_scope_target_idx
    ON auto_delete_rules (guild_id, scope, target_id);
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS auto_delete_server_words (
      guild_id TEXT PRIMARY KEY,
      words_json TEXT NOT NULL DEFAULT '[]',
      ignored_role_ids_json TEXT,
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);
}

function parseJsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.filter((v) => typeof v === "string");
  } catch {}
  return [];
}

async function getServerWords(guildId: string): Promise<ServerWords | null> {
  const res = await pool.query<ServerWords>(
    `SELECT guild_id, words_json, ignored_role_ids_json FROM auto_delete_server_words WHERE guild_id=$1`,
    [guildId],
  );
  return res.rows[0] ?? null;
}

async function setServerWords(guildId: string, words: string[], ignoredRoleIds: string[]) {
  await pool.query(
    `INSERT INTO auto_delete_server_words (guild_id, words_json, ignored_role_ids_json, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (guild_id) DO UPDATE SET words_json=EXCLUDED.words_json, ignored_role_ids_json=EXCLUDED.ignored_role_ids_json, updated_at=NOW()`,
    [guildId, JSON.stringify(words), JSON.stringify(ignoredRoleIds)],
  );
}

async function listRules(guildId: string): Promise<AutoDeleteRule[]> {
  const res = await pool.query<AutoDeleteRule>(
    `SELECT * FROM auto_delete_rules WHERE guild_id=$1 ORDER BY scope, target_id`,
    [guildId],
  );
  return res.rows;
}

async function findRule(guildId: string, scope: string, targetId: string): Promise<AutoDeleteRule | null> {
  const res = await pool.query<AutoDeleteRule>(
    `SELECT * FROM auto_delete_rules WHERE guild_id=$1 AND scope=$2 AND target_id=$3`,
    [guildId, scope, targetId],
  );
  return res.rows[0] ?? null;
}

async function upsertRule(guildId: string, draft: DraftRule): Promise<AutoDeleteRule> {
  const res = await pool.query<AutoDeleteRule>(
    `INSERT INTO auto_delete_rules
       (guild_id, scope, target_id, delete_links, delete_images, delete_gifs, delete_videos,
        delete_attachments, delete_invites, applied_role_ids_json, ignored_role_ids_json, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, NOW())
     ON CONFLICT (guild_id, scope, target_id) DO UPDATE SET
       delete_links=EXCLUDED.delete_links,
       delete_images=EXCLUDED.delete_images,
       delete_gifs=EXCLUDED.delete_gifs,
       delete_videos=EXCLUDED.delete_videos,
       delete_attachments=EXCLUDED.delete_attachments,
       delete_invites=EXCLUDED.delete_invites,
       applied_role_ids_json=EXCLUDED.applied_role_ids_json,
       ignored_role_ids_json=EXCLUDED.ignored_role_ids_json,
       updated_at=NOW()
     RETURNING *`,
    [
      guildId,
      draft.scope,
      draft.targetId,
      draft.deleteLinks,
      draft.deleteImages,
      draft.deleteGifs,
      draft.deleteVideos,
      draft.deleteAttachments,
      draft.deleteInvites,
      JSON.stringify(draft.appliedRoleIds),
      JSON.stringify(draft.ignoredRoleIds),
    ],
  );
  return res.rows[0];
}

async function deleteRule(guildId: string, id: number) {
  await pool.query(`DELETE FROM auto_delete_rules WHERE guild_id=$1 AND id=$2`, [guildId, id]);
}

const URL_RE = /https?:\/\/[^\s>]+/i;
const INVITE_RE = /(discord\.gg|discord(?:app)?\.com\/invite)\/[a-z0-9-]+/i;
const IMAGE_EXT_RE = /\.(png|jpe?g|webp|bmp|tiff?|heic)$/i;
const GIF_EXT_RE = /\.gif$/i;
const VIDEO_EXT_RE = /\.(mp4|mov|webm|mkv|avi|m4v)$/i;

function classifyMessageContent(message: Message): Set<ContentTypeKey> {
  const types = new Set<ContentTypeKey>();
  const content = message.content ?? "";
  if (URL_RE.test(content)) types.add("links");
  if (INVITE_RE.test(content)) types.add("invites");
  if (message.attachments.size > 0) types.add("attachments");
  for (const att of message.attachments.values()) {
    const name = (att.name ?? att.url ?? "").toLowerCase();
    const ct = (att.contentType ?? "").toLowerCase();
    if (GIF_EXT_RE.test(name) || ct === "image/gif") types.add("gifs");
    else if (IMAGE_EXT_RE.test(name) || ct.startsWith("image/")) types.add("images");
    if (VIDEO_EXT_RE.test(name) || ct.startsWith("video/")) types.add("videos");
  }
  for (const embed of message.embeds) {
    if (embed.video) types.add("videos");
    if (embed.image) {
      const url = (embed.image.url ?? "").toLowerCase();
      if (GIF_EXT_RE.test(url)) types.add("gifs");
      else types.add("images");
    }
    if (embed.thumbnail) {
      const url = (embed.thumbnail.url ?? "").toLowerCase();
      if (GIF_EXT_RE.test(url)) types.add("gifs");
    }
  }
  if (/\.gif(\?|$)/i.test(content) || /tenor\.com|giphy\.com/i.test(content)) types.add("gifs");
  return types;
}

function ruleMatchesTypes(rule: AutoDeleteRule, types: Set<ContentTypeKey>): boolean {
  if (rule.delete_links && types.has("links")) return true;
  if (rule.delete_images && types.has("images")) return true;
  if (rule.delete_gifs && types.has("gifs")) return true;
  if (rule.delete_videos && types.has("videos")) return true;
  if (rule.delete_attachments && types.has("attachments")) return true;
  if (rule.delete_invites && types.has("invites")) return true;
  return false;
}

function memberHasAnyRole(member: GuildMember | null, roleIds: string[]): boolean {
  if (!member) return false;
  if (!roleIds.length) return false;
  return roleIds.some((id) => member.roles.cache.has(id));
}

function buildWordRegex(words: string[]): RegExp | null {
  const cleaned = words.map((w) => w.trim()).filter((w) => w.length > 0);
  if (!cleaned.length) return null;
  const escaped = cleaned.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`(^|\\W)(${escaped.join("|")})(\\W|$)`, "i");
}

async function handleAutoDeleteMessage(message: Message) {
  if (!message.guild || message.author.bot) return;
  if (!isMainGuild(message.guild.id)) return;
  if (!message.member) return;
  if (message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;

  const guildId = message.guild.id;
  const channelId = message.channelId;
  const parentId = (message.channel as any)?.parentId ?? null;

  // Server-wide blocked words
  const wordsRow = await getServerWords(guildId).catch(() => null);
  if (wordsRow) {
    const ignored = parseJsonArray(wordsRow.ignored_role_ids_json);
    if (!memberHasAnyRole(message.member, ignored)) {
      const words = parseJsonArray(wordsRow.words_json);
      const re = buildWordRegex(words);
      if (re && re.test(message.content ?? "")) {
        await message.delete().catch(() => {});
        return;
      }
    }
  }

  // Channel/category content rules
  const candidates: AutoDeleteRule[] = [];
  const channelRule = await findRule(guildId, "channel", channelId).catch(() => null);
  if (channelRule) candidates.push(channelRule);
  if (parentId) {
    const catRule = await findRule(guildId, "category", parentId).catch(() => null);
    if (catRule) candidates.push(catRule);
  }
  if (!candidates.length) return;

  const types = classifyMessageContent(message);
  if (!types.size) return;

  for (const rule of candidates) {
    const ignored = parseJsonArray(rule.ignored_role_ids_json);
    if (memberHasAnyRole(message.member, ignored)) continue;
    const applied = parseJsonArray(rule.applied_role_ids_json);
    if (applied.length && !memberHasAnyRole(message.member, applied)) continue;
    if (ruleMatchesTypes(rule, types)) {
      await message.delete().catch(() => {});
      return;
    }
  }
}

// ---------------- UI ----------------

function buildRootEmbed(rules: AutoDeleteRule[], words: ServerWords | null) {
  const wordCount = words ? parseJsonArray(words.words_json).length : 0;
  const channelCount = rules.filter((r) => r.scope === "channel").length;
  const categoryCount = rules.filter((r) => r.scope === "category").length;
  return new EmbedBuilder()
    .setColor(BRAND)
    .setTitle("🛡️ Auto-Delete Setup")
    .setDescription(
      "Manage what NS Bot deletes automatically.\n\n" +
      "**Block Words (server-wide)** — words deleted everywhere.\n" +
      "**Channel rules** — delete links/images/gifs/videos/attachments/invites in a specific channel.\n" +
      "**Category rules** — same, applied to all channels in a category.\n\n" +
      "Each rule can target specific roles (apply only to them), and ignore other roles.",
    )
    .addFields(
      { name: "🚫 Server block words", value: wordCount ? `${wordCount} word(s)` : "None set", inline: true },
      { name: "📺 Channel rules", value: `${channelCount}`, inline: true },
      { name: "📁 Category rules", value: `${categoryCount}`, inline: true },
    )
    .setFooter({ text: "Night Stars • Auto-Delete" });
}

function buildRootRows(rules: AutoDeleteRule[]) {
  const rows: ActionRowBuilder<any>[] = [];
  rows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("ad_open_words").setLabel("🚫 Block Words").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("ad_add_channel").setLabel("➕ Add Channel Rule").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("ad_add_category").setLabel("➕ Add Category Rule").setStyle(ButtonStyle.Success),
    ),
  );

  if (rules.length) {
    const options = rules.slice(0, 25).map((r) => ({
      label: `${r.scope === "channel" ? "📺" : "📁"} ${r.scope}`,
      description: ruleSummary(r),
      value: String(r.id),
    }));
    rows.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("ad_pick_rule")
          .setPlaceholder("Edit or preview an existing rule…")
          .addOptions(options),
      ),
    );
  }
  return rows;
}

function ruleSummary(rule: AutoDeleteRule) {
  const types: string[] = [];
  if (rule.delete_links) types.push("links");
  if (rule.delete_images) types.push("images");
  if (rule.delete_gifs) types.push("gifs");
  if (rule.delete_videos) types.push("videos");
  if (rule.delete_attachments) types.push("attachments");
  if (rule.delete_invites) types.push("invites");
  return `${rule.scope === "channel" ? "<#>" : "category"} ${rule.target_id} • ${types.join(", ") || "no types"}`.slice(0, 100);
}

async function openRootPanel(interaction: ChatInputCommandInteraction | ButtonInteraction) {
  const guildId = interaction.guildId!;
  const [rules, words] = await Promise.all([listRules(guildId), getServerWords(guildId)]);
  const payload = { embeds: [buildRootEmbed(rules, words)], components: buildRootRows(rules) };
  if (interaction.isButton()) await interaction.update({ ...payload, content: "" }).catch(async () => {
    await interaction.followUp({ ...payload, ephemeral: true });
  });
  else if (interaction.replied || interaction.deferred) await interaction.editReply(payload);
  else await interaction.reply({ ...payload, ephemeral: true });
}

// Word block panel
function buildWordsEmbed(words: string[], ignored: string[]) {
  return new EmbedBuilder()
    .setColor(BRAND)
    .setTitle("🚫 Server Block Words")
    .setDescription(
      `**Words (${words.length})**\n${words.length ? words.map((w) => `\`${w}\``).join(" ") : "_None set_"}\n\n` +
      `**Ignored roles**\n${ignored.length ? ignored.map((id) => `<@&${id}>`).join(" ") : "_None_"}\n\n` +
      "Members posting these words anywhere on the server will have their messages deleted, except admins and ignored roles.",
    )
    .setFooter({ text: "Night Stars • Auto-Delete" });
}

function buildWordsRows() {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("ad_words_edit").setLabel("✏️ Edit Words").setStyle(ButtonStyle.Primary),
    ),
    new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
      new RoleSelectMenuBuilder().setCustomId("ad_words_ignored").setPlaceholder("Set ignored roles…").setMinValues(0).setMaxValues(10),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("ad_back").setLabel("← Back").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("ad_words_clear").setLabel("Clear All").setStyle(ButtonStyle.Danger),
    ),
  ];
}

async function openWordsPanel(interaction: ButtonInteraction) {
  const guildId = interaction.guildId!;
  const row = await getServerWords(guildId);
  const words = row ? parseJsonArray(row.words_json) : [];
  const ignored = row ? parseJsonArray(row.ignored_role_ids_json) : [];
  wordDrafts.set(draftKey(guildId, interaction.user.id), { words, ignoredRoleIds: ignored });
  await interaction.update({ embeds: [buildWordsEmbed(words, ignored)], components: buildWordsRows() });
}

async function openWordsModal(interaction: ButtonInteraction) {
  const guildId = interaction.guildId!;
  const draft = wordDrafts.get(draftKey(guildId, interaction.user.id)) ?? { words: [], ignoredRoleIds: [] };
  const modal = new ModalBuilder().setCustomId("ad_words_modal").setTitle("Edit Block Words");
  const input = new TextInputBuilder()
    .setCustomId("words")
    .setLabel("One word per line (or comma-separated)")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setValue(draft.words.join("\n"))
    .setMaxLength(2000);
  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
  await interaction.showModal(modal);
}

async function handleWordsModalSubmit(interaction: ModalSubmitInteraction) {
  const guildId = interaction.guildId!;
  const raw = interaction.fields.getTextInputValue("words");
  const words = raw
    .split(/[\n,]/)
    .map((w) => w.trim().toLowerCase())
    .filter((w) => w.length > 0)
    .filter((w, i, a) => a.indexOf(w) === i);
  const draft = wordDrafts.get(draftKey(guildId, interaction.user.id)) ?? { words: [], ignoredRoleIds: [] };
  draft.words = words;
  wordDrafts.set(draftKey(guildId, interaction.user.id), draft);
  await setServerWords(guildId, words, draft.ignoredRoleIds);
  await interaction.update({ embeds: [buildWordsEmbed(words, draft.ignoredRoleIds)], components: buildWordsRows() });
}

async function handleWordsIgnoredSelect(interaction: RoleSelectMenuInteraction) {
  const guildId = interaction.guildId!;
  const draft = wordDrafts.get(draftKey(guildId, interaction.user.id)) ?? { words: [], ignoredRoleIds: [] };
  draft.ignoredRoleIds = interaction.values;
  wordDrafts.set(draftKey(guildId, interaction.user.id), draft);
  await setServerWords(guildId, draft.words, draft.ignoredRoleIds);
  await interaction.update({ embeds: [buildWordsEmbed(draft.words, draft.ignoredRoleIds)], components: buildWordsRows() });
}

async function handleWordsClear(interaction: ButtonInteraction) {
  const guildId = interaction.guildId!;
  await setServerWords(guildId, [], []);
  wordDrafts.set(draftKey(guildId, interaction.user.id), { words: [], ignoredRoleIds: [] });
  await interaction.update({ embeds: [buildWordsEmbed([], [])], components: buildWordsRows() });
}

// Per-channel/category rule editor
function buildRuleEmbed(draft: DraftRule) {
  const enabled = CONTENT_TYPES.filter((t) => {
    const k = t.key;
    if (k === "links") return draft.deleteLinks;
    if (k === "images") return draft.deleteImages;
    if (k === "gifs") return draft.deleteGifs;
    if (k === "videos") return draft.deleteVideos;
    if (k === "attachments") return draft.deleteAttachments;
    if (k === "invites") return draft.deleteInvites;
    return false;
  });
  const targetMention = draft.scope === "channel" ? `<#${draft.targetId}>` : `📁 \`<category ${draft.targetId}>\``;
  return new EmbedBuilder()
    .setColor(BRAND)
    .setTitle(`🛡️ Auto-Delete — ${draft.scope === "channel" ? "Channel" : "Category"} Rule`)
    .setDescription(
      `**Target**: ${targetMention}\n\n` +
      `**Delete types** (toggle below): ${enabled.length ? enabled.map((t) => `\`${t.label}\``).join(" ") : "_none_"}\n\n` +
      `**Applied roles** (only delete for these; empty = everyone): ${draft.appliedRoleIds.length ? draft.appliedRoleIds.map((id) => `<@&${id}>`).join(" ") : "_everyone_"}\n` +
      `**Ignored roles** (never delete for these): ${draft.ignoredRoleIds.length ? draft.ignoredRoleIds.map((id) => `<@&${id}>`).join(" ") : "_none_"}`,
    )
    .setFooter({ text: "Night Stars • Auto-Delete" });
}

function buildRuleRows(draft: DraftRule) {
  const targetSelect =
    draft.scope === "channel"
      ? new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
          new ChannelSelectMenuBuilder()
            .setCustomId("ad_rule_target")
            .setPlaceholder(draft.targetId ? "✅ Channel selected" : "Select a channel…")
            .addChannelTypes(ChannelType.GuildText)
            .setMinValues(1)
            .setMaxValues(1),
        )
      : new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
          new ChannelSelectMenuBuilder()
            .setCustomId("ad_rule_target")
            .setPlaceholder(draft.targetId ? "✅ Category selected" : "Select a category…")
            .addChannelTypes(ChannelType.GuildCategory)
            .setMinValues(1)
            .setMaxValues(1),
        );

  const typesSelect = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("ad_rule_types")
      .setPlaceholder("Pick what to delete (multi-select)")
      .setMinValues(0)
      .setMaxValues(CONTENT_TYPES.length)
      .addOptions(
        CONTENT_TYPES.map((t) => ({
          label: t.label,
          value: t.key,
          default:
            (t.key === "links" && draft.deleteLinks) ||
            (t.key === "images" && draft.deleteImages) ||
            (t.key === "gifs" && draft.deleteGifs) ||
            (t.key === "videos" && draft.deleteVideos) ||
            (t.key === "attachments" && draft.deleteAttachments) ||
            (t.key === "invites" && draft.deleteInvites),
        })),
      ),
  );

  const appliedSelect = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
    new RoleSelectMenuBuilder().setCustomId("ad_rule_applied").setPlaceholder("Applied roles (empty = everyone)").setMinValues(0).setMaxValues(10),
  );
  const ignoredSelect = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
    new RoleSelectMenuBuilder().setCustomId("ad_rule_ignored").setPlaceholder("Ignored roles").setMinValues(0).setMaxValues(10),
  );

  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("ad_rule_save").setLabel("💾 Save").setStyle(ButtonStyle.Success).setDisabled(!draft.targetId),
    new ButtonBuilder().setCustomId("ad_back").setLabel("← Back").setStyle(ButtonStyle.Secondary),
    ...(draft.editingId
      ? [new ButtonBuilder().setCustomId("ad_rule_delete").setLabel("Delete").setStyle(ButtonStyle.Danger)]
      : []),
  );

  return [targetSelect, typesSelect, appliedSelect, ignoredSelect, buttons];
}

function newDraft(scope: "channel" | "category"): DraftRule {
  return {
    scope,
    targetId: "",
    deleteLinks: false,
    deleteImages: false,
    deleteGifs: false,
    deleteVideos: false,
    deleteAttachments: false,
    deleteInvites: false,
    appliedRoleIds: [],
    ignoredRoleIds: [],
  };
}

function ruleToDraft(rule: AutoDeleteRule): DraftRule {
  return {
    scope: rule.scope,
    targetId: rule.target_id,
    deleteLinks: rule.delete_links,
    deleteImages: rule.delete_images,
    deleteGifs: rule.delete_gifs,
    deleteVideos: rule.delete_videos,
    deleteAttachments: rule.delete_attachments,
    deleteInvites: rule.delete_invites,
    appliedRoleIds: parseJsonArray(rule.applied_role_ids_json),
    ignoredRoleIds: parseJsonArray(rule.ignored_role_ids_json),
    editingId: rule.id,
  };
}

async function openRulePanel(interaction: ButtonInteraction | StringSelectMenuInteraction, draft: DraftRule) {
  const guildId = interaction.guildId!;
  ruleDrafts.set(draftKey(guildId, interaction.user.id), draft);
  await interaction.update({ embeds: [buildRuleEmbed(draft)], components: buildRuleRows(draft) });
}

async function handleAddChannel(interaction: ButtonInteraction) {
  await openRulePanel(interaction, newDraft("channel"));
}
async function handleAddCategory(interaction: ButtonInteraction) {
  await openRulePanel(interaction, newDraft("category"));
}

async function handlePickRule(interaction: StringSelectMenuInteraction) {
  const id = Number(interaction.values[0]);
  const guildId = interaction.guildId!;
  const all = await listRules(guildId);
  const rule = all.find((r) => r.id === id);
  if (!rule) {
    await interaction.reply({ content: "Rule not found.", ephemeral: true });
    return;
  }
  await openRulePanel(interaction, ruleToDraft(rule));
}

async function handleRuleTargetSelect(interaction: ChannelSelectMenuInteraction) {
  const key = draftKey(interaction.guildId!, interaction.user.id);
  const draft = ruleDrafts.get(key);
  if (!draft) return;
  draft.targetId = interaction.values[0];
  ruleDrafts.set(key, draft);
  await interaction.update({ embeds: [buildRuleEmbed(draft)], components: buildRuleRows(draft) });
}

async function handleRuleTypesSelect(interaction: StringSelectMenuInteraction) {
  const key = draftKey(interaction.guildId!, interaction.user.id);
  const draft = ruleDrafts.get(key);
  if (!draft) return;
  const set = new Set(interaction.values);
  draft.deleteLinks = set.has("links");
  draft.deleteImages = set.has("images");
  draft.deleteGifs = set.has("gifs");
  draft.deleteVideos = set.has("videos");
  draft.deleteAttachments = set.has("attachments");
  draft.deleteInvites = set.has("invites");
  ruleDrafts.set(key, draft);
  await interaction.update({ embeds: [buildRuleEmbed(draft)], components: buildRuleRows(draft) });
}

async function handleRuleAppliedSelect(interaction: RoleSelectMenuInteraction) {
  const key = draftKey(interaction.guildId!, interaction.user.id);
  const draft = ruleDrafts.get(key);
  if (!draft) return;
  draft.appliedRoleIds = interaction.values;
  ruleDrafts.set(key, draft);
  await interaction.update({ embeds: [buildRuleEmbed(draft)], components: buildRuleRows(draft) });
}

async function handleRuleIgnoredSelect(interaction: RoleSelectMenuInteraction) {
  const key = draftKey(interaction.guildId!, interaction.user.id);
  const draft = ruleDrafts.get(key);
  if (!draft) return;
  draft.ignoredRoleIds = interaction.values;
  ruleDrafts.set(key, draft);
  await interaction.update({ embeds: [buildRuleEmbed(draft)], components: buildRuleRows(draft) });
}

async function handleRuleSave(interaction: ButtonInteraction) {
  const key = draftKey(interaction.guildId!, interaction.user.id);
  const draft = ruleDrafts.get(key);
  if (!draft || !draft.targetId) return;
  await upsertRule(interaction.guildId!, draft);
  ruleDrafts.delete(key);
  await openRootPanel(interaction);
}

async function handleRuleDelete(interaction: ButtonInteraction) {
  const key = draftKey(interaction.guildId!, interaction.user.id);
  const draft = ruleDrafts.get(key);
  if (!draft?.editingId) return;
  await deleteRule(interaction.guildId!, draft.editingId);
  ruleDrafts.delete(key);
  await openRootPanel(interaction);
}

async function handleBack(interaction: ButtonInteraction) {
  await openRootPanel(interaction);
}

export async function registerAutoDeleteModule(client: Client) {
  await ensureSchema().catch((err) => console.error("[AutoDelete] ensureSchema failed:", err));

  // Slash command registration
  const token = process.env.DISCORD_TOKEN;
  if (token) {
    const cmd = new SlashCommandBuilder()
      .setName("auto-delete")
      .setDescription("Configure auto-delete (block words, channel/category content rules)")
      .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
      .toJSON();
    const rest = new REST().setToken(token);
    const register = async (guildId: string) => {
      try {
        // Append to existing guild commands (overwrite would clobber others). Use add semantics:
        const existing = (await rest.get(Routes.applicationGuildCommands(client.user!.id, guildId))) as any[];
        const without = existing.filter((c) => c.name !== "auto-delete");
        await rest.put(Routes.applicationGuildCommands(client.user!.id, guildId), { body: [...without, cmd] });
      } catch (err) {
        console.error("[AutoDelete] Failed to register slash command:", err);
      }
    };
    // Register a few seconds after ready to let panels/index register first
    setTimeout(() => {
      for (const guild of client.guilds.cache.values()) register(guild.id);
    }, 5000);
    client.on("guildCreate", (guild) => register(guild.id));
  }

  client.on("interactionCreate", async (interaction) => {
    try {
      if (!interaction.guild) return;
      if (!isMainGuild(interaction.guild.id)) return;

      if (interaction.isChatInputCommand() && interaction.commandName === "auto-delete") {
        if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
          await interaction.reply({ content: "❌ Administrator permission required.", ephemeral: true });
          return;
        }
        await openRootPanel(interaction);
        return;
      }

      if (interaction.isButton()) {
        const id = interaction.customId;
        if (id === "ad_open_words") return openWordsPanel(interaction);
        if (id === "ad_words_edit") return openWordsModal(interaction);
        if (id === "ad_words_clear") return handleWordsClear(interaction);
        if (id === "ad_add_channel") return handleAddChannel(interaction);
        if (id === "ad_add_category") return handleAddCategory(interaction);
        if (id === "ad_rule_save") return handleRuleSave(interaction);
        if (id === "ad_rule_delete") return handleRuleDelete(interaction);
        if (id === "ad_back") return handleBack(interaction);
      }

      if (interaction.isStringSelectMenu()) {
        if (interaction.customId === "ad_pick_rule") return handlePickRule(interaction);
        if (interaction.customId === "ad_rule_types") return handleRuleTypesSelect(interaction);
      }

      if (interaction.isChannelSelectMenu()) {
        if (interaction.customId === "ad_rule_target") return handleRuleTargetSelect(interaction);
      }

      if (interaction.isRoleSelectMenu()) {
        if (interaction.customId === "ad_rule_applied") return handleRuleAppliedSelect(interaction);
        if (interaction.customId === "ad_rule_ignored") return handleRuleIgnoredSelect(interaction);
        if (interaction.customId === "ad_words_ignored") return handleWordsIgnoredSelect(interaction);
      }

      if (interaction.isModalSubmit()) {
        if (interaction.customId === "ad_words_modal") return handleWordsModalSubmit(interaction);
      }
    } catch (err) {
      console.error("[AutoDelete] interaction error:", err);
    }
  });

  client.on("messageCreate", async (message) => {
    handleAutoDeleteMessage(message).catch((err) => console.error("[AutoDelete] messageCreate error:", err));
  });
}
