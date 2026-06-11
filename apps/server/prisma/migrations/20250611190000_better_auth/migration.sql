-- Better Auth tables + rename User.clerkId -> authUserId

ALTER TABLE "User" RENAME COLUMN "clerkId" TO "authUserId";

DROP INDEX IF EXISTS "User_clerkId_idx";
DROP INDEX IF EXISTS "User_clerkId_key";

CREATE UNIQUE INDEX IF NOT EXISTS "User_authUserId_key" ON "User"("authUserId");
CREATE INDEX IF NOT EXISTS "User_authUserId_idx" ON "User"("authUserId");

CREATE TABLE IF NOT EXISTS "auth_user" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_user_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "auth_user_email_key" ON "auth_user"("email");

CREATE TABLE IF NOT EXISTS "auth_session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "auth_session_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "auth_session_token_key" ON "auth_session"("token");
CREATE INDEX IF NOT EXISTS "auth_session_userId_idx" ON "auth_session"("userId");

CREATE TABLE IF NOT EXISTS "auth_account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_account_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "auth_account_userId_idx" ON "auth_account"("userId");

CREATE TABLE IF NOT EXISTS "auth_verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_verification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "auth_verification_identifier_idx" ON "auth_verification"("identifier");

ALTER TABLE "auth_session" DROP CONSTRAINT IF EXISTS "auth_session_userId_fkey";
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "auth_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "auth_account" DROP CONSTRAINT IF EXISTS "auth_account_userId_fkey";
ALTER TABLE "auth_account" ADD CONSTRAINT "auth_account_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "auth_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
