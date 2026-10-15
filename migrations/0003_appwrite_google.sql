-- Fresh Appwrite authentication. Preserve deployed schema history and guest Favorites.
CREATE TABLE appwrite_identity (
  project TEXT NOT NULL,
  uid TEXT NOT NULL,
  userId TEXT NOT NULL UNIQUE REFERENCES user(id) ON DELETE CASCADE,
  PRIMARY KEY (project, uid)
);
CREATE TABLE appwrite_oauth (
  state TEXT PRIMARY KEY NOT NULL,
  browser TEXT NOT NULL,
  returnTo TEXT NOT NULL,
  expectedUid TEXT,
  startedAt INTEGER NOT NULL,
  expiresAt INTEGER NOT NULL
);
CREATE INDEX appwrite_oauth_expiry ON appwrite_oauth(expiresAt);
-- Durable deletion outbox: survives failure between Appwrite deletion and D1 cleanup.
CREATE TABLE appwrite_deletion (
  project TEXT NOT NULL,
  uid TEXT NOT NULL,
  userId TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (project, uid)
);
