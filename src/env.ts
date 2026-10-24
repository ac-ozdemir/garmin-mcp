import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider';

export interface Env {
  DB: D1Database;
  OAUTH_KV: KVNamespace;
  /** Injected by OAuthProvider for the default handler. */
  OAUTH_PROVIDER: OAuthHelpers;
  /** Public origin of this Worker, e.g. https://garmin-mcp.example.workers.dev (wrangler var). */
  PUBLIC_ORIGIN: string;
  /** Secrets (wrangler secret put). */
  GARMIN_API_KEY: string;
  OWNER_PASSWORD: string;
}
