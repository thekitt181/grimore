import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { dash } from '@better-auth/infra';
import { bearer } from 'better-auth/plugins';
import { authPrisma } from './prisma';
import { getClientOrigins, getPrimaryClientUrl, getSharedAuthCookieDomain } from './clientOrigins';
import { sendEmail } from './email';

const sharedAuthCookieDomain = getSharedAuthCookieDomain();

const googleClientId = process.env['GOOGLE_CLIENT_ID']?.trim();
const googleClientSecret = process.env['GOOGLE_CLIENT_SECRET']?.trim();
const betterAuthApiKey = process.env['BETTER_AUTH_API_KEY']?.trim();

export function isGoogleOAuthEnabled(): boolean {
  return Boolean(googleClientId && googleClientSecret);
}

export function getAuthBaseUrl(): string {
  return process.env['BETTER_AUTH_URL']?.trim() ?? getPrimaryClientUrl();
}

export function isBetterAuthDashboardEnabled(): boolean {
  return Boolean(betterAuthApiKey);
}

export const auth = betterAuth({
  baseURL: getAuthBaseUrl(),
  secret:
    process.env['BETTER_AUTH_SECRET']?.trim() ??
    'grimoire-dev-auth-secret-change-in-production',
  trustedOrigins: getClientOrigins(),
  ...(sharedAuthCookieDomain
    ? {
        advanced: {
          crossSubDomainCookies: {
            enabled: true,
            domain: sharedAuthCookieDomain,
          },
          useSecureCookies: true,
        },
      }
    : {}),
  database: prismaAdapter(authPrisma, { provider: 'postgresql' }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      void sendEmail({
        to: user.email,
        subject: 'Reset your Grimoire password',
        text: [
          'You requested a password reset for your Grimoire account.',
          '',
          `Reset your password: ${url}`,
          '',
          'If you did not request this, you can ignore this email.',
          'This link expires in one hour.',
        ].join('\n'),
      });
    },
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
    // OAuth state is still validated against the verification table; skip the extra
    // signed cookie check that breaks on mobile / www↔apex redirects when cookies drop.
    skipStateCookieCheck: true,
  },
  verification: {
    modelName: 'AuthVerification',
  },
  plugins: [
    bearer(),
    ...(betterAuthApiKey
      ? [
          dash({
            apiKey: betterAuthApiKey,
            activityTracking: { enabled: true },
          }),
        ]
      : []),
  ],
});
