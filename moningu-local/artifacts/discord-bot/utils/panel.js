const {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  MessageFlags,
} = require('discord.js');

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

const CATEGORY_ICONS = {
  mobile_games: '📱',
  pc_games:     '🖥️',
  about_you:    '👤',
  status:       '💬',
};

function getCategoryIcon(catId) {
  return CATEGORY_ICONS[catId] || '🎭';
}

function resolveEmoji(emoji) {
  if (!emoji) return null;
  if (typeof emoji === 'object') return emoji;
  return emoji;
}

async function fetchEmoji(guild, emojiId) {
  if (!guild) return null;
  try {
    const emoji = await guild.emojis.fetch(emojiId);
    return emoji ? emoji.toString() : null;
  } catch {
    return null;
  }
}

async function buildPanel(dynamicRoles, guild) {
  const categories = (dynamicRoles.categories || []).slice(0, 5);

  const container = new ContainerBuilder().setAccentColor(0xffe500);

  const titleEmoji = (await fetchEmoji(guild, '1469099919666188542')) ?? '';
  const descEmoji  = (await fetchEmoji(guild, '1354455984323563731')) ?? '';

  // Title
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## ${titleEmoji}  Night Stars  •  Reaction Roles`.trim())
  );

  // Description
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`**Khtar roles libghiti** ${descEmoji}`.trim())
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true)
  );

  // Pre-fetch members so role.members.size is accurate
  try { await guild.members.fetch(); } catch (_) {}

  // Select menus (one per category with options)
  const menuRows = [];
  for (const cat of categories) {
    const options = (cat.options || []).filter(o => o.roleId).slice(0, 25);
    if (options.length === 0) continue;

    const menuOptions = options.map(opt => {
      const option = new StringSelectMenuOptionBuilder()
        .setLabel(opt.label)
        .setValue(slugify(opt.label));

      const emoji = resolveEmoji(opt.emoji);
      if (emoji) {
        try { option.setEmoji(emoji); } catch (_) {}
      }

      // Show member count in description
      try {
        const role = guild.roles.cache.get(opt.roleId);
        if (role) {
          const count = role.members.size;
          option.setDescription(`👥 ${count} member${count !== 1 ? 's' : ''}`);
        }
      } catch (_) {}

      return option;
    });

    const icon = getCategoryIcon(cat.id);
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`cat:${cat.id}`)
      .setPlaceholder(`${icon}  ${cat.placeholder || cat.name}`)
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(menuOptions);

    menuRows.push(new ActionRowBuilder().addComponents(menu));
  }

  if (menuRows.length === 0) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent('*No roles configured yet. Ask an admin to set them up.*')
    );
  } else {
    container.addActionRowComponents(...menuRows);
  }

  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true)
  );

  // Footer credit
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent('-# © Night Stars  |  Reaction Roles')
  );

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  };
}

module.exports = { buildPanel, slugify, resolveEmoji };
