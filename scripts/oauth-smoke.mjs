// End-to-end smoke test of the connector flow claude.ai performs: DCR -> authorize (PKCE) -> token -> MCP.
// Usage: node scripts/oauth-smoke.mjs <origin> <owner-password> [tool] [json-args]   (intended for `wrangler dev`)
import crypto from 'node:crypto';

const [origin, password, toolName = 'get_sync_status', toolArgs = '{}'] = process.argv.slice(2);
if (!origin || !password) throw new Error('usage: oauth-smoke.mjs <origin> <owner-password>');
const redirectUri = 'https://claude.ai/api/mcp/auth_callback';

const reg = await (
  await fetch(`${origin}/oauth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'smoke-test',
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: 'none',
    }),
  })
).json();
console.log('registered client', reg.client_id ? 'ok' : reg);

const verifier = crypto.randomBytes(32).toString('base64url');
const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
const authUrl = new URL(`${origin}/authorize`);
Object.entries({
  response_type: 'code',
  client_id: reg.client_id,
  redirect_uri: redirectUri,
  scope: 'garmin:read',
  state: 'xyz',
  code_challenge: challenge,
  code_challenge_method: 'S256',
  resource: `${origin}/mcp`,
}).forEach(([k, v]) => authUrl.searchParams.set(k, v));

const page = await fetch(authUrl);
const cookies = page.headers
  .getSetCookie()
  .map((c) => c.split(';')[0])
  .join('; ');
const html = await page.text();
const handle = html.match(/name="handle" value="([^"]+)"/)?.[1];
console.log('consent page', page.status, handle ? 'has handle' : html.slice(0, 200));

const submit = async (pw) =>
  fetch(`${origin}/authorize`, {
    method: 'POST',
    redirect: 'manual',
    // The consent cookie is __Host- (Secure); over http://localhost undici still sends it if we pass it explicitly.
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookies, origin },
    body: new URLSearchParams({ handle, password: pw, decision: 'approve', scope: 'garmin:read' }),
  });
console.log('wrong password ->', (await submit('wrong-password-xxxxxx')).status);
const ok = await submit(password);
const location = ok.headers.get('location');
console.log('right password ->', ok.status, location?.split('?')[0]);
const code = new URL(location).searchParams.get('code');

const token = await (
  await fetch(`${origin}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: reg.client_id,
      code_verifier: verifier,
      resource: `${origin}/mcp`,
    }),
  })
).json();
console.log(
  'token',
  token.access_token ? `ok, expires_in=${token.expires_in}, refresh=${Boolean(token.refresh_token)}` : token,
);

const rpc = async (method, params = {}) => {
  const res = await fetch(`${origin}/mcp`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token.access_token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const init = await rpc('initialize', {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'smoke', version: '0' },
});
console.log('initialize', init.status, init.body?.result?.serverInfo);
const tools = await rpc('tools/list');
console.log(
  'tools',
  tools.body?.result?.tools?.map((t) => t.name),
);
const call = await rpc('tools/call', { name: toolName, arguments: JSON.parse(toolArgs) });
console.log(
  toolName,
  call.status,
  call.body?.result?.isError ? 'isError' : '',
  call.body?.result?.content?.[0]?.text?.slice(0, 1500),
);
