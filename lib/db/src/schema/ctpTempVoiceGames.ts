import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

export const ctpTempVoiceGamesTable = pgTable("ctp_temp_voice_games", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  roleId: text("role_id").notNull(),
  gameName: text("game_name").notNull(),
  cooldownSecondsOverride: integer("cooldown_seconds_override"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type CtpTempVoiceGame = typeof ctpTempVoiceGamesTable.$inferSelect;
export type InsertCtpTempVoiceGame = typeof ctpTempVoiceGamesTable.$inferInsert;
