// /authorize: the single owner signs in with OWNER_PASSWORD and approves the MCP client (claude.ai).
// The library validates the OAuth request, PKCE and redirect URI; this page only proves who is approving.
import {
  AuthorizationError,
  CimdFetchError,
  type ConsentDescription,
} from '@cloudflare/workers-oauth-provider';
import type { Env } from '../env.ts';
import { errorDetail, log } from '../shared/log.ts';

const OWNER_USER_ID = 'owner';
const MIN_PASSWORD_LENGTH = 16;
const FAILED_LOGIN_DELAY_MS = 1500;

const escape = (value: string) => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

const html = (body: string, status = 200, headers = new Headers()) => {
  headers.set('Content-Type', 'text/html; charset=utf-8');
  return new Response(body, { status, headers });
};

function page(title: string, content: string): string {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:28rem;margin:3rem auto;padding:0 16px;color:#1a1a1a;background:#fafafa}
input[type=password]{width:100%;padding:.6rem;font-size:1rem;box-sizing:border-box}button{padding:.6rem 1.2rem;font-size:1rem;margin-right:.5rem}
.warn{color:#9a3412}@media (prefers-color-scheme:dark){body{color:#eee;background:#161616}}</style>
${content}</html>`;
}

function consentPage(details: ConsentDescription, handle: string): string {
  const name = escape(details.clientName);
  const origin = details.clientDomain
    ? `Published by <strong>${escape(details.clientDomain)}</strong>.`
    : 'This app registered itself; its name is not verified.';
  return page(
    `Authorize ${name}`,
    `<h1>Allow ${name} to read your Garmin data?</h1>
<p>${origin} Access will be sent to <strong>${escape(details.redirectHost)}</strong>.</p>
${details.redirectIsLoopback ? '<p class="warn"><strong>This sends access to an app on your computer.</strong> Continue only if you just started signing in from it.</p>' : ''}
<p>Scopes: ${details.scope.map(escape).join(', ') || 'none'}. Read-only: sleep, wellness and activities.</p>
<form method="post">
  <input type="hidden" name="handle" value="${escape(handle)}">
  ${details.scope.map((scope) => `<input type="hidden" name="scope" value="${escape(scope)}">`).join('')}
  <label>Owner password<br><input type="password" name="password" autocomplete="current-password" required autofocus></label>
  <p><button name="decision" value="approve">Allow</button><button name="decision" value="deny" formnovalidate>Deny</button></p>
</form>`,
  );
}

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

/** Constant-time comparison over fixed-length digests, so length and prefix do not leak. */
async function isOwnerPassword(candidate: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([sha256(candidate), sha256(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

async function showConsent(request: Request, env: Env): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER;
  const authRequest = await oauth.parseAuthRequest(request);
  const details = await oauth.describeConsent(authRequest);
  const consent = await oauth.beginConsent(authRequest);
  return html(consentPage(details, consent.handle), 200, consent.headers);
}

async function submitConsent(request: Request, env: Env): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER;
  const form = await request.formData();
  const handle = String(form.get('handle') ?? '');

  if (form.get('decision') !== 'approve') {
    const denied = await oauth.denyConsent(request, handle);
    return new Response(null, { status: 302, headers: denied.headers });
  }

  if (!(await isOwnerPassword(String(form.get('password') ?? ''), env.OWNER_PASSWORD))) {
    // Slow down guessing; the handle stays valid so the owner can go back and retry.
    await new Promise((resolve) => setTimeout(resolve, FAILED_LOGIN_DELAY_MS));
    log.warn('authorize: wrong owner password');
    return html(
      page(
        'Wrong password',
        '<p>Wrong password. <a href="javascript:history.back()">Go back</a> and try again.</p>',
      ),
      401,
    );
  }

  const approved = await oauth.approveConsent(request, handle, { scope: form.getAll('scope').map(String) });
  const { redirectTo } = await oauth.completeAuthorization({
    request: approved.request,
    userId: OWNER_USER_ID,
    metadata: { label: 'Garmin owner' },
    scope: approved.request.scope,
    props: { userId: OWNER_USER_ID },
  });
  approved.headers.set('Location', redirectTo);
  log.info('authorize: client approved', { clientId: approved.request.clientId });
  return new Response(null, { status: 302, headers: approved.headers });
}

export async function handleAuthorize(request: Request, env: Env): Promise<Response> {
  if (!env.OWNER_PASSWORD || env.OWNER_PASSWORD.length < MIN_PASSWORD_LENGTH) {
    log.error('authorize: OWNER_PASSWORD secret missing or too short');
    return new Response('Server is not configured.', { status: 503 });
  }
  try {
    if (request.method === 'GET') return await showConsent(request, env);
    if (request.method === 'POST') return await submitConsent(request, env);
    return new Response('Method not allowed', { status: 405 });
  } catch (error) {
    if (error instanceof AuthorizationError && error.redirectTo)
      return Response.redirect(error.redirectTo, 302);
    if (error instanceof AuthorizationError || error instanceof CimdFetchError) {
      log.warn('authorize: rejected request', errorDetail(error));
      const message =
        error instanceof AuthorizationError ? error.description : 'This app could not be verified.';
      return html(page('Cannot authorize', `<p>${escape(message ?? 'Invalid request.')}</p>`), 400);
    }
    throw error;
  }
}
