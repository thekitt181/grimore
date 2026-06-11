-- Better Auth Infrastructure activity tracking (dash plugin)

ALTER TABLE "auth_user" ADD COLUMN IF NOT EXISTS "lastActiveAt" TIMESTAMP(3);
