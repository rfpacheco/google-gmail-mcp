/**
 * CLI Authentication Assistant for Gmail MCP Server.
 *
 * Verifies the presence of OAuth client credentials (gcp-oauth.keys.json),
 * guides the user through obtaining credentials from Google Cloud Console if missing,
 * and executes the interactive OAuth2 authorization flow.
 *
 * @packageDocumentation
 */

import { runInteractiveAuth } from '../services/gmail-client.js';

runInteractiveAuth().catch((err: unknown) => {
  console.error('Authentication fatal error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
