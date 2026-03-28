import { EmbedBuilder, ActionRowBuilder, ChannelSelectMenuBuilder, PermissionsBitField, REST, Routes, SlashCommandBuilder, ChannelType, } from "discord.js";
import { isMainGuild } from "../utils/guildFilter.js";
import { openVerifyPanel, handleVerifyPanelSelect, handleVerifyPanelSave, handleVerifyPanelReset, openEditQuestionsModal, handleEditQuestionsSubmit, openEmbedCustomizeModal, handleEmbedCustomizeSubmit, handleEmbedPreviewBack, } from "./verification.js";
import { deployVerificationPanel } from "../modules/verification/index.js";
import { openAutoRolePanel, handleAutoRoleSelect, handleAutoRoleSave, handleAutoRoleClear, } from "./autorole.js";
function buildDeployChannelSelect() {
    return {
        embed: new EmbedBuilder()
            .setColor(0x5000ff)
            .setTitle("📌 Post Verification Panel")
            .setDescription("Select the channel to post the verification button in.")
            .setFooter({ text: "Stargate • NSV" }),
        row: new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder()
            .setCustomId("deploy_verify_channel")
            .setPlaceholder("Select a channel...")
            .addChannelTypes(ChannelType.GuildText)
            .setMinValues(1)
            .setMaxValues(1)),
    };
}
function buildVerificationHelpEmbed() {
    return new EmbedBuilder()
        .setColor(0x5000ff)
        .setTitle("🔐 Stargate — Verification System")
        .setDescription("Stargate handles all member verification for Night Stars.")
        .addFields({
        name: "How It Works",
        value: [
            "1. Members click **Start Verification** on the verification panel.",
            "2. They fill in 5 questions in a modal.",
            "3. Their answers appear in the requests channel, pinging the Verificators role.",
            "4. Staff click **Accept**, **Deny**, **Jail**, or **Ticket** to action the request.",
            "5. The member gets a DM with the outcome.",
        ].join("\n"),
        inline: false,
    }, {
        name: "⚙️ Setup (Admin only)",
        value: "`/setup verification` — Opens the full configuration panel",
        inline: false,
    }, {
        name: "Configuration Options",
        value: [
            "**Verificators Role** — Role that gets pinged on new applications and can action them",
            "**Requests Channel** — Where verification applications are sent",
            "**Logs Channel** — Where accept/deny/jail outcomes are logged (optional)",
            "**Verified / Unverified / Jail Roles** — Automatically assigned on outcome",
            "**Questions** — Customise the 5 questions members answer",
            "**Panel Embed** — Customise the title and description of the verification panel",
        ].join("\n"),
        inline: false,
    })
        .setFooter({ text: "Stargate • Night Stars Verification" });
}
export async function registerPanelCommands(client) {
    const token = process.env.STARGATE_TOKEN;
    if (!token)
        throw new Error("STARGATE_TOKEN is missing");
    const setupCommand = new SlashCommandBuilder()
        .setName("setup")
        .setDescription("Configure the Stargate verification system")
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addSubcommand((sub) => sub.setName("verification").setDescription("Set up the Night Stars Verification system (NSV)"))
        .addSubcommand((sub) => sub.setName("autorole").setDescription("Set roles to auto-assign when a member or bot joins"))
        .toJSON();
    const helpCommand = new SlashCommandBuilder()
        .setName("help")
        .setDescription("Show how to use Stargate")
        .addSubcommand((sub) => sub.setName("verification").setDescription("How the verification system works"))
        .toJSON();
    const rest = new REST().setToken(token);
    const registerForGuild = async (guildId, guildName) => {
        try {
            await rest.put(Routes.applicationGuildCommands(client.user.id, guildId), {
                body: [setupCommand, helpCommand],
            });
            console.log(`[Stargate] Slash commands registered for: ${guildName}`);
        }
        catch (err) {
            console.error(`[Stargate] Failed to register commands for ${guildName}:`, err);
        }
    };
    for (const guild of client.guilds.cache.values()) {
        await registerForGuild(guild.id, guild.name);
    }
    client.on("guildCreate", async (guild) => {
        await registerForGuild(guild.id, guild.name);
    });
    client.on("interactionCreate", async (interaction) => {
        if (!interaction.guild)
            return;
        if (!isMainGuild(interaction.guild.id))
            return;
        if (interaction.isChatInputCommand()) {
            const name = interaction.commandName;
            if (name === "setup") {
                const sub = interaction.options.getSubcommand();
                if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
                    await interaction.reply({
                        embeds: [new EmbedBuilder().setColor(0x5000ff).setDescription("❌ You need **Administrator** permission to use this.")],
                        ephemeral: true,
                    });
                    return;
                }
                await interaction.deferReply({ ephemeral: true });
                if (sub === "verification") {
                    await openVerifyPanel(interaction);
                }
                else if (sub === "autorole") {
                    await openAutoRolePanel(interaction);
                }
            }
            if (name === "help") {
                const sub = interaction.options.getSubcommand();
                if (sub === "verification") {
                    await interaction.reply({ embeds: [buildVerificationHelpEmbed()], ephemeral: true });
                }
            }
            return;
        }
        if (interaction.isButton()) {
            const panelIds = [
                "panel_deploy_verify",
                "vp_save", "vp_reset", "vp_edit_questions", "vp_edit_embed", "vp_embed_back",
                "ar_save", "ar_clear",
            ];
            if (panelIds.includes(interaction.customId)) {
                await handleButtonInteraction(interaction);
            }
            return;
        }
        if (interaction.isRoleSelectMenu()) {
            if (["vp_verificators_role", "vp_roles_group"].includes(interaction.customId)) {
                await handleVerifyPanelSelect(interaction);
            }
            else if (["ar_member_role", "ar_bot_role"].includes(interaction.customId)) {
                await handleAutoRoleSelect(interaction);
            }
            return;
        }
        if (interaction.isChannelSelectMenu()) {
            if (interaction.customId === "deploy_verify_channel") {
                await handleDeployChannelSelect(interaction);
            }
            else if (["vp_requests_channel", "vp_logs_channel"].includes(interaction.customId)) {
                await handleVerifyPanelSelect(interaction);
            }
            return;
        }
        if (interaction.isModalSubmit()) {
            if (interaction.customId === "vp_questions_modal") {
                try {
                    await handleEditQuestionsSubmit(interaction);
                }
                catch (err) {
                    console.error("[Stargate] Questions modal error:", err);
                }
            }
            else if (interaction.customId === "vp_embed_modal") {
                try {
                    await handleEmbedCustomizeSubmit(interaction);
                }
                catch (err) {
                    console.error("[Stargate] Embed modal error:", err);
                }
            }
        }
    });
}
async function handleButtonInteraction(interaction) {
    const { customId } = interaction;
    if (customId === "vp_save") {
        await handleVerifyPanelSave(interaction);
    }
    else if (customId === "vp_reset") {
        await handleVerifyPanelReset(interaction);
    }
    else if (customId === "vp_edit_questions") {
        await openEditQuestionsModal(interaction);
    }
    else if (customId === "vp_edit_embed") {
        await openEmbedCustomizeModal(interaction);
    }
    else if (customId === "vp_embed_back") {
        await handleEmbedPreviewBack(interaction);
    }
    else if (customId === "panel_deploy_verify") {
        const { embed, row } = buildDeployChannelSelect();
        await interaction.update({ embeds: [embed], components: [row] });
    }
    else if (customId === "ar_save") {
        await handleAutoRoleSave(interaction);
    }
    else if (customId === "ar_clear") {
        await handleAutoRoleClear(interaction);
    }
}
async function handleDeployChannelSelect(interaction) {
    const channelId = interaction.values[0];
    const channel = interaction.guild.channels.cache.get(channelId);
    if (!channel) {
        await interaction.update({
            embeds: [new EmbedBuilder().setColor(0xed4245).setDescription("❌ Channel not found.")],
            components: [],
        });
        return;
    }
    await deployVerificationPanel(channel);
    await interaction.update({
        embeds: [
            new EmbedBuilder()
                .setColor(0x57f287)
                .setTitle("✅ Panel Posted")
                .setDescription(`Verification panel posted in <#${channelId}>.`)
                .setFooter({ text: "Stargate • NSV" }),
        ],
        components: [],
    });
}
