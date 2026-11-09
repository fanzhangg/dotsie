import { AuthorizationError, CimdFetchError, OAuthProvider, type OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import { mcpApi } from './mcp';

/* Sign-in for the MCP server: OAuth 2.1, so Claude (web, iOS, Desktop, Claude Code) and other MCP clients
   connect with the address alone. Someone adds https://<app>/api/mcp as a connector, Claude sends them here to
   sign in and allow it, and from then on it holds a token that acts as them.
   @cloudflare/workers-oauth-provider runs the protocol: discovery documents, client registration (Client ID
   Metadata Documents, which Claude uses, and dynamic registration for other clients), tokens and refresh,
   revocation. Its records live in KV (OAUTH_KV), with tokens stored only as hashes. The Allow page is ours:
   it uses the app's session, so signing in is the app's own screen. */

export type McpProps = { userId: string };
export const AUTHORIZE_PATH = '/api/oauth/authorize';
// One scope covers everything the tools do: see your trips and change their stops
const SCOPE = 'trips';
// An hour per access token; the grant lasts while it's used, and ends after 90 days without, like a session
const ACCESS_TTL = 3600, REFRESH_TTL = 60 * 60 * 24 * 365, REFRESH_IDLE_TTL = 60 * 60 * 24 * 90;
// How an MCP client signs in, for the developer page (/developer), from the same values the provider runs on
export const oauthSpec = (env: Env) => ({
  resource: mcpURL(env), issuer: env.BETTER_AUTH_URL, scopes: [SCOPE],
  authorize: `${env.BETTER_AUTH_URL}${AUTHORIZE_PATH}`, token: `${env.BETTER_AUTH_URL}/api/oauth/token`,
  register: `${env.BETTER_AUTH_URL}/api/oauth/register`,
  discovery: [`${env.BETTER_AUTH_URL}/.well-known/oauth-protected-resource/api/mcp`, `${env.BETTER_AUTH_URL}/.well-known/oauth-authorization-server`],
  pkce: ['S256'], accessTokenSeconds: ACCESS_TTL, refreshIdleSeconds: REFRESH_IDLE_TTL,
});

// The issuer and resource are this app's public origin, which comes from env, so the provider is made on
// first use (env is the same for every request in an isolate).
let provider: OAuthProvider<Env> | undefined;
export const oauthProvider = (env: Env, app: ExportedHandler<Env>) => (provider ??= new OAuthProvider<Env>({
  apiRoute: '/api/mcp',
  apiHandler: mcpApi,
  defaultHandler: app,
  authorizeEndpoint: AUTHORIZE_PATH,
  tokenEndpoint: '/api/oauth/token',
  clientRegistrationEndpoint: '/api/oauth/register',
  clientIdMetadataDocumentEnabled: true,
  scopesSupported: [SCOPE],
  requiredScopes: [SCOPE],
  resourceMetadata: {
    resource: mcpURL(env),
    authorization_servers: [env.BETTER_AUTH_URL],
    resource_name: 'Dotsie',
    bearer_methods_supported: ['header'],
  },
  accessTokenTTL: ACCESS_TTL,
  refreshTokenTTL: REFRESH_TTL,
  refreshTokenIdleTTL: REFRESH_IDLE_TTL,
}));
export const mcpURL = (env: Env) => `${env.BETTER_AUTH_URL}/api/mcp`;
export const oauthApi = (env: Env) => (env as Env & { OAUTH_PROVIDER: OAuthHelpers }).OAUTH_PROVIDER;

// ---------- The Allow page ----------
type Signed = { id: string; name: string; email: string | null; guest: boolean };
const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const HTML = { 'Content-Type': 'text/html; charset=utf-8' };

// The app's sign-in screen, so it looks like the rest of Dotsie
function page(title: string, body: string) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Dotsie</title><link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/design-system/tokens.css"><link rel="stylesheet" href="/design-system/components.css"><link rel="stylesheet" href="/styles.css">
</head><body class="wt-base"><div id="app" data-page="signin">
<header class="home-head"><h1 class="signin-title">${esc(title)}</h1></header>
<main class="signin">${body}</main></div></body></html>`;
}
const message = (title: string, text: string, status = 400) =>
  new Response(page(title, `<p class="signin__text">${text}</p><a class="wt-btn wt-btn--secondary wt-btn--block" href="/">Open Dotsie</a>`), { status, headers: HTML });

// Errors before the client and its redirect address are checked are shown here, never sent back to it.
function authError(err: unknown) {
  if (err instanceof AuthorizationError && err.redirectTo) return Response.redirect(err.redirectTo, 302);
  if (err instanceof AuthorizationError) return message('Couldn’t connect', `${esc(err.description)}. Start connecting again from your assistant.`);
  if (err instanceof CimdFetchError) return message('Couldn’t connect', 'This assistant couldn’t be verified. Start connecting again from it.');
  throw err;
}

// GET: who's asking, what they'll be able to do, and where access goes; Allow or Cancel.
export async function authorizePage(req: Request, env: Env, user: Signed | null) {
  const oauth = oauthApi(env);
  try {
    const request = await oauth.parseAuthRequest(req);
    // Not signed in: the app's sign-in, which comes back here (see nextURL in web/signin.js)
    if (!user) {
      const here = new URL(req.url);
      return Response.redirect(`${here.origin}/?next=${encodeURIComponent(here.pathname + here.search)}`, 302);
    }
    // A guest's trips are only reachable from their own browser, so a guest has nothing to connect.
    if (user.guest) return message('Sign in first', 'You’re using Dotsie as a guest. To connect an assistant, open Dotsie, sign in from Account, then connect again.', 403);
    const d = await oauth.describeConsent(request);
    const consent = await oauth.beginConsent(request);
    const who = d.clientDomain
      ? `<b>${esc(d.clientName)}</b> (${esc(d.clientDomain)})`
      : `<b>${esc(d.clientName)}</b>, an app that named itself, so Dotsie can’t vouch for it,`;
    const body = `
      <p class="signin__text">${who} wants to see your trips and add, change and delete their stops, as you. Everyone on a trip sees its changes.</p>
      <p class="signin__text">Access goes to <b>${esc(d.redirectHost)}</b>.${d.redirectIsLoopback ? ' That’s an app on this device: continue only if you just started connecting from it.' : ''}</p>
      <p class="signin__text">Signed in as ${esc(user.name)}${user.email ? ` (${esc(user.email)})` : ''}.</p>
      <form method="post" action="${AUTHORIZE_PATH}">
        <input type="hidden" name="handle" value="${esc(consent.handle)}">
        <button class="wt-btn wt-btn--primary wt-btn--block" name="decision" value="allow">Allow</button>
        <button class="wt-btn wt-btn--ghost wt-btn--block" name="decision" value="deny">Cancel</button>
      </form>
      <p class="signin__hint signin__hint--center">You can disconnect it any time in Account.</p>`;
    consent.headers.set('Content-Type', HTML['Content-Type']);
    return new Response(page(`Connect ${d.clientName}`, body), { headers: consent.headers });
  } catch (err) { return authError(err); }
}

// POST: the decision. The request itself comes back from storage, bound to this browser, not from the form.
export async function authorizeDecision(req: Request, env: Env, user: Signed | null) {
  if (!user || user.guest) return message('Sign in first', 'Your sign-in ended. Start connecting again from your assistant.', 401);
  const oauth = oauthApi(env);
  try {
    const form = await req.formData();
    const handle = String(form.get('handle') ?? '');
    if (form.get('decision') !== 'allow') {
      const denied = await oauth.denyConsent(req, handle);
      return new Response(null, { status: 302, headers: denied.headers });
    }
    const approved = await oauth.approveConsent(req, handle, { scope: [SCOPE] });
    const d = await oauth.describeConsent(approved.request);
    const { redirectTo } = await oauth.completeAuthorization({
      request: approved.request,
      userId: user.id,
      // Shown in Account's list of connected assistants
      metadata: { clientName: d.clientName, clientDomain: d.clientDomain ?? null },
      scope: [SCOPE],
      props: { userId: user.id } satisfies McpProps,
    });
    approved.headers.set('Location', redirectTo);
    return new Response(null, { status: 302, headers: approved.headers });
  } catch (err) { return authError(err); }
}

// ---------- Connected assistants, for Account ----------
export async function listConnections(env: Env, userId: string) {
  const out: { id: string; name: string; domain: string | null; createdAt: number }[] = [];
  let cursor: string | undefined;
  do {
    const page = await oauthApi(env).listUserGrants(userId, { cursor });
    for (const g of page.items) out.push({ id: g.id, name: g.metadata?.clientName || 'An assistant', domain: g.metadata?.clientDomain ?? null, createdAt: g.createdAt * 1000 });
    cursor = page.cursor;
  } while (cursor);
  return out.sort((a, b) => b.createdAt - a.createdAt);
}
