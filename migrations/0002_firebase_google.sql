-- Preserve historical auth tables and Favorites. New identities never link by email.
CREATE TABLE firebase_identity (
  projectId TEXT NOT NULL,
  uid TEXT NOT NULL,
  userId TEXT NOT NULL UNIQUE REFERENCES user(id) ON DELETE CASCADE,
  PRIMARY KEY (projectId, uid)
);
CREATE TABLE firebase_deleted_user (
  projectId TEXT NOT NULL,
  uid TEXT NOT NULL,
  expiresAt INTEGER NOT NULL,
  PRIMARY KEY (projectId, uid)
);
CREATE INDEX firebase_deleted_expiry ON firebase_deleted_user(expiresAt);
