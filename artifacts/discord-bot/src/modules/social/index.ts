import {
  Client,
  EmbedBuilder,
  Message,
  GuildMember,
  ButtonInteraction,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import { pool } from "@workspace/db";
import { isMainGuild } from "../../utils/guildFilter.js";

const COLOR = 0xff5e9c;
const REQUEST_TTL_MS = 10 * 60 * 1000;
const MAX_CHILDREN = 3;

async function getPrefix(guildId: string): Promise<string> {
  const r = await pool.query<{ pvs_prefix: string | null }>(
    "select pvs_prefix from bot_config where guild_id = $1 limit 1",
    [guildId],
  );
  return r.rows[0]?.pvs_prefix ?? "=";
}

export async function ensureSocialSchema(): Promise<void> {
  await pool.query(`
    create table if not exists social_relationships (
      guild_id text not null,
      owner_id text not null,
      partner_id text not null,
      since timestamp default now() not null,
      primary key (guild_id, owner_id)
    );
    create table if not exists social_children (
      guild_id text not null,
      parent_id text not null,
      child_id text not null,
      since timestamp default now() not null,
      primary key (guild_id, parent_id, child_id)
    );
    create table if not exists social_pending (
      id serial primary key,
      guild_id text not null,
      kind text not null,
      group_id text not null,
      requester_id text not null,
      target_id text not null,
      related_user_id text,
      created_at timestamp default now() not null,
      expires_at timestamp not null,
      status text default 'pending' not null
    );
    create index if not exists social_pending_target_idx
      on social_pending (guild_id, target_id, status);
    create index if not exists social_pending_group_idx
      on social_pending (group_id);
  `);
}

function embed(description: string, title?: string) {
  const e = new EmbedBuilder().setColor(COLOR).setDescription(description);
  if (title) e.setTitle(title);
  e.setFooter({ text: "Night Stars \u2022 Social" });
  return e;
}

function decisionButtons(groupId: string, disabled = false) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`soc_accept:${groupId}`)
      .setLabel("Accept")
      .setEmoji("\u2705")
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`soc_reject:${groupId}`)
      .setLabel("Reject")
      .setEmoji("\u274C")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled),
  );
}

async function sendTemp(message: Message, e: EmbedBuilder, ttl = 10000) {
  const sent = await message.channel.send({ embeds: [e] }).catch(() => null);
  if (sent) setTimeout(() => sent.delete().catch(() => {}), ttl);
}

async function sendPermanent(message: Message, e: EmbedBuilder) {
  await message.channel.send({ embeds: [e] }).catch(() => null);
}

async function expireOld(guildId: string) {
  await pool.query(
    "update social_pending set status='expired' where guild_id=$1 and status='pending' and expires_at < now()",
    [guildId],
  );
}

export async function getPartner(guildId: string, userId: string): Promise<string | null> {
  const r = await pool.query<{ partner_id: string }>(
    "select partner_id from social_relationships where guild_id=$1 and owner_id=$2 limit 1",
    [guildId, userId],
  );
  return r.rows[0]?.partner_id ?? null;
}

function extractTargetId(content: string, message: Message): string | null {
  const mention = message.mentions.users.first();
  if (mention) return mention.id;
  const m = content.match(/\b(\d{17,20})\b/);
  return m?.[1] ?? null;
}

async function fetchMember(message: Message, userId: string): Promise<GuildMember | null> {
  if (!message.guild) return null;
  return await message.guild.members.fetch(userId).catch(() => null);
}

// ── COMMAND HANDLERS ────────────────────────────────────────────────────────

async function cmdRelationship(message: Message, requesterId: string, content: string) {
  const taggedId = extractTargetId(content, message);
  const userId = taggedId ?? requesterId;
  const partner = await getPartner(message.guild!.id, userId);
  const subject = userId === requesterId ? "You are" : `<@${userId}> is`;
  if (!partner) {
    await sendPermanent(
      message,
      embed(`${subject} currently **single** \uD83D\uDC94`, "Relationship Status"),
    );
    return;
  }
  const r = await pool.query<{ since: Date }>(
    "select since from social_relationships where guild_id=$1 and owner_id=$2 limit 1",
    [message.guild!.id, userId],
  );
  const since = r.rows[0]?.since;
  await sendPermanent(
    message,
    embed(
      `${subject} in a relationship with <@${partner}> \uD83D\uDC95` +
        (since ? `\nTogether since <t:${Math.floor(since.getTime() / 1000)}:D>` : ""),
      "Relationship Status",
    ),
  );
}

