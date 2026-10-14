CREATE TABLE "user" (
 "id" TEXT PRIMARY KEY NOT NULL, "name" TEXT NOT NULL, "email" TEXT NOT NULL UNIQUE,
 "emailVerified" INTEGER NOT NULL DEFAULT 0, "image" TEXT, "createdAt" INTEGER NOT NULL, "updatedAt" INTEGER NOT NULL
);
CREATE TABLE "session" (
 "id" TEXT PRIMARY KEY NOT NULL, "token" TEXT NOT NULL UNIQUE, "expiresAt" INTEGER NOT NULL,
 "createdAt" INTEGER NOT NULL, "updatedAt" INTEGER NOT NULL, "ipAddress" TEXT, "userAgent" TEXT,
 "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE
);
CREATE INDEX "session_user" ON "session"("userId");
CREATE INDEX "session_expiry" ON "session"("expiresAt");
CREATE TABLE "account" (
 "id" TEXT PRIMARY KEY NOT NULL, "accountId" TEXT NOT NULL, "providerId" TEXT NOT NULL,
 "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
 "accessToken" TEXT, "refreshToken" TEXT, "idToken" TEXT, "accessTokenExpiresAt" INTEGER,
 "refreshTokenExpiresAt" INTEGER, "scope" TEXT, "password" TEXT, "createdAt" INTEGER NOT NULL, "updatedAt" INTEGER NOT NULL
);
CREATE INDEX "account_user" ON "account"("userId");
CREATE UNIQUE INDEX "account_provider_identity" ON "account"("providerId", "accountId");
CREATE TABLE "verification" (
 "id" TEXT PRIMARY KEY NOT NULL, "identifier" TEXT NOT NULL, "value" TEXT NOT NULL,
 "expiresAt" INTEGER NOT NULL, "createdAt" INTEGER NOT NULL, "updatedAt" INTEGER NOT NULL
);
CREATE INDEX "verification_identifier" ON "verification"("identifier");
CREATE INDEX "verification_expiry" ON "verification"("expiresAt");
CREATE TABLE "favorite" (
 "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE, "id" TEXT NOT NULL,
 "url" TEXT NOT NULL, "title" TEXT NOT NULL, "source" TEXT NOT NULL, "published" TEXT, "savedAt" INTEGER NOT NULL,
 PRIMARY KEY ("userId", "id")
);
CREATE INDEX "favorite_chronological" ON "favorite"("userId", "savedAt", "id");
