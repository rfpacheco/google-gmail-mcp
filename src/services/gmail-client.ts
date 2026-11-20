/**
 * Gmail API Client Factory and Authentication Provider.
 *
 * Resolves Google Cloud OAuth credentials and user tokens from local or global
 * configurations and provides an authenticated Gmail API client instance.
 *
 * @packageDocumentation
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { google, gmail_v1 } from 'googleapis';

export const CONFIG_DIR = path.join(os.homedir(), '.gmail-mcp');
export const OAUTH_KEYS_PATH = path.join(CONFIG_DIR, 'gcp-oauth.keys.json');
export const LOCAL_KEYS_PATH = path.join(process.cwd(), 'gcp-oauth.keys.json');
export const CREDENTIALS_PATH = path.join(CONFIG_DIR, 'credentials.json');

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
  const hasKeys = fs.existsSync(LOCAL_KEYS_PATH) || fs.existsSync(OAUTH_KEYS_PATH);
  const hasTokens = fs.existsSync(CREDENTIALS_PATH);
  return { hasKeys, hasTokens };
}

/**
 * Loads credentials and initializes an authenticated Gmail API client.
 *
 * @throws Error if OAuth client keys or authorization tokens are missing.
 * @returns Configured Gmail API client instance.
 */
export function getAuthenticatedGmailClient(): gmail_v1.Gmail {
  const { hasKeys, hasTokens } = checkCredentialsStatus();

  if (!hasKeys) {
    throw new Error(
      `Missing OAuth client keys. Please place gcp-oauth.keys.json in ${LOCAL_KEYS_PATH} or ${OAUTH_KEYS_PATH}.`
    );
  }

  if (!hasTokens) {
    throw new Error(
      `Missing authorized user tokens at ${CREDENTIALS_PATH}. Please run "npm run auth" first.`
    );
  }

  const keysPath = fs.existsSync(LOCAL_KEYS_PATH) ? LOCAL_KEYS_PATH : OAUTH_KEYS_PATH;
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

  const tokens = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
  oauth2Client.setCredentials(tokens);

  return google.gmail({ version: 'v1', auth: oauth2Client });
}