async function cmdPropose(message: Message, requesterId: string, content: string) {
  const guildId = message.guild!.id;
  const targetId = extractTargetId(content, message);
  if (!targetId) {
    await sendTemp(message, embed("Mention someone to propose to. Example: `propose @user`"));
    return;
  }
  if (targetId === requesterId) {
    await sendTemp(message, embed("You cannot propose to yourself."));
    return;
  }
  const targetMember = await fetchMember(message, targetId);
  if (!targetMember) {
    await sendTemp(message, embed("That user is not in this server."));
    return;
  }
  if (targetMember.user.bot) {
    await sendTemp(message, embed("You cannot propose to a bot."));
    return;
  }

  if (await getPartner(guildId, requesterId)) {
    await sendTemp(message, embed("You are already in a relationship. Use `breakup` first."));
    return;
  }
  if (await getPartner(guildId, targetId)) {
    await sendTemp(message, embed(`<@${targetId}> is already in a relationship.`));
    return;
  }

  await expireOld(guildId);
  const dup = await pool.query(
    `select 1 from social_pending
       where guild_id=$1 and kind='propose' and status='pending'
         and ((requester_id=$2 and target_id=$3) or (requester_id=$3 and target_id=$2))`,
    [guildId, requesterId, targetId],
  );
  if (dup.rowCount) {
    await sendTemp(message, embed("A proposal between you two is already pending."));
    return;
  }

  const groupId = `propose:${requesterId}:${targetId}:${Date.now()}`;
  const expires = new Date(Date.now() + REQUEST_TTL_MS);
  await pool.query(
    `insert into social_pending (guild_id, kind, group_id, requester_id, target_id, expires_at)
       values ($1,'propose',$2,$3,$4,$5)`,
    [guildId, groupId, requesterId, targetId, expires],
  );

  await message.channel.send({
    content: `<@${targetId}>`,
    embeds: [
      embed(
        `\uD83D\uDC8D <@${requesterId}> has proposed to <@${targetId}>!\n\nDo you accept?`,
        "Proposal",
      ),
    ],
    components: [decisionButtons(groupId)],
    allowedMentions: { users: [targetId] },
  });
}

async function cmdBreakup(message: Message, userId: string) {
  const guildId = message.guild!.id;
  const partner = await getPartner(guildId, userId);
  if (!partner) {
    await sendTemp(message, embed("You are not in a relationship."));
    return;
  }
  await pool.query(
    "delete from social_relationships where guild_id=$1 and (owner_id in ($2,$3))",
    [guildId, userId, partner],
  );
  await message.channel.send({
    embeds: [
      embed(
        `<@${userId}> and <@${partner}> have broken up. \uD83D\uDC94`,
        "Breakup",
      ),
    ],
  });
}

async function cmdChildren(message: Message, userId: string) {
  const guildId = message.guild!.id;
  const r = await pool.query<{ child_id: string; since: Date }>(
    "select child_id, since from social_children where guild_id=$1 and parent_id=$2 order by since asc",
    [guildId, userId],
  );
  if (!r.rowCount) {
    await sendPermanent(message, embed(`<@${userId}> has no children yet.`, "Children"));
    return;
  }
  const lines = r.rows.map(
    (row, i) => `**${i + 1}.** <@${row.child_id}> \u2014 since <t:${Math.floor(row.since.getTime() / 1000)}:D>`,
  );
  await sendPermanent(
    message,
    embed(lines.join("\n"), `Children of ${message.guild!.members.cache.get(userId)?.displayName ?? "user"} (${r.rowCount}/${MAX_CHILDREN})`),
  );
}

