const { slugify, buildPanel } = require('../utils/panel.js');

async function logRoleAction(guild, dynamicRoles, member, opt, cat, action) {
  if (!dynamicRoles.logChannelId) return;
  try {
    const channel = await guild.channels.fetch(dynamicRoles.logChannelId);
    if (!channel || !channel.isTextBased()) return;
    const emoji = action === 'added' ? '✅' : '❌';
    const verb = action === 'added' ? 'added' : 'removed';
    await channel.send(
      `${emoji} **${member.user.tag}** (${member.id}) ${verb} role **${opt.label}** in category **${cat.name}**.`
    );
  } catch (e) {
    console.error('Failed to log role action:', e.message);
  }
}

async function handlePanelInteraction(interaction, dynamicRoles) {
  const { customId, values, member, guild } = interaction;

  if (!customId.startsWith('cat:')) return;

  if (!member || !guild) {
    await interaction.reply({ content: 'This can only be used in a server.', ephemeral: true });
    return;
  }

  // Check required role
  if (dynamicRoles.requiredRoleId) {
    if (!member.roles.cache.has(dynamicRoles.requiredRoleId)) {
      await interaction.reply({
        content: '❌ You need a specific role to use this panel. Contact an admin.',
        ephemeral: true,
      });
      return;
    }
  }

  const catId = customId.slice('cat:'.length);
  const cat = (dynamicRoles.categories || []).find(c => c.id === catId);

  if (!cat) return;

  await interaction.deferUpdate();

  try {
    const selectedValue = values[0];
    const opt = cat.options.find(r => slugify(r.label) === selectedValue);

    if (!opt || !opt.roleId) {
      await interaction.followUp({ content: '❌ Role not found. Contact an admin.', ephemeral: true });
      return;
    }

    const hasRole = member.roles.cache.has(opt.roleId);

    if (hasRole) {
      await member.roles.remove(opt.roleId);
      await logRoleAction(guild, dynamicRoles, member, opt, cat, 'removed');
      await interaction.followUp({
        content: `❌  Removed the **${opt.label}** role.`,
        ephemeral: true,
      });
    } else {
      // Check role limit for this category
      if (cat.roleLimit) {
        const catRoleIds = cat.options.filter(o => o.roleId).map(o => o.roleId);
        const currentCount = catRoleIds.filter(rid => member.roles.cache.has(rid)).length;
        if (currentCount >= cat.roleLimit) {
          await interaction.followUp({
            content: `❌ You can only have **${cat.roleLimit}** role(s) in **${cat.name}**. Remove one first.`,
            ephemeral: true,
          });
          const panelData = await buildPanel(dynamicRoles, guild);
          await interaction.editReply(panelData);
          return;
        }
      }

      await member.roles.add(opt.roleId);
      await logRoleAction(guild, dynamicRoles, member, opt, cat, 'added');
      await interaction.followUp({
        content: `✅  You now have the **${opt.label}** role!`,
        ephemeral: true,
      });
    }

    const panelData = await buildPanel(dynamicRoles, guild);
    await interaction.editReply(panelData);

  } catch (err) {
    console.error('Error handling panel interaction:', err);
    await interaction.followUp({
      content: '❌ Something went wrong. Make sure the bot has the **Manage Roles** permission.',
      ephemeral: true,
    });
  }
}

module.exports = { handlePanelInteraction };
