import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const jailCasesTable = pgTable("jail_cases", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  targetId: text("target_id").notNull(),
  targetTag: text("target_tag").notNull(),
  moderatorId: text("moderator_id").notNull(),
  moderatorTag: text("moderator_tag").notNull(),
  reason: text("reason").notNull(),
  jailedAt: timestamp("jailed_at").defaultNow().notNull(),
});

export type JailCase = typeof jailCasesTable.$inferSelect;
export type InsertJailCase = typeof jailCasesTable.$inferInsert;
