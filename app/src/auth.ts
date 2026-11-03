import { betterAuth } from 'better-auth';
import { anonymous } from 'better-auth/plugins';
import type { TripRoom } from './trip';

/* Sign-in: Google and Apple (when set up), email and password, and guest sessions so a friend
   opening a share link can join before making an account. A guest who signs in later keeps their
   trips: onLinkAccount moves their memberships to the new user. */
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
    // No email is sent: addresses aren't verified, and a forgotten password can't be reset yet.
    emailAndPassword: { enabled: true, minPasswordLength: 8, maxPasswordLength: 128, autoSignIn: true },
    trustedOrigins: ['https://appleid.apple.com'], // Apple posts its callback cross-site
    advanced: { defaultCookieAttributes: { sameSite: 'lax', secure: env.BETTER_AUTH_URL.startsWith('https:'), httpOnly: true } },
    // Trips are planned weeks ahead, and a guest has no other way back in, so a session lasts 90 days
    // from the last visit rather than Better Auth's 7.
    session: { expiresIn: 60 * 60 * 24 * 90, updateAge: 60 * 60 * 24 },
    databaseHooks: {
      user: {
        // A sign-up without a name (Google can omit it) starts from the email address.
        create: { before: async user => ({ data: { ...user, name: cleanName(user.name) || user.email.split('@')[0] } }) },
        // A blank name is refused rather than saved
        update: {
          before: async data => {
            if (data.name === undefined) return;
            const name = cleanName(data.name);
            return name ? { data: { ...data, name } } : false;
          },
          // Names and photos on trips follow profile changes (someone renaming themselves, a new Google photo)
          after: user => forEachTrip(env, user.id, r => r.updateMember({ id: user.id, name: user.name, image: user.image ?? null })),
        },
      },
    },
    plugins: [
      anonymous({
        generateName: () => 'Guest',
        onLinkAccount: ({ anonymousUser, newUser }) => moveMemberships(env, anonymousUser.user.id, newUser.user),
      }),
    ],
  });
}
export type Auth = ReturnType<typeof createAuth>;
export const isLocal = (env: Env) => /^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(env.BETTER_AUTH_URL);
const cleanName = (name: unknown) => (typeof name === 'string' ? name.trim().replace(/\s+/g, ' ').slice(0, 40) : '');

const moveMemberships = (env: Env, fromId: string, to: { id: string; name: string; image?: string | null }) =>
  forEachTrip(env, fromId, r => r.replaceMember(fromId, { id: to.id, name: to.name, image: to.image ?? null }));

async function forEachTrip(env: Env, userId: string, fn: (room: DurableObjectStub<TripRoom>) => Promise<unknown>) {
  const { results } = await env.DB.prepare('select trip_id from trip_members where user_id = ?').bind(userId).all<{ trip_id: string }>();
  await Promise.all(results.map(({ trip_id }) => fn(env.TRIP.get(env.TRIP.idFromName(trip_id)))));
}
