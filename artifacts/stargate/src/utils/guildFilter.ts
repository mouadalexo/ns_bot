const MAIN_GUILD_ID = process.env.MAIN_GUILD_ID;

export function isMainGuild(guildId: string | null | undefined): boolean {
  if (!MAIN_GUILD_ID) return true;
  return guildId === MAIN_GUILD_ID;
}