async function cmdAdopt(message: Message, requesterId: string, content: string) {
  const guildId = message.guild!.id;
  const childId = extractTargetId(content, message);
  if (!childId) {
    await sendTemp(message, embed("Mention someone to adopt. Example: `adopt @user`"));
    return;
  }
  if (childId === requesterId) {
    await sendTemp(message, embed("You cannot adopt yourself."));
    return;
  }
  const childMember = await fetchMember(message, childId);
  if (!childMember || childMember.user.bot) {
    await sendTemp(message, embed("That user is not a valid member."));
    return;
  }

  // Capacity check on requester
  const cnt = await pool.query<{ c: string }>(
    "select count(*)::text as c from social_children where guild_id=$1 and parent_id=$2",
    [guildId, requesterId],
  );
  if (parseInt(cnt.rows[0]?.c ?? "0", 10) >= MAX_CHILDREN) {
    await sendTemp(message, embed(`You already have the maximum of **${MAX_CHILDREN}** children.`));
    return;
  }

  // Duplicate check
  const dupChild = await pool.query(
    "select 1 from social_children where guild_id=$1 and parent_id=$2 and child_id=$3",
    [guildId, requesterId, childId],
  );
  if (dupChild.rowCount) {
    await sendTemp(message, embed("This user is already your child."));
    return;
  }

  const partner = await getPartner(guildId, requesterId);

  // If in relationship, partner capacity check
  if (partner) {
    const cnt2 = await pool.query<{ c: string }>(
      "select count(*)::text as c from social_children where guild_id=$1 and parent_id=$2",
      [guildId, partner],
    );
    if (parseInt(cnt2.rows[0]?.c ?? "0", 10) >= MAX_CHILDREN) {
      await sendTemp(message, embed(`Your partner already has the maximum of **${MAX_CHILDREN}** children.`));
      return;
    }
    const dupP = await pool.query(
      "select 1 from social_children where guild_id=$1 and parent_id=$2 and child_id=$3",
      [guildId, partner, childId],
    );
    if (dupP.rowCount) {
      await sendTemp(message, embed("Your partner already has this user as a child."));
      return;
    }
  }

  await expireOld(guildId);
  const dupReq = await pool.query(
    `select 1 from social_pending
       where guild_id=$1 and kind='adopt' and status='pending'
         and requester_id=$2 and related_user_id=$3`,
    [guildId, requesterId, childId],
  );
  if (dupReq.rowCount) {
    await sendTemp(message, embed("You already have a pending adoption request for this user."));
    return;
  }

  const groupId = `adopt:${requesterId}:${childId}:${Date.now()}`;
  const expires = new Date(Date.now() + REQUEST_TTL_MS);

  // Insert child acceptance row
  await pool.query(
    `insert into social_pending (guild_id, kind, group_id, requester_id, target_id, related_user_id, expires_at)
       values ($1,'adopt',$2,$3,$4,$4,$5)`,
    [guildId, groupId, requesterId, childId, expires],
  );
  // If in relationship, also need partner approval
  if (partner) {
    await pool.query(
      `insert into social_pending (guild_id, kind, group_id, requester_id, target_id, related_user_id, expires_at)
         values ($1,'adopt',$2,$3,$4,$5,$6)`,
      [guildId, groupId, requesterId, partner, childId, expires],
    );
  }

  const targets = partner ? [childId, partner] : [childId];
  const lines = [
    `\uD83D\uDC76 <@${requesterId}> wants to adopt <@${childId}>!`,
    "",
    partner
      ? `Both <@${childId}> and <@${partner}> must accept.`
      : `<@${childId}>, do you accept?`,
  ];
  await message.channel.send({
    content: targets.map((id) => `<@${id}>`).join(" "),
    embeds: [embed(lines.join("\n"), "Adoption Request")],
    components: [decisionButtons(groupId)],
    allowedMentions: { users: targets },
  });
}

// ── BUTTON HANDLER ──────────────────────────────────────────────────────────

