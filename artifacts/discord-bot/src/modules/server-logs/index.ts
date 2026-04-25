import {
  AuditLogEvent,
  ChannelType,
  Client,
  EmbedBuilder,
  Guild,
  GuildChannel,
  Message,
  PartialMessage,
  PermissionsBitField,
  TextChannel,
} from "discord.js";
import { pool } from "@workspace/db";

// ============================================================================
// Types
// ============================================================================

export const LOG_EVENT_KEYS = [
  "message_delete",
  "channel_delete",
  "channel_perm_changed",
  "ban",
  "unban",
  "kick",
  "member_muted",
  "member_moved",
  "nickname_changed",
  "member_left",
] as const;

export type LogEventKey = typeof LOG_EVENT_KEYS[number];

export type LogEventMeta = {
  key: LogEventKey;
  label: string;
  emoji: string;
  description: string;
  color: number;
  defaultChannelName: string;
};

export const LOG_EVENT_META: Record<LogEventKey, LogEventMeta> = {
  message_delete: {
    key: "message_delete",
    label: "Deleted Messages",
    emoji: "🗑️",
    description: "Logs when a message is deleted (including bulk delete).",
    color: 0xff4d4d,
    defaultChannelName: "log-deleted-msgs",
  },
  channel_delete: {
    key: "channel_delete",
    label: "Deleted Channel",
    emoji: "📕",
    description: "Logs when a channel is deleted.",
    color: 0xff4d4d,
    defaultChannelName: "log-deleted-channels",
  },
  channel_perm_changed: {
    key: "channel_perm_changed",
    label: "Channel Permissions",
    emoji: "🔧",
    description: "Logs when a channel's permission overwrites are changed.",
    color: 0xffa500,
    defaultChannelName: "log-channel-perms",
  },
  ban: {
    key: "ban",
    label: "Member Banned",
    emoji: "🔨",
    description: "Logs when a member is banned.",
    color: 0xb00020,
    defaultChannelName: "log-bans",
  },
  unban: {
    key: "unban",
    label: "Member Unbanned",
    emoji: "🕊️",
    description: "Logs when a ban is removed.",
    color: 0x00c851,
    defaultChannelName: "log-unbans",
  },
  kick: {
    key: "kick",
    label: "Member Kicked",
    emoji: "👢",
    description: "Logs when a member is kicked from the server.",
    color: 0xff7043,
    defaultChannelName: "log-kicks",
  },
  member_muted: {
    key: "member_muted",
    label: "Member Muted",
    emoji: "🔇",
    description: "Logs timeout (mute) and unmute actions.",
    color: 0xb00020,
    defaultChannelName: "log-mutes",
  },
  member_moved: {
    key: "member_moved",
    label: "Member Moved",
    emoji: "↔️",
    description: "Logs when a member changes voice channel (joins, leaves, switches).",
    color: 0x5000ff,
    defaultChannelName: "log-voice-moves",
  },
  nickname_changed: {
    key: "nickname_changed",
    label: "Nickname Changes",
    emoji: "✏️",
    description: "Logs when a member's nickname is changed.",
    color: 0x5000ff,
    defaultChannelName: "log-nicknames",
  },
  member_left: {
    key: "member_left",
    label: "Member Left",
    emoji: "🚪",
    description: "Logs when a member leaves on their own (not kicked).",
    color: 0x808080,
    defaultChannelName: "log-leaves",
  },
};

export type ServerLogsEvents = Partial<Record<LogEventKey, { enabled: boolean; channelId: string | null }>>;

export type ServerLogsConfig = {
  guildId: string;
  logCategoryId: string | null;
  events: ServerLogsEvents;
};

// ============================================================================
// Schema + cache
// ============================================================================

export async function ensureServerLogsSchema(): Promise<void> {
  await pool.query(`
    create table if not exists server_logs_config (
      guild_id text primary key,
      log_category_id text,
      events_json text not null default '{}',
      updated_at timestamp default now() not null
    );
    alter table server_logs_config add column if not exists log_category_id text;
    alter table server_logs_config add column if not exists events_json text not null default '{}';
  `);
}

const cache = new Map<string, ServerLogsConfig>();

export function invalidateServerLogsCache(guildId: string): void {
  cache.delete(guildId);
}

