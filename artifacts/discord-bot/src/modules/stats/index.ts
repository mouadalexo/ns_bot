import { Client, ChannelType, PermissionFlagsBits, VoiceChannel } from "discord.js";

const ENV_GUILD_ID = process.env.MAIN_GUILD_ID;
const CHANNEL_PREFIX = "👥";

let statsChannel: VoiceChannel | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function resolveGuildId(client: Client): string | null {
  if (ENV_GUILD_ID) return ENV_GUILD_ID;
  const first = client.guilds.cache.first();
  return first?.id ?? null;
}

function formatName(count: number): string {
  return `👥 Members: ${count.toLocaleString()}`;
}

async function findOrCreateChannel(client: Client): Promise<VoiceChannel | null> {
  const guildId = resolveGuildId(client);
  if (!guildId) {
    console.warn("[Stats] No guild available — stats channel disabled.");
    return null;
  }

  try {
    const guild = await client.guilds.fetch(guildId);
    await guild.channels.fetch();

    const existing = guild.channels.cache.find(
      (c) => c.isVoiceBased() && c.name.startsWith(CHANNEL_PREFIX)
    ) as VoiceChannel | undefined;

    if (existing) {
      console.log(`[Stats] Found existing stats channel: ${existing.name}`);
      return existing;
    }

    const newChannel = await guild.channels.create({
      name: formatName(guild.memberCount),
      type: ChannelType.GuildVoice,
      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          deny: [PermissionFlagsBits.Connect],
          allow: [PermissionFlagsBits.ViewChannel],
        },
      ],
      reason: "Auto-created stats channel — shows live member count",
    });

    console.log(`[Stats] Created stats channel: ${newChannel.name}`);
    return newChannel as VoiceChannel;
  } catch (e) {
    console.error("[Stats] Failed to find/create channel:", e);
    return null;
  }
}

async function updateChannel(client: Client): Promise<void> {
  const guildId = resolveGuildId(client);
  if (!guildId) return;

  try {
    const guild = await client.guilds.fetch(guildId);
    const count = guild.memberCount;
    const newName = formatName(count);

    if (!statsChannel || !statsChannel.guild) {
      statsChannel = await findOrCreateChannel(client);
    }

    if (statsChannel && statsChannel.name !== newName) {
      await statsChannel.setName(newName, "Live member count update");
      console.log(`[Stats] Channel updated → ${newName}`);
    }
  } catch (e) {
    console.error("[Stats] Failed to update channel:", e);
    statsChannel = null;
  }
}

function scheduleUpdate(client: Client): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => updateChannel(client), 10_000);
}

export function registerStatsModule(client: Client): void {
  client.once("clientReady", async () => {
    statsChannel = await findOrCreateChannel(client);
    await updateChannel(client);
  });

  client.on("guildMemberAdd", (member) => {
    const guildId = resolveGuildId(client);
    if (!guildId || member.guild.id !== guildId) return;
    scheduleUpdate(client);
  });

  client.on("guildMemberRemove", (member) => {
    const guildId = resolveGuildId(client);
    if (!guildId || member.guild.id !== guildId) return;
    scheduleUpdate(client);
  });
}
