import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, RoleSelectMenuBuilder, } from "discord.js";
import { db } from "@workspace/db";
import { botConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";
export const autoRoleState = new Map();
function buildAutoRoleEmbed(state) {
    return new EmbedBuilder()
        .setColor(0x5000ff)
        .setTitle("⚙️ Auto-Role Setup")
        .setDescription("Configure roles to automatically assign when someone joins the server.\n" +
        "Both settings are optional — leave unset to skip auto-assignment.")
        .addFields({
        name: "👤 Member Role",
        value: state.memberRoleId ? `<@&${state.memberRoleId}>` : "_Not set_",
        inline: true,
    }, {
        name: "🤖 Bot Role",
        value: state.botRoleId ? `<@&${state.botRoleId}>` : "_Not set_",
        inline: true,
    })
        .setFooter({ text: "Stargate • Auto-Role" });
}
function buildAutoRoleComponents(state) {
    const row1 = new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder()
        .setCustomId("ar_member_role")
        .setPlaceholder(state.memberRoleId ? "Member Role (set)" : "Member Role — assigned to humans...")
        .setMinValues(0)
        .setMaxValues(1));
    const row2 = new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder()
        .setCustomId("ar_bot_role")
        .setPlaceholder(state.botRoleId ? "Bot Role (set)" : "Bot Role — assigned to bots...")
        .setMinValues(0)
        .setMaxValues(1));
    const row3 = new ActionRowBuilder().addComponents(new ButtonBuilder()
        .setCustomId("ar_save")
        .setLabel("Save")
        .setStyle(ButtonStyle.Success), new ButtonBuilder()
        .setCustomId("ar_clear")
        .setLabel("Clear Both")
        .setStyle(ButtonStyle.Danger));
    return [row1, row2, row3];
}
export async function openAutoRolePanel(interaction) {
    const userId = interaction.user.id;
    const [cfg] = await db
        .select({ autoMemberRoleId: botConfigTable.autoMemberRoleId, autoBotRoleId: botConfigTable.autoBotRoleId })
        .from(botConfigTable)
        .where(eq(botConfigTable.guildId, interaction.guild.id))
        .limit(1);
    const state = {
        memberRoleId: cfg?.autoMemberRoleId ?? undefined,
        botRoleId: cfg?.autoBotRoleId ?? undefined,
    };
    autoRoleState.set(userId, state);
    const payload = {
        embeds: [buildAutoRoleEmbed(state)],
        components: buildAutoRoleComponents(state),
    };
    if (interaction.deferred || interaction.replied) {
        await interaction.editReply(payload);
    }
    else {
        await interaction.reply({ ...payload, ephemeral: true });
    }
}
export async function handleAutoRoleSelect(interaction) {
    const userId = interaction.user.id;
    const state = autoRoleState.get(userId) ?? {};
    if (interaction.customId === "ar_member_role") {
        state.memberRoleId = interaction.values[0] ?? undefined;
    }
    else if (interaction.customId === "ar_bot_role") {
        state.botRoleId = interaction.values[0] ?? undefined;
    }
    autoRoleState.set(userId, state);
    await interaction.update({
        embeds: [buildAutoRoleEmbed(state)],
        components: buildAutoRoleComponents(state),
    });
}
export async function handleAutoRoleSave(interaction) {
    const userId = interaction.user.id;
    const state = autoRoleState.get(userId) ?? {};
    const guildId = interaction.guild.id;
    const existing = await db
        .select({ id: botConfigTable.id })
        .from(botConfigTable)
        .where(eq(botConfigTable.guildId, guildId))
        .limit(1);
    if (existing.length) {
        await db.update(botConfigTable).set({
            autoMemberRoleId: state.memberRoleId ?? null,
            autoBotRoleId: state.botRoleId ?? null,
            updatedAt: new Date(),
        }).where(eq(botConfigTable.guildId, guildId));
    }
    else {
        await db.insert(botConfigTable).values({
            guildId,
            autoMemberRoleId: state.memberRoleId ?? null,
            autoBotRoleId: state.botRoleId ?? null,
        });
    }
    autoRoleState.delete(userId);
    await interaction.update({
        embeds: [
            new EmbedBuilder()
                .setColor(0x57f287)
                .setTitle("✅ Auto-Role Saved")
                .addFields({
                name: "👤 Member Role",
                value: state.memberRoleId ? `<@&${state.memberRoleId}>` : "_Disabled_",
                inline: true,
            }, {
                name: "🤖 Bot Role",
                value: state.botRoleId ? `<@&${state.botRoleId}>` : "_Disabled_",
                inline: true,
            })
                .setFooter({ text: "Stargate • Auto-Role" }),
        ],
        components: [],
    });
}
export async function handleAutoRoleClear(interaction) {
    const guildId = interaction.guild.id;
    const existing = await db
        .select({ id: botConfigTable.id })
        .from(botConfigTable)
        .where(eq(botConfigTable.guildId, guildId))
        .limit(1);
    if (existing.length) {
        await db.update(botConfigTable).set({
            autoMemberRoleId: null,
            autoBotRoleId: null,
            updatedAt: new Date(),
        }).where(eq(botConfigTable.guildId, guildId));
    }
    autoRoleState.delete(interaction.user.id);
    await interaction.update({
        embeds: [
            new EmbedBuilder()
                .setColor(0xed4245)
                .setTitle("🗑️ Auto-Role Cleared")
                .setDescription("Both auto-roles have been disabled. No roles will be assigned on join.")
                .setFooter({ text: "Stargate • Auto-Role" }),
        ],
        components: [],
    });
}