export async function getServerLogsConfig(guildId: string): Promise<ServerLogsConfig> {
  const cached = cache.get(guildId);
  if (cached) return cached;

  const res = await pool.query<{
    guild_id: string;
    log_category_id: string | null;
    events_json: string;
  }>(
    "select guild_id, log_category_id, events_json from server_logs_config where guild_id = $1",
    [guildId],
  );

  let row = res.rows[0];
  if (!row) {
    await pool.query("insert into server_logs_config (guild_id) values ($1) on conflict do nothing", [guildId]);
    row = { guild_id: guildId, log_category_id: null, events_json: "{}" };
  }

  let events: ServerLogsEvents = {};
  try { events = JSON.parse(row.events_json || "{}"); } catch {}

  const cfg: ServerLogsConfig = {
    guildId,
    logCategoryId: row.log_category_id ?? null,
    events,
  };
  cache.set(guildId, cfg);
  return cfg;
}

async function persist(cfg: ServerLogsConfig): Promise<void> {
  await pool.query(
    `insert into server_logs_config (guild_id, log_category_id, events_json, updated_at)
     values ($1, $2, $3, now())
     on conflict (guild_id) do update
       set log_category_id = excluded.log_category_id,
           events_json = excluded.events_json,
           updated_at = now()`,
    [cfg.guildId, cfg.logCategoryId, JSON.stringify(cfg.events)],
  );
  cache.set(cfg.guildId, cfg);
}

export async function setLogCategory(guildId: string, categoryId: string | null): Promise<void> {
  const cfg = await getServerLogsConfig(guildId);
  cfg.logCategoryId = categoryId;
  await persist(cfg);
}

export async function setEventChannel(
  guildId: string,
  key: LogEventKey,
  channelId: string | null,
): Promise<void> {
  const cfg = await getServerLogsConfig(guildId);
  const prev = cfg.events[key] ?? { enabled: false, channelId: null };
  cfg.events[key] = { ...prev, channelId };
  await persist(cfg);
}

export async function setEventEnabled(
  guildId: string,
  key: LogEventKey,
  enabled: boolean,
): Promise<void> {
  const cfg = await getServerLogsConfig(guildId);
  const prev = cfg.events[key] ?? { enabled: false, channelId: null };
  cfg.events[key] = { ...prev, enabled };
  await persist(cfg);
}

// ============================================================================
// Channel auto-creation
// ============================================================================

export async function ensureLogChannel(
  guild: Guild,
  key: LogEventKey,
): Promise<TextChannel | null> {
  const cfg = await getServerLogsConfig(guild.id);
  if (!cfg.logCategoryId) return null;

  const category = guild.channels.cache.get(cfg.logCategoryId);
  if (!category || category.type !== ChannelType.GuildCategory) return null;

  // Reuse existing channel if it still exists
  if (cfg.events[key]?.channelId) {
    const existing = guild.channels.cache.get(cfg.events[key]!.channelId!);
    if (existing && existing.type === ChannelType.GuildText) return existing as TextChannel;
  }

  const meta = LOG_EVENT_META[key];

  // Create new channel inside the category — Discord auto-syncs perms with parent.
  const created = await guild.channels.create({
    name: meta.defaultChannelName,
    type: ChannelType.GuildText,
    parent: category.id,
    topic: `Night Stars Logs — ${meta.label}`,
    reason: `Server logs: enabling ${meta.label}`,
  });

  // Explicitly sync overwrites with the parent category
  try {
    await created.lockPermissions();
  } catch (err) {
    console.warn(`[ServerLogs] lockPermissions failed for ${key}:`, err);
  }

  await setEventChannel(guild.id, key, created.id);
  return created;
}

// ============================================================================
// Helpers
// ============================================================================

function snippet(s: string, max = 1024): string {
  if (!s) return "_(no content)_";
  return s.length <= max ? s : s.slice(0, max - 3) + "…";
}

function userLine(userId: string, tag?: string | null): string {
  return tag ? `<@${userId}>  \`${tag}\`` : `<@${userId}>`;
}

