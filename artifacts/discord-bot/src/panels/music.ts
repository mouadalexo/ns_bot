import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  ButtonInteraction,
  RoleSelectMenuInteraction,
  ChannelSelectMenuInteraction,
  StringSelectMenuInteraction,
  ModalSubmitInteraction,
  RoleSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
} from "discord.js";
import { pool } from "@workspace/db";
import {
  searchArtists,
  commitAddArtist,
  removeArtistById,
  resolveArtistFromDeezerLink,
  pendingAdd,
  type DeezerArtist,
} from "../modules/music/index.js";

const MUSIC_COLOR = 0x5000ff;

interface MusicConfigRow {
  dj_role_id: string | null;
  notification_channel_id: string | null;
  playlist_role_id: string | null;
  playlist_channel_ids_json: string | null;
}

async function getMusicConfig(guildId: string): Promise<MusicConfigRow> {
  const res = await pool.query<MusicConfigRow>(
    "SELECT dj_role_id, notification_channel_id, playlist_role_id, playlist_channel_ids_json FROM music_config WHERE guild_id = $1",
    [guildId]
  );
  return res.rows[0] ?? {
    dj_role_id: null,
    notification_channel_id: null,
    playlist_role_id: null,
    playlist_channel_ids_json: "[]",
  };
}

function parsePlaylistChannelIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

interface MusicConfigPatch {
  djRoleId?: string | null;
  channelId?: string | null;
  playlistRoleId?: string | null;
  playlistChannelIds?: string[];
}

async function upsertMusicConfig(guildId: string, patch: MusicConfigPatch): Promise<void> {
  const current = await getMusicConfig(guildId);
  const djRoleId   = patch.djRoleId   !== undefined ? patch.djRoleId   : current.dj_role_id;
  const channelId  = patch.channelId  !== undefined ? patch.channelId  : current.notification_channel_id;
  const plRoleId   = patch.playlistRoleId !== undefined ? patch.playlistRoleId : current.playlist_role_id;
  const plChannels = patch.playlistChannelIds !== undefined
    ? JSON.stringify(patch.playlistChannelIds)
    : (current.playlist_channel_ids_json ?? "[]");

  await pool.query(
    `INSERT INTO music_config (guild_id, dj_role_id, notification_channel_id, playlist_role_id, playlist_channel_ids_json)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (guild_id) DO UPDATE
       SET dj_role_id = $2,
           notification_channel_id = $3,
           playlist_role_id = $4,
           playlist_channel_ids_json = $5,
           updated_at = now()`,
    [guildId, djRoleId, channelId, plRoleId, plChannels]
  );
}

async function getTrackedArtists(guildId: string): Promise<{ deezer_artist_id: string; artist_name: string }[]> {
  const res = await pool.query<{ deezer_artist_id: string; artist_name: string }>(
    "SELECT deezer_artist_id, artist_name FROM music_artists WHERE guild_id = $1 ORDER BY added_at ASC",
    [guildId]
  );
  return res.rows;
}

async function buildMusicPanelEmbed(guildId: string): Promise<EmbedBuilder> {
  const cfg     = await getMusicConfig(guildId);
  const artists = await getTrackedArtists(guildId);
  const playlistChannels = parsePlaylistChannelIds(cfg.playlist_channel_ids_json);

  return new EmbedBuilder()
    .setColor(MUSIC_COLOR)
    .setTitle("🎵 Music Release System")
    .setDescription(
      "**Album flow:** `=post <link>` posts the album embed with a 🔗 button.\n" +
      "**Playlist flow:** `=postplaylist <link>` posts a playlist embed with a 🔗 button.\n" +
      "**List artists:** `=artists` shows everyone you're tracking."
    )
    .addFields(
      {
        name: "🎤 DJ Role (albums)",
        value: cfg.dj_role_id ? `<@&${cfg.dj_role_id}>` : "*Not set*",
        inline: true,
      },
      {
        name: "📢 Album Channel",
        value: cfg.notification_channel_id ? `<#${cfg.notification_channel_id}>` : "*Not set*",
        inline: true,
      },
      {
        name: "\u200b",
        value: "\u200b",
        inline: true,
      },
      {
        name: "🎧 Playlist Role",
        value: cfg.playlist_role_id ? `<@&${cfg.playlist_role_id}>` : "*Not set — DJ role can also post playlists*",
        inline: true,
      },
      {
        name: "🎶 Playlist Rooms",
        value: playlistChannels.length
          ? playlistChannels.map((c) => `<#${c}>`).join(", ")
          : "*Any channel*",
        inline: true,
      },
      {
        name: "\u200b",
        value: "\u200b",
        inline: true,
      },
      {
        name: `Tracked Artists (${artists.length})`,
        value: artists.length
          ? artists.map((a, i) => `\`${(i + 1).toString().padStart(2, "0")}\` ${a.artist_name}`).join("\n").slice(0, 1024)
          : "*None yet — click **Add Artist** below*",
        inline: false,
      }
    )
    .setFooter({ text: "Night Stars • Music" });
}

