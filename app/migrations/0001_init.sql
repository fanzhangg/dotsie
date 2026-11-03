-- Better Auth core tables, plus the anonymous plugin's isAnonymous column.
-- Keep in sync with src/auth.ts: `npx @better-auth/cli generate` prints the expected schema.
create table "user" (
  "id" text not null primary key,
  "name" text not null,
  "email" text not null unique,
  "emailVerified" integer not null,
  "image" text,
  "createdAt" date not null,
  "updatedAt" date not null,
  "isAnonymous" integer
);

create table "session" (
  "id" text not null primary key,
  "expiresAt" date not null,
  "token" text not null unique,
  "createdAt" date not null,
  "updatedAt" date not null,
  "ipAddress" text,
  "userAgent" text,
  "userId" text not null references "user" ("id") on delete cascade
);
create index "session_userId_idx" on "session" ("userId");

create table "account" (
  "id" text not null primary key,
  "accountId" text not null,
  "providerId" text not null,
  "userId" text not null references "user" ("id") on delete cascade,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" date,
  "refreshTokenExpiresAt" date,
  "scope" text,
  "password" text,
  "createdAt" date not null,
  "updatedAt" date not null
);
create index "account_userId_idx" on "account" ("userId");

create table "verification" (
  "id" text not null primary key,
  "identifier" text not null,
  "value" text not null,
  "expiresAt" date not null,
  "createdAt" date not null,
  "updatedAt" date not null
);
create index "verification_identifier_idx" on "verification" ("identifier");

-- Waythread tables. Each trip's Durable Object owns its data; these rows mirror what
-- spans trips: who is on which trip, the home-screen summary, and the share-link lookup.
create table trips (
  id text primary key,
  name text not null,
  first_stop text,            -- trip-local "YYYY-MM-DDTHH:MM", for the home card's date range
  last_stop text,
  invite_hash text not null unique,  -- SHA-256 of the share-link token; the token itself is never stored
  updated_at integer not null,
  deleted_at integer          -- soft delete, so "Delete for everyone" can be undone
);

create table trip_members (
  trip_id text not null references trips (id) on delete cascade,
  user_id text not null references "user" ("id") on delete cascade,
  joined_at integer not null,
  primary key (trip_id, user_id)
);
create index trip_members_user_idx on trip_members (user_id);
