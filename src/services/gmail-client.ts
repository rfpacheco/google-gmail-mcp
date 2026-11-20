/**
 * Gmail API Client Factory and Authentication Provider.
 *
 * Resolves Google Cloud OAuth credentials and user tokens from local, global,
 * or environment-specified configurations and provides an authenticated Gmail API client instance.
 *
 * @packageDocumentation
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { google, gmail_v1 } from 'googleapis';
import { AuthService } from '@pouyanafisi/gmail-mcp/dist/services/auth.service.js';

export const CONFIG_DIR = path.join(os.homedir(), '.gmail-mcp');
export const DEFAULT_OAUTH_KEYS_PATH = path.join(CONFIG_DIR, 'gcp-oauth.keys.json');
export const DEFAULT_LOCAL_KEYS_PATH = path.join(process.cwd(), 'gcp-oauth.keys.json');
export const DEFAULT_CREDENTIALS_PATH = path.join(CONFIG_DIR, 'credentials.json');

/**
 * Resolves the path to the Google Cloud OAuth client keys JSON file.
 * Prioritizes `GMAIL_OAUTH_PATH` env var, then `./gcp-oauth.keys.json`, then `~/.gmail-mcp/gcp-oauth.keys.json`.
 *
 * @returns Absolute path to OAuth keys file.
 */
export function getOauthKeysPath(): string {
  if (process.env.GMAIL_OAUTH_PATH) {
    return path.resolve(process.env.GMAIL_OAUTH_PATH);
  }
  if (fs.existsSync(DEFAULT_LOCAL_KEYS_PATH)) {
    return DEFAULT_LOCAL_KEYS_PATH;
  }
  return DEFAULT_OAUTH_KEYS_PATH;
}

/**
 * Resolves the path to the authorized user tokens credentials JSON file.
 * Prioritizes `GMAIL_CREDENTIALS_PATH` env var, then `~/.gmail-mcp/credentials.json`.
 *
 * @returns Absolute path to credentials file.
 */
export function getCredentialsPath(): string {
  if (process.env.GMAIL_CREDENTIALS_PATH) {
    return path.resolve(process.env.GMAIL_CREDENTIALS_PATH);
  }
  return DEFAULT_CREDENTIALS_PATH;
}

/**
 * Interface representing the structure of a Google OAuth2 Client Secrets JSON file.
 */
interface OAuthKeysJson {
  installed?: {
    client_id: string;
    client_secret: string;
    redirect_uris?: string[];
  };
  web?: {
    client_id: string;
    client_secret: string;
    redirect_uris?: string[];
  };
}

/**
 * Checks whether valid OAuth keys and user authorization tokens are present on disk.
 *
 * @returns Object indicating whether credentials and keys exist.
 */
export function checkCredentialsStatus(): { hasKeys: boolean; hasTokens: boolean } {
  const keysPath = getOauthKeysPath();
  const credentialsPath = getCredentialsPath();
  const hasKeys = fs.existsSync(keysPath);
  const hasTokens = fs.existsSync(credentialsPath);
  return { hasKeys, hasTokens };
}

/**
 * Executes the interactive OAuth2 authorization flow.
 *
 * @throws Error if OAuth keys are missing or authentication fails.
 */
export async function runInteractiveAuth(): Promise<void> {
  console.log('====================================================');
  console.log('       Gmail MCP Server OAuth Setup & Auth          ');
  console.log('====================================================\n');

  const keysPath = getOauthKeysPath();
  const credentialsPath = getCredentialsPath();

  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }

  if (!fs.existsSync(keysPath)) {
    console.error(`❌ Missing Google Cloud OAuth Client Credentials at: ${keysPath}\n`);
    console.log('To connect to Gmail via OAuth2:');
    console.log('1. Go to Google Cloud Console: https://console.cloud.google.com/');
    console.log('2. Create or select a project.');
    console.log('3. Enable "Gmail API" under APIs & Services > Enabled APIs & Services.');
    console.log('4. Go to APIs & Services > Credentials > Create Credentials > OAuth client ID.');
    console.log('5. Select Application Type: "Desktop app" (or "Web application" with http://localhost:3000/oauth2callback).');
    console.log('6. Download the JSON credential file and save it as:');
    console.log(`   - ${DEFAULT_LOCAL_KEYS_PATH} (in the project root), OR`);
    console.log(`   - ${DEFAULT_OAUTH_KEYS_PATH} (global config directory), OR`);
    console.log(`   - specify path via GMAIL_OAUTH_PATH environment variable.\n`);
    console.log('Once placed, re-run: npx google-gmail-mcp auth (or npm run auth)');
    process.exit(1);
  }

  console.log(`✅ Found OAuth Client credentials at: ${keysPath}`);
  console.log('Initializing interactive authentication flow in your browser...');
  const authService = new AuthService();

  try {
    await authService.authenticate();
    console.log('\n🎉 Authentication successful!');
    console.log(`Tokens saved to: ${credentialsPath}`);
    console.log('The Gmail MCP Server is now authorized and ready for use.');
  } catch (err: unknown) {
    console.error('\n❌ Authentication failed:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

/**
 * Loads credentials and initializes an authenticated Gmail API client.
 *
 * @throws Error if OAuth client keys or authorization tokens are missing.
 * @returns Configured Gmail API client instance.
 */
export function getAuthenticatedGmailClient(): gmail_v1.Gmail {
  const keysPath = getOauthKeysPath();
  const credentialsPath = getCredentialsPath();
  const { hasKeys, hasTokens } = checkCredentialsStatus();

  if (!hasKeys) {
    throw new Error(
      `Missing OAuth client keys. Please place gcp-oauth.keys.json at ${keysPath} or set GMAIL_OAUTH_PATH.`
    );
  }

  if (!hasTokens) {
    throw new Error(
      `Missing authorized user tokens at ${credentialsPath}. Please run "npx google-gmail-mcp auth" or "npm run auth" first.`
    );
  }

  const rawKeys = JSON.parse(fs.readFileSync(keysPath, 'utf8')) as OAuthKeysJson;
  const clientConfig = rawKeys.installed || rawKeys.web;

  if (!clientConfig || !clientConfig.client_id || !clientConfig.client_secret) {
    throw new Error('Invalid gcp-oauth.keys.json structure: missing client_id or client_secret.');
  }

  const redirectUri =
    clientConfig.redirect_uris && clientConfig.redirect_uris.length > 0
      ? clientConfig.redirect_uris[0]
      : 'http://localhost:3000/oauth2callback';

  const oauth2Client = new google.auth.OAuth2(
    clientConfig.client_id,
    clientConfig.client_secret,
    redirectUri
  );

  const tokens = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
  oauth2Client.setCredentials(tokens);

  return google.gmail({ version: 'v1', auth: oauth2Client });
}