function buildMusicPanelComponents(hasArtists: boolean): ActionRowBuilder<any>[] {
  return [
    new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId("mu_dj_role")
        .setPlaceholder("🎤 Select DJ Role (albums)")
        .setMinValues(0)
        .setMaxValues(1)
    ),
    new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId("mu_channel")
        .setPlaceholder("📢 Select Album Notification Channel")
        .addChannelTypes(ChannelType.GuildText)
        .setMinValues(0)
        .setMaxValues(1)
    ),
    new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId("mu_playlist_role")
        .setPlaceholder("🎧 Select Playlist Role")
        .setMinValues(0)
        .setMaxValues(1)
    ),
    new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId("mu_playlist_channels")
        .setPlaceholder("🎶 Select Playlist Rooms (multiple)")
        .addChannelTypes(ChannelType.GuildText)
        .setMinValues(0)
        .setMaxValues(10)
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("mu_add_artist")
        .setLabel("➕ Add Artist")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId("mu_remove_artist")
        .setLabel("➖ Remove Artist")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!hasArtists),
      new ButtonBuilder()
        .setCustomId("mu_reset")
        .setLabel("🗑️ Reset Config")
        .setStyle(ButtonStyle.Danger)
    ),
  ];
}

async function refreshPanel(
  interaction: ButtonInteraction | RoleSelectMenuInteraction | ChannelSelectMenuInteraction | StringSelectMenuInteraction
): Promise<void> {
  const guildId = interaction.guildId!;
  const artists = await getTrackedArtists(guildId);
  await interaction.update({
    embeds: [await buildMusicPanelEmbed(guildId)],
    components: buildMusicPanelComponents(artists.length > 0),
  });
}

export async function openMusicPanel(interaction: ChatInputCommandInteraction): Promise<void> {
  const guildId = interaction.guildId!;
  const artists = await getTrackedArtists(guildId);
  await interaction.reply({
    embeds: [await buildMusicPanelEmbed(guildId)],
    components: buildMusicPanelComponents(artists.length > 0),
    ephemeral: true,
  });
}

export async function handleMusicDjRoleSelect(interaction: RoleSelectMenuInteraction): Promise<void> {
  await upsertMusicConfig(interaction.guildId!, { djRoleId: interaction.values[0] ?? null });
  await refreshPanel(interaction);
}

export async function handleMusicChannelSelect(interaction: ChannelSelectMenuInteraction): Promise<void> {
  await upsertMusicConfig(interaction.guildId!, { channelId: interaction.values[0] ?? null });
  await refreshPanel(interaction);
}

export async function handleMusicPlaylistRoleSelect(interaction: RoleSelectMenuInteraction): Promise<void> {
  await upsertMusicConfig(interaction.guildId!, { playlistRoleId: interaction.values[0] ?? null });
  await refreshPanel(interaction);
}

export async function handleMusicPlaylistChannelsSelect(interaction: ChannelSelectMenuInteraction): Promise<void> {
  await upsertMusicConfig(interaction.guildId!, { playlistChannelIds: [...interaction.values] });
  await refreshPanel(interaction);
}

export async function handleMusicReset(interaction: ButtonInteraction): Promise<void> {
  await upsertMusicConfig(interaction.guildId!, {
    djRoleId: null,
    channelId: null,
    playlistRoleId: null,
    playlistChannelIds: [],
  });
  await refreshPanel(interaction);
}

export async function handleMusicAddArtistButton(interaction: ButtonInteraction): Promise<void> {
  const modal = new ModalBuilder()
    .setCustomId("mu_add_modal")
    .setTitle("Add Artist to Tracking")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("artist_query")
          .setLabel("Artist name OR Deezer link")
          .setPlaceholder("Daft Punk  —  or  —  https://deezer.com/artist/123")
          .setStyle(TextInputStyle.Short)
          .setMinLength(1)
          .setMaxLength(300)
          .setRequired(true)
      )
    );
  await interaction.showModal(modal);
}

