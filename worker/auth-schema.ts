import { sqliteTable, text, integer, index, uniqueIndex, primaryKey } from 'drizzle-orm/sqlite-core';

export const user = sqliteTable('user', {
  id: text('id').primaryKey(), name: text('name').notNull(), email: text('email').notNull().unique(),
  emailVerified: integer('emailVerified', { mode: 'boolean' }).notNull().default(false), image: text('image'),
  createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(), updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
});
export const session = sqliteTable('session', {
  id: text('id').primaryKey(), token: text('token').notNull().unique(), expiresAt: integer('expiresAt', { mode: 'timestamp_ms' }).notNull(),
  createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(), updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
  ipAddress: text('ipAddress'), userAgent: text('userAgent'), userId: text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }),
}, table => [index('session_user').on(table.userId), index('session_expiry').on(table.expiresAt)]);
export const account = sqliteTable('account', {
  id: text('id').primaryKey(), accountId: text('accountId').notNull(), providerId: text('providerId').notNull(),
  userId: text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('accessToken'), refreshToken: text('refreshToken'), idToken: text('idToken'),
  accessTokenExpiresAt: integer('accessTokenExpiresAt', { mode: 'timestamp_ms' }), refreshTokenExpiresAt: integer('refreshTokenExpiresAt', { mode: 'timestamp_ms' }),
  scope: text('scope'), password: text('password'), createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(), updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
}, table => [index('account_user').on(table.userId), uniqueIndex('account_provider_identity').on(table.providerId, table.accountId)]);
export const verification = sqliteTable('verification', {
  id: text('id').primaryKey(), identifier: text('identifier').notNull(), value: text('value').notNull(),
  expiresAt: integer('expiresAt', { mode: 'timestamp_ms' }).notNull(), createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(), updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
}, table => [index('verification_identifier').on(table.identifier), index('verification_expiry').on(table.expiresAt)]);
export const favorite = sqliteTable('favorite', {
  userId: text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }), id: text('id').notNull(),
  url: text('url').notNull(), title: text('title').notNull(), source: text('source').notNull(), published: text('published'), savedAt: integer('savedAt').notNull(),
}, table => [primaryKey({ columns: [table.userId, table.id] }), index('favorite_chronological').on(table.userId, table.savedAt, table.id)]);