export async function handleSocialButton(interaction: ButtonInteraction) {
  const guildId = interaction.guild?.id;
  if (!guildId) return;
  const firstColon = interaction.customId.indexOf(":");
  const action = interaction.customId.slice(0, firstColon);
  const groupId = interaction.customId.slice(firstColon + 1);
  if (!groupId) return;
  const accept = action === "soc_accept";
  const userId = interaction.user.id;

  await expireOld(guildId);

  // Find this user's pending row in this group
  const r = await pool.query<{
    id: number;
    kind: string;
    requester_id: string;
    target_id: string;
    related_user_id: string | null;
  }>(
    `select id, kind, requester_id, target_id, related_user_id
       from social_pending
      where group_id=$1 and target_id=$2 and status='pending'
      limit 1`,
    [groupId, userId],
  );
  const row = r.rows[0];
  if (!row) {
    await interaction.reply({ content: "This decision isn't yours, or it has already expired.", ephemeral: true });
    return;
  }

  if (!accept) {
    await pool.query("update social_pending set status='rejected' where group_id=$1 and status='pending'", [groupId]);
    const title = row.kind === "propose" ? "\uD83D\uDC94 Proposal Rejected" : "\uD83D\uDEAB Adoption Rejected";
    const msg = row.kind === "propose"
      ? `<@${userId}> rejected the proposal from <@${row.requester_id}>.`
      : `<@${userId}> rejected the adoption request from <@${row.requester_id}>.`;
    await interaction.update({
      embeds: [embed(msg, title)],
      components: [decisionButtons(groupId, true)],
    });
    return;
  }

  await pool.query("update social_pending set status='accepted' where id=$1", [row.id]);

  if (row.kind === "propose") {
    const requesterPartner = await getPartner(guildId, row.requester_id);
    const targetPartner = await getPartner(guildId, row.target_id);
    if (requesterPartner || targetPartner) {
      await interaction.update({
        embeds: [embed("One of you is already in a relationship now. Request cancelled.", "Cancelled")],
        components: [decisionButtons(groupId, true)],
      });
      return;
    }
    await pool.query(
      `insert into social_relationships (guild_id, owner_id, partner_id) values ($1,$2,$3),($1,$3,$2)
       on conflict (guild_id, owner_id) do nothing`,
      [guildId, row.requester_id, row.target_id],
    );
    await interaction.update({
      embeds: [
        embed(
          `\uD83C\uDF89 <@${row.requester_id}> and <@${row.target_id}> are now in a relationship! \uD83D\uDC95`,
          "Proposal Accepted",
        ),
      ],
      components: [decisionButtons(groupId, true)],
    });
    return;
  }

  if (row.kind === "adopt") {
    const stillPending = await pool.query(
      "select 1 from social_pending where group_id=$1 and status='pending'",
      [groupId],
    );
    if (stillPending.rowCount) {
      // Still need other party — re-render same embed but mark this party's button visually consumed.
      await interaction.reply({ content: `\u2705 You accepted. Waiting for the other party...`, ephemeral: true });
      return;
    }
    const childId = row.related_user_id!;
    const requesterId = row.requester_id;
    const partner = await getPartner(guildId, requesterId);

    const cnt = await pool.query<{ c: string }>(
      "select count(*)::text as c from social_children where guild_id=$1 and parent_id=$2",
      [guildId, requesterId],
    );
    if (parseInt(cnt.rows[0]?.c ?? "0", 10) >= MAX_CHILDREN) {
      await interaction.update({
        embeds: [embed(`<@${requesterId}> already has ${MAX_CHILDREN} children. Cancelled.`, "Cancelled")],
        components: [decisionButtons(groupId, true)],
      });
      return;
    }
    if (partner) {
      const cnt2 = await pool.query<{ c: string }>(
        "select count(*)::text as c from social_children where guild_id=$1 and parent_id=$2",
        [guildId, partner],
      );
      if (parseInt(cnt2.rows[0]?.c ?? "0", 10) >= MAX_CHILDREN) {
        await interaction.update({
          embeds: [embed(`<@${partner}> already has ${MAX_CHILDREN} children. Cancelled.`, "Cancelled")],
          components: [decisionButtons(groupId, true)],
        });
        return;
      }
    }

    await pool.query(
      `insert into social_children (guild_id, parent_id, child_id) values ($1,$2,$3)
       on conflict do nothing`,
      [guildId, requesterId, childId],
    );
    if (partner) {
      await pool.query(
        `insert into social_children (guild_id, parent_id, child_id) values ($1,$2,$3)
         on conflict do nothing`,
        [guildId, partner, childId],
      );
    }
    await pool.query("update social_pending set status='completed' where group_id=$1", [groupId]);

    const parents = partner ? `<@${requesterId}> and <@${partner}>` : `<@${requesterId}>`;
    await interaction.update({
      embeds: [
        embed(
          `\uD83C\uDF89 <@${childId}> has been adopted by ${parents}! \uD83D\uDC76`,
          "Adoption Complete",
        ),
      ],
      components: [decisionButtons(groupId, true)],
    });
  }
}

// ── REGISTRATION ────────────────────────────────────────────────────────────

export function registerSocialModule(client: Client) {
  client.on("messageCreate", async (message: Message) => {
    try {
      if (message.author.bot) return;
      if (!message.guild) return;
      if (!isMainGuild(message.guild.id)) return;

      const prefix = await getPrefix(message.guild.id);
      if (!message.content.startsWith(prefix)) return;
      const body = message.content.slice(prefix.length).trim();
      if (!body) return;
      const lower = body.toLowerCase();
      const first = lower.split(/\s+/)[0];

      const userId = message.author.id;
      const known = ["relationship", "propose", "breakup", "children", "adopt"];
      if (!known.includes(first)) return;

      switch (first) {
        case "relationship":
          await cmdRelationship(message, userId, body.slice("relationship".length));
          break;
        case "propose":
          await cmdPropose(message, userId, body.slice("propose".length));
          break;
        case "breakup":
          await cmdBreakup(message, userId);
          break;
        case "children":
          await cmdChildren(message, userId);
          break;
        case "adopt":
          await cmdAdopt(message, userId, body.slice("adopt".length));
          break;
      }
    } catch (err) {
      console.error("[Social] handler error:", err);
    }
  });
}
