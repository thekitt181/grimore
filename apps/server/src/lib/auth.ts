import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { bearer } from 'better-auth/plugins';
import { prisma } from './prisma';
import { getClientOrigins, getPrimaryClientUrl } from './clientOrigins';

const googleClientId = process.env['GOOGLE_CLIENT_ID']?.trim();
const googleClientSecret = process.env['GOOGLE_CLIENT_SECRET']?.trim();

export function isGoogleOAuthEnabled(): boolean {
  return Boolean(googleClientId && googleClientSecret);
}

export function getAuthBaseUrl(): string {
  return process.env['BETTER_AUTH_URL']?.trim() ?? getPrimaryClientUrl();
}

export const auth = betterAuth({
  baseURL: getAuthBaseUrl(),
  secret:
    process.env['BETTER_AUTH_SECRET']?.trim() ??
    'grimoire-dev-auth-secret-change-in-production',
  trustedOrigins: getClientOrigins(),
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
  },
  ...(googleClientId && googleClientSecret
    ? {
        socialProviders: {
          google: {
            clientId: googleClientId,
            clientSecret: googleClientSecret,
            prompt: 'select_account',
          },
        },
      }
    : {}),
  user: {
    modelName: 'AuthUser',
  },
  session: {
    modelName: 'AuthSession',
  },
  account: {
    modelName: 'AuthAccount',
  },
  verification: {
    modelName: 'AuthVerification',
  },
  plugins: [bearer()],
});