function fmtChannel(channel: GuildChannel | { id: string; name?: string }): string {
  return `<#${channel.id}>${channel.name ? `  \`#${channel.name}\`` : ""}`;
}

async function send(guild: Guild, key: LogEventKey, embed: EmbedBuilder): Promise<void> {
  try {
    const cfg = await getServerLogsConfig(guild.id);
    const ev = cfg.events[key];
    if (!ev?.enabled || !ev.channelId) return;
    const channel = guild.channels.cache.get(ev.channelId);
    if (!channel || channel.type !== ChannelType.GuildText) return;
    embed.setTimestamp().setFooter({ text: "Night Stars  •  Logs" });
    await (channel as TextChannel).send({
      embeds: [embed],
      allowedMentions: { parse: [] },
    });
  } catch (err) {
    console.error(`[ServerLogs] Failed to send ${key} log:`, err);
  }
}

// Look up the most recent matching audit log entry within a few seconds
async function recentAuditEntry(
  guild: Guild,
  type: AuditLogEvent,
  targetId?: string,
  windowMs = 5000,
): Promise<{ executorId: string | null; reason: string | null } | null> {
  try {
    const me = guild.members.me;
    if (!me?.permissions.has(PermissionsBitField.Flags.ViewAuditLog)) return null;
    const logs = await guild.fetchAuditLogs({ type, limit: 5 });
    const cutoff = Date.now() - windowMs;
    for (const entry of logs.entries.values()) {
      if (entry.createdTimestamp < cutoff) continue;
      if (targetId && (entry.target as any)?.id !== targetId) continue;
      return {
        executorId: entry.executor?.id ?? null,
        reason: entry.reason ?? null,
      };
    }
  } catch {}
  return null;
}

// ============================================================================
// Listener registration
// ============================================================================

export function registerServerLogsModule(client: Client): void {
  // ---- Message Delete ------------------------------------------------------
  client.on("messageDelete", async (msg) => {
    const m = msg as Message | PartialMessage;
    if (!m.guild) return;
    if (m.partial) {
      try { await m.fetch(); } catch {}
    }
    if (m.author?.bot) return;

    const audit = await recentAuditEntry(m.guild, AuditLogEvent.MessageDelete, m.author?.id ?? undefined);
    const meta = LOG_EVENT_META.message_delete;

    const embed = new EmbedBuilder()
      .setColor(meta.color)
      .setAuthor({
        name: m.author ? m.author.tag : "Unknown user",
        iconURL: m.author?.displayAvatarURL?.() ?? undefined,
      })
      .setTitle(`${meta.emoji}  Message Deleted`)
      .addFields(
        {
          name: "Author",
          value: m.author ? userLine(m.author.id, m.author.tag) : "_unknown_",
          inline: true,
        },
        { name: "Channel", value: `<#${m.channelId}>`, inline: true },
        ...(audit?.executorId
          ? [{ name: "Deleted by", value: `<@${audit.executorId}>`, inline: true }]
          : []),
        {
          name: "Content",
          value: snippet(m.content ?? "", 1024),
          inline: false,
        },
      );

    if (m.attachments && m.attachments.size > 0) {
      embed.addFields({
        name: "Attachments",
        value: m.attachments.map((a) => `• ${a.name ?? "file"} (${a.size ?? 0} B)`).join("\n").slice(0, 1024),
        inline: false,
      });
    }

    await send(m.guild, "message_delete", embed);
  });

  // ---- Channel Delete ------------------------------------------------------
  client.on("channelDelete", async (channel) => {
    if (!("guild" in channel) || !channel.guild) return;
    const guild = channel.guild;
    const meta = LOG_EVENT_META.channel_delete;
    const audit = await recentAuditEntry(guild, AuditLogEvent.ChannelDelete, channel.id);

    const embed = new EmbedBuilder()
      .setColor(meta.color)
      .setTitle(`${meta.emoji}  Channel Deleted`)
      .addFields(
        { name: "Channel", value: `\`#${(channel as any).name ?? "unknown"}\``, inline: true },
        { name: "Type", value: `\`${ChannelType[channel.type] ?? channel.type}\``, inline: true },
        ...(audit?.executorId
          ? [{ name: "Deleted by", value: `<@${audit.executorId}>`, inline: true }]
          : []),
      );

    await send(guild, "channel_delete", embed);
  });

  // ---- Channel Permissions Updated ----------------------------------------
  client.on("channelUpdate", async (oldCh, newCh) => {
    if (!("guild" in newCh) || !newCh.guild) return;
    if (!("permissionOverwrites" in oldCh) || !("permissionOverwrites" in newCh)) return;

    const oldOw = (oldCh as GuildChannel).permissionOverwrites?.cache;
    const newOw = (newCh as GuildChannel).permissionOverwrites?.cache;
    if (!oldOw || !newOw) return;

    // Detect any difference in overwrites
    let changed = false;
    if (oldOw.size !== newOw.size) {
      changed = true;
    } else {
      for (const [id, ow] of newOw) {
        const prev = oldOw.get(id);
        if (!prev) { changed = true; break; }
        if (prev.allow.bitfield !== ow.allow.bitfield || prev.deny.bitfield !== ow.deny.bitfield) {
          changed = true;
          break;
        }
      }
    }
    if (!changed) return;

    const guild = newCh.guild;
    const meta = LOG_EVENT_META.channel_perm_changed;
    const audit = await recentAuditEntry(guild, AuditLogEvent.ChannelOverwriteUpdate, newCh.id);
    const auditCreate = audit ?? await recentAuditEntry(guild, AuditLogEvent.ChannelOverwriteCreate, newCh.id);
    const auditDelete = auditCreate ?? await recentAuditEntry(guild, AuditLogEvent.ChannelOverwriteDelete, newCh.id);
    const exec = audit?.executorId ?? auditCreate?.executorId ?? auditDelete?.executorId ?? null;

    const embed = new EmbedBuilder()
      .setColor(meta.color)
      .setTitle(`${meta.emoji}  Channel Permissions Updated`)
      .addFields(
        { name: "Channel", value: fmtChannel(newCh as GuildChannel), inline: true },
        ...(exec ? [{ name: "Updated by", value: `<@${exec}>`, inline: true }] : []),
        { name: "Overwrites", value: `\`${oldOw.size}\` → \`${newOw.size}\` entries`, inline: true },
      );

    await send(guild, "channel_perm_changed", embed);
  });

  // ---- Ban / Unban ---------------------------------------------------------
  client.on("guildBanAdd", async (ban) => {
    const meta = LOG_EVENT_META.ban;
    const audit = await recentAuditEntry(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id);

    const embed = new EmbedBuilder()
      .setColor(meta.color)
      .setAuthor({ name: ban.user.tag, iconURL: ban.user.displayAvatarURL() })
      .setTitle(`${meta.emoji}  Member Banned`)
      .addFields(
        { name: "Member", value: userLine(ban.user.id, ban.user.tag), inline: true },
        ...(audit?.executorId
          ? [{ name: "Banned by", value: `<@${audit.executorId}>`, inline: true }]
          : []),
        { name: "Reason", value: audit?.reason || ban.reason || "_no reason provided_", inline: false },
      );

    await send(ban.guild, "ban", embed);
  });

  client.on("guildBanRemove", async (ban) => {
    const meta = LOG_EVENT_META.unban;
    const audit = await recentAuditEntry(ban.guild, AuditLogEvent.MemberBanRemove, ban.user.id);

    const embed = new EmbedBuilder()
      .setColor(meta.color)
      .setAuthor({ name: ban.user.tag, iconURL: ban.user.displayAvatarURL() })
      .setTitle(`${meta.emoji}  Member Unbanned`)
      .addFields(
        { name: "Member", value: userLine(ban.user.id, ban.user.tag), inline: true },
        ...(audit?.executorId
          ? [{ name: "Unbanned by", value: `<@${audit.executorId}>`, inline: true }]
          : []),
      );

    await send(ban.guild, "unban", embed);
  });

  // ---- Member Removed (Kick vs Leave) -------------------------------------
  client.on("guildMemberRemove", async (member) => {
    const guild = member.guild;
    const audit = await recentAuditEntry(guild, AuditLogEvent.MemberKick, member.id);

    if (audit) {
      const meta = LOG_EVENT_META.kick;
      const embed = new EmbedBuilder()
        .setColor(meta.color)
        .setAuthor({ name: member.user?.tag ?? "Unknown", iconURL: member.user?.displayAvatarURL?.() ?? undefined })
        .setTitle(`${meta.emoji}  Member Kicked`)
        .addFields(
          { name: "Member", value: userLine(member.id, member.user?.tag ?? null), inline: true },
          ...(audit.executorId ? [{ name: "Kicked by", value: `<@${audit.executorId}>`, inline: true }] : []),
          { name: "Reason", value: audit.reason || "_no reason provided_", inline: false },
        );
      await send(guild, "kick", embed);
      return;
    }

    const meta = LOG_EVENT_META.member_left;
    const joined = member.joinedTimestamp;
    const embed = new EmbedBuilder()
      .setColor(meta.color)
      .setAuthor({ name: member.user?.tag ?? "Unknown", iconURL: member.user?.displayAvatarURL?.() ?? undefined })
      .setTitle(`${meta.emoji}  Member Left`)
      .addFields(
        { name: "Member", value: userLine(member.id, member.user?.tag ?? null), inline: true },
        ...(joined ? [{ name: "Joined", value: `<t:${Math.floor(joined / 1000)}:R>`, inline: true }] : []),
        { name: "Member count", value: `\`${guild.memberCount}\``, inline: true },
      );
    await send(guild, "member_left", embed);
  });

  // ---- Member Updated (timeout / nickname) --------------------------------
  client.on("guildMemberUpdate", async (oldMember, newMember) => {
    const guild = newMember.guild;

    // Timeout (mute)
    const oldUntil = (oldMember as any).communicationDisabledUntilTimestamp ?? null;
    const newUntil = (newMember as any).communicationDisabledUntilTimestamp ?? null;
    if (oldUntil !== newUntil) {
      const meta = LOG_EVENT_META.member_muted;
      const audit = await recentAuditEntry(guild, AuditLogEvent.MemberUpdate, newMember.id);
      const isMute = newUntil && newUntil > Date.now();

      const embed = new EmbedBuilder()
        .setColor(meta.color)
        .setAuthor({ name: newMember.user.tag, iconURL: newMember.user.displayAvatarURL() })
        .setTitle(`${meta.emoji}  Member ${isMute ? "Muted" : "Unmuted"}`)
        .addFields(
          { name: "Member", value: userLine(newMember.id, newMember.user.tag), inline: true },
          ...(audit?.executorId ? [{ name: "By", value: `<@${audit.executorId}>`, inline: true }] : []),
          ...(isMute
            ? [{ name: "Until", value: `<t:${Math.floor(newUntil! / 1000)}:R>`, inline: true }]
            : []),
          ...(audit?.reason ? [{ name: "Reason", value: audit.reason, inline: false }] : []),
        );

      await send(guild, "member_muted", embed);
    }

    // Nickname change
    if (oldMember.nickname !== newMember.nickname) {
      const meta = LOG_EVENT_META.nickname_changed;
      const audit = await recentAuditEntry(guild, AuditLogEvent.MemberUpdate, newMember.id);
      const before = oldMember.nickname ?? oldMember.user.username;
      const after = newMember.nickname ?? newMember.user.username;

      const embed = new EmbedBuilder()
        .setColor(meta.color)
        .setAuthor({ name: newMember.user.tag, iconURL: newMember.user.displayAvatarURL() })
        .setTitle(`${meta.emoji}  Nickname Changed`)
        .addFields(
          { name: "Member", value: userLine(newMember.id, newMember.user.tag), inline: true },
          ...(audit?.executorId && audit.executorId !== newMember.id
            ? [{ name: "Changed by", value: `<@${audit.executorId}>`, inline: true }]
            : []),
          { name: "Before", value: `\`${snippet(before, 256)}\``, inline: true },
          { name: "After", value: `\`${snippet(after, 256)}\``, inline: true },
        );

      await send(guild, "nickname_changed", embed);
    }
  });

  // ---- Voice State (member moved / joined / left) -------------------------
  client.on("voiceStateUpdate", async (oldState, newState) => {
    const guild = newState.guild ?? oldState.guild;
    if (!guild) return;
    const member = newState.member ?? oldState.member;
    if (!member) return;

    const oldCh = oldState.channelId;
    const newCh = newState.channelId;
    if (oldCh === newCh) return;

    const meta = LOG_EVENT_META.member_moved;
    let action = "Moved";
    if (!oldCh && newCh) action = "Joined Voice";
    else if (oldCh && !newCh) action = "Left Voice";

    let movedBy: string | null = null;
    if (oldCh && newCh) {
      const audit = await recentAuditEntry(guild, AuditLogEvent.MemberMove);
      if (audit?.executorId) movedBy = audit.executorId;
    } else if (!newCh) {
      const audit = await recentAuditEntry(guild, AuditLogEvent.MemberDisconnect);
      if (audit?.executorId) movedBy = audit.executorId;
    }

    const embed = new EmbedBuilder()
      .setColor(meta.color)
      .setAuthor({ name: member.user.tag, iconURL: member.user.displayAvatarURL() })
      .setTitle(`${meta.emoji}  ${action}`)
      .addFields(
        { name: "Member", value: userLine(member.id, member.user.tag), inline: true },
        ...(oldCh ? [{ name: "From", value: `<#${oldCh}>`, inline: true }] : []),
        ...(newCh ? [{ name: "To", value: `<#${newCh}>`, inline: true }] : []),
        ...(movedBy ? [{ name: "By", value: `<@${movedBy}>`, inline: true }] : []),
      );

    await send(guild, "member_moved", embed);
  });
}
