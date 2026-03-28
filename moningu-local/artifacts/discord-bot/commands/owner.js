const { PermissionFlagsBits } = require('discord.js');

function hasManagerAccess(member, dynamicRoles) {
  if (!member) return false;
  if (dynamicRoles.managerRoleId) {
    return member.roles.cache.has(dynamicRoles.managerRoleId);
  }
  return member.permissions.has(PermissionFlagsBits.Administrator);
}

module.exports = { hasManagerAccess };
