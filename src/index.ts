// Entry point. One Worker plays three roles:
//   - OAuth 2.1 authorization server (PKCE, DCR, CIMD) for claude.ai's custom connector,
//   - remote MCP server at /mcp (requires a valid access token),
//   - scheduled sync from Garmin into D1.
import { OAuthProvider } from '@cloudflare/workers-oauth-provider';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { handleAuthorize } from './auth/authorize.ts';
import type { Env } from './env.ts';
import { createMcpServer } from './mcp/server.ts';
import { errorDetail, log } from './shared/log.ts';
import { runSync } from './sync/run-sync.ts';

const mcpApiHandler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Stateless: a fresh server and transport per request, JSON responses instead of SSE.
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    const server = createMcpServer(env);
    await server.connect(transport);
    try {
      return await transport.handleRequest(request);
    } catch (error) {
      log.error('mcp request failed', errorDetail(error));
      return Response.json(
        { jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null },
        { status: 500 },
      );
    }
  },
};

const defaultHandler: ExportedHandler<Env> = {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/authorize') return handleAuthorize(request, env);
    if (pathname === '/') return new Response('Garmin MCP server. Connect it from claude.ai at /mcp.\n');
    return new Response('Not found', { status: 404 });
  },
};

// The resource URL must be static per deployment, so the provider is built on first use from PUBLIC_ORIGIN.
let provider: OAuthProvider<Env> | undefined;
function getProvider(env: Env): OAuthProvider<Env> {
  provider ??= new OAuthProvider<Env>({
    apiRoute: '/mcp',
    apiHandler: mcpApiHandler,
    defaultHandler,
    authorizeEndpoint: '/authorize',
    tokenEndpoint: '/oauth/token',
    clientRegistrationEndpoint: '/oauth/register',
    clientIdMetadataDocumentEnabled: true,
    scopesSupported: ['garmin:read', 'offline_access'],
    requiredScopes: ['garmin:read'],
    resourceMetadata: { resource: `${env.PUBLIC_ORIGIN}/mcp`, authorization_servers: [env.PUBLIC_ORIGIN] },
  });
  return provider;
}

export default {
  fetch(request, env, ctx) {
    return getProvider(env).fetch(request, env, ctx);
  },
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runSync(env, `cron ${controller.cron}`).then(() => undefined));
  },
} satisfies ExportedHandler<Env>;
