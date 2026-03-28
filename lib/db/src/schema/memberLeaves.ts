import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const memberLeavesTable = pgTable("member_leaves", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  memberId: text("member_id").notNull(),
  leftAt: timestamp("left_at").defaultNow(),
});

export type MemberLeave = typeof memberLeavesTable.$inferSelect;
export type InsertMemberLeave = typeof memberLeavesTable.$inferInsert;