export async function handleMusicAddModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  const query = interaction.fields.getTextInputValue("artist_query").trim();
  if (!query) {
    await interaction.reply({ content: "❌ Empty query.", ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  if (/^https?:\/\/(www\.)?deezer\.com\//i.test(query)) {
    const direct = await resolveArtistFromDeezerLink(query);
    if (!direct) {
      await interaction.editReply({
        content: `❌ Couldn't resolve that Deezer link. Make sure it's an artist, album, or track URL from \`deezer.com\`.`,
      });
      return;
    }
    const cfg = await getMusicConfig(interaction.guildId!);
    await commitAddArtist(interaction.client, interaction.guildId!, cfg.notification_channel_id, direct);
    await interaction.editReply({
      content: `✅ **${direct.name}** added to music tracking from link.\nReopen \`/music\` to see the updated list.`,
    });
    return;
  }

  const artists = await searchArtists(query);
  if (!artists.length) {
    await interaction.editReply({
      content: `❌ No artist found for \`${query}\` on Deezer.\n\n💡 **Tip:** open the artist's page on Deezer, copy the link from the address bar, and paste it here instead.`,
    });
    return;
  }

  if (artists.length === 1) {
    const cfg = await getMusicConfig(interaction.guildId!);
    await commitAddArtist(interaction.client, interaction.guildId!, cfg.notification_channel_id, artists[0]);
    await interaction.editReply({
      content: `✅ **${artists[0].name}** added to music tracking.\nReopen \`/music\` to see the updated list.`,
    });
    return;
  }

  pendingAdd.set(interaction.user.id, {
    artists,
    guildId: interaction.guildId!,
    channelId: interaction.channelId ?? "",
  });

  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  artists.forEach((a, i) => {
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`mu_pick:${interaction.user.id}:${i}`)
          .setLabel(`${i + 1}. ${a.name}${a.nb_fan ? ` (${(a.nb_fan / 1000).toFixed(0)}K fans)` : ""}`)
          .setStyle(ButtonStyle.Primary)
      )
    );
  });
  rows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`mu_pick_cancel:${interaction.user.id}`)
        .setLabel("✕ Cancel")
        .setStyle(ButtonStyle.Secondary)
    )
  );

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(MUSIC_COLOR)
        .setTitle("🎵 Multiple matches found")
        .setDescription(`Pick the right artist for **${query}**:`)
        .addFields(
          artists.map((a, i) => ({
            name: `${i + 1}. ${a.name}`,
            value: `${(a.nb_fan ?? 0).toLocaleString()} fans`,
            inline: true,
          }))
        ),
    ],
    components: rows,
  });

  setTimeout(() => pendingAdd.delete(interaction.user.id), 60_000);
}

export async function handleMusicPickButton(interaction: ButtonInteraction): Promise<void> {
  const parts = interaction.customId.split(":");
  const userId = parts[1];
  const index  = parseInt(parts[2]);

  if (interaction.user.id !== userId) {
    await interaction.reply({ content: "❌ This is not your panel.", ephemeral: true });
    return;
  }

  const pending = pendingAdd.get(userId);
  if (!pending) {
    await interaction.update({ content: "❌ Session expired.", embeds: [], components: [] }).catch(() => {});
    return;
  }

  const artist: DeezerArtist | undefined = pending.artists[index];
  if (!artist) {
    await interaction.reply({ content: "❌ Invalid selection.", ephemeral: true });
    return;
  }

  pendingAdd.delete(userId);
  const cfg = await getMusicConfig(interaction.guildId!);
  await commitAddArtist(interaction.client, interaction.guildId!, cfg.notification_channel_id, artist);
  await interaction.update({
    content: `✅ **${artist.name}** added to music tracking.\nReopen \`/music\` to see the updated list.`,
    embeds: [],
    components: [],
  });
}

export async function handleMusicPickCancel(interaction: ButtonInteraction): Promise<void> {
  const userId = interaction.customId.split(":")[1];
  pendingAdd.delete(userId);
  await interaction.update({ content: "✕ Cancelled.", embeds: [], components: [] });
}

export async function handleMusicRemoveButton(interaction: ButtonInteraction): Promise<void> {
  const artists = await getTrackedArtists(interaction.guildId!);
  if (!artists.length) {
    await interaction.reply({ content: "❌ No artists tracked yet.", ephemeral: true });
    return;
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId("mu_remove_select")
    .setPlaceholder("Select an artist to remove")
    .setMinValues(1)
    .setMaxValues(Math.min(artists.length, 25))
    .addOptions(
      artists.slice(0, 25).map(a => ({
        label: a.artist_name.slice(0, 100),
        value: a.deezer_artist_id,
      }))
    );

  await interaction.reply({
    content: "Select one or more artists to stop tracking:",
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
    ephemeral: true,
  });
}

export async function handleMusicRemoveSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const guildId = interaction.guildId!;
  const removed: string[] = [];
  for (const id of interaction.values) {
    const ok = await removeArtistById(guildId, id);
    if (ok) removed.push(id);
  }

  await interaction.update({
    content: removed.length
      ? `✅ Removed **${removed.length}** artist${removed.length === 1 ? "" : "s"} from tracking.\nReopen \`/music\` to see the updated list.`
      : "❌ Nothing was removed.",
    components: [],
  });
}
