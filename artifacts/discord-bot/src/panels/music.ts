import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  ButtonInteraction,
  RoleSelectMenuInteraction,
  ChannelSelectMenuInteraction,
  RoleSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
} from "discord.js";
import { pool } from "@workspace/db";

const MUSIC_COLOR = 0x5000ff;

async function getMusicConfig(guildId: string) {
  const res = await pool.query<{ dj_role_id: string | null; notification_channel_id: string | null }>(
    "SELECT dj_role_id, notification_channel_id FROM music_config WHERE guild_id = $1",
    [guildId]
  );
  return res.rows[0] ?? { dj_role_id: null, notification_channel_id: null };
}

async function saveMusicConfig(guildId: string, djRoleId: string | null, channelId: string | null): Promise<void> {
  await pool.query(
    `INSERT INTO music_config (guild_id, dj_role_id, notification_channel_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (guild_id) DO UPDATE SET dj_role_id = $2, notification_channel_id = $3, updated_at = now()`,
    [guildId, djRoleId, channelId]
  );
}

async function buildMusicPanelEmbed(guildId: string): Promise<EmbedBuilder> {
  const cfg = await getMusicConfig(guildId);

  const artistsRes = await pool.query<{ artist_name: string }>(
    "SELECT artist_name FROM music_artists WHERE guild_id = $1 ORDER BY added_at ASC",
    [guildId]
  );
  const artists = artistsRes.rows.map(r => r.artist_name);

  return new EmbedBuilder()
    .setColor(MUSIC_COLOR)
    .setTitle("🎵 Music Release System")
    .addFields(
      {
        name: "DJ Role",
        value: cfg.dj_role_id ? `<@&${cfg.dj_role_id}>` : "*Not set*",
        inline: true,
      },
      {
        name: "Notification Channel",
        value: cfg.notification_channel_id ? `<#${cfg.notification_channel_id}>` : "*Not set*",
        inline: true,
      },
      {
        name: "Tracked Artists",
        value: artists.length
          ? artists.map(a => `• ${a}`).join("\n")
          : "*None yet — use `=add artist name` to start tracking*",
        inline: false,
      }
    )
    .setFooter({ text: "Night Stars • Music" });
}

function buildMusicPanelComponents(): ActionRowBuilder<any>[] {
  return [
    new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId("mu_dj_role")
        .setPlaceholder("Select DJ Role")
        .setMinValues(0)
        .setMaxValues(1)
    ),
    new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId("mu_channel")
        .setPlaceholder("Select Notification Channel")
        .addChannelTypes(ChannelType.GuildText)
        .setMinValues(0)
        .setMaxValues(1)
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("mu_reset")
        .setLabel("🗑️ Reset Config")
        .setStyle(ButtonStyle.Danger)
    ),
  ];
}

export async function openMusicPanel(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.reply({
    embeds: [await buildMusicPanelEmbed(interaction.guildId!)],
    components: buildMusicPanelComponents(),
    ephemeral: true,
  });
}

export async function handleMusicDjRoleSelect(interaction: RoleSelectMenuInteraction): Promise<void> {
  const guildId = interaction.guildId!;
  const cfg     = await getMusicConfig(guildId);
  const roleId  = interaction.values[0] ?? null;
  await saveMusicConfig(guildId, roleId, cfg.notification_channel_id);
  await interaction.update({
    embeds: [await buildMusicPanelEmbed(guildId)],
    components: buildMusicPanelComponents(),
  });
}

export async function handleMusicChannelSelect(interaction: ChannelSelectMenuInteraction): Promise<void> {
  const guildId   = interaction.guildId!;
  const cfg       = await getMusicConfig(guildId);
  const channelId = interaction.values[0] ?? null;
  await saveMusicConfig(guildId, cfg.dj_role_id, channelId);
  await interaction.update({
    embeds: [await buildMusicPanelEmbed(guildId)],
    components: buildMusicPanelComponents(),
  });
}

export async function handleMusicReset(interaction: ButtonInteraction): Promise<void> {
  await saveMusicConfig(interaction.guildId!, null, null);
  await interaction.update({
    embeds: [await buildMusicPanelEmbed(interaction.guildId!)],
    components: buildMusicPanelComponents(),
  });
}
