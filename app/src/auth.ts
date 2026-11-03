import { betterAuth } from 'better-auth';
import { anonymous, magicLink } from 'better-auth/plugins';
import type { TripRoom } from './trip';

/* Sign-in: Google and Apple first (phone-first app), email magic link as the fallback, and guest
   sessions so a friend opening a share link can join before making an account. A guest who signs
   in later keeps their trips: onLinkAccount moves their memberships to the new user. */
export function createAuth(env: Env) {
  const social: Parameters<typeof betterAuth>[0]['socialProviders'] = {};
  if (env.GOOGLE_CLIENT_ID) social.google = { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET };
  // Apple's client secret is a signed JWT made from your .p8 key; regenerate it before it expires (max 6 months).
  if (env.APPLE_CLIENT_ID) social.apple = { clientId: env.APPLE_CLIENT_ID, clientSecret: env.APPLE_CLIENT_SECRET };

  return betterAuth({
    database: env.DB,
    // `wrangler dev` answers on both localhost and 127.0.0.1; follow whichever the browser opened, so
    // its origin is trusted and email links come back to the same cookies. Production is fixed.
    baseURL: isLocal(env) ? { allowedHosts: ['localhost:*', '127.0.0.1:*'], protocol: 'http', fallback: env.BETTER_AUTH_URL } : env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    basePath: '/api/auth',
    socialProviders: social,
    trustedOrigins: ['https://appleid.apple.com'], // Apple posts its callback cross-site
    advanced: { defaultCookieAttributes: { sameSite: 'lax', secure: env.BETTER_AUTH_URL.startsWith('https:'), httpOnly: true } },
    databaseHooks: {
      user: {
        // An email sign-up arrives without a name (unless a guest passes theirs along); start from the address.
        create: { before: async user => ({ data: { ...user, name: user.name?.trim() || user.email.split('@')[0] } }) },
        // Names and photos on trips follow profile changes (a guest picking a name, a new Google photo)
        update: { after: user => forEachTrip(env, user.id, r => r.updateMember({ id: user.id, name: user.name, image: user.image ?? null })) },
      },
    },
    plugins: [
      magicLink({ sendMagicLink: ({ email, url }) => sendEmail(env, email, url) }),
      anonymous({
        generateName: () => 'Guest',
        onLinkAccount: ({ anonymousUser, newUser }) => moveMemberships(env, anonymousUser.user.id, newUser.user),
      }),
    ],
  });
}
export type Auth = ReturnType<typeof createAuth>;
export const isLocal = (env: Env) => /^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(env.BETTER_AUTH_URL);

async function sendEmail(env: Env, to: string, url: string) {
  if (!env.RESEND_API_KEY) {
    console.log(`[dev] magic link for ${to}: ${url}`);
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to,
      subject: 'Sign in to Waythread',
      text: `Tap to sign in to Waythread:\n\n${url}\n\nThe link works once and expires in 5 minutes.`,
    }),
  });
  if (!res.ok) throw new Error(`Email send failed: ${res.status}`);
}

const moveMemberships = (env: Env, fromId: string, to: { id: string; name: string; image?: string | null }) =>
  forEachTrip(env, fromId, r => r.replaceMember(fromId, { id: to.id, name: to.name, image: to.image ?? null }));

async function forEachTrip(env: Env, userId: string, fn: (room: DurableObjectStub<TripRoom>) => Promise<unknown>) {
  const { results } = await env.DB.prepare('select trip_id from trip_members where user_id = ?').bind(userId).all<{ trip_id: string }>();
  await Promise.all(results.map(({ trip_id }) => fn(env.TRIP.get(env.TRIP.idFromName(trip_id)))));
}
