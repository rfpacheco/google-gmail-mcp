/**
 * Gmail API Client Factory and Native OAuth2 Authentication Provider.
 *
 * Resolves Google Cloud OAuth credentials and user tokens from local, global,
 * or environment-specified configurations, manages an in-house HTTP loopback callback server
 * for seamless interactive OAuth authorization, and provides authenticated Gmail API clients.
 *
 * @packageDocumentation
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { URL } from 'node:url';
import { google, gmail_v1 } from 'googleapis';

export const CONFIG_DIR = path.join(os.homedir(), '.gmail-mcp');
export const DEFAULT_OAUTH_KEYS_PATH = path.join(CONFIG_DIR, 'gcp-oauth.keys.json');
export const DEFAULT_LOCAL_KEYS_PATH = path.join(process.cwd(), 'gcp-oauth.keys.json');
export const DEFAULT_CREDENTIALS_PATH = path.join(CONFIG_DIR, 'credentials.json');

/**
 * Standard Gmail API scopes required for sorting, filtering, label management, and storage auditing.
 */
export const DEFAULT_SCOPES: readonly string[] = ['https://mail.google.com/'];

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
export interface OAuthKeysJson {
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
 * Persists OAuth2 authorization tokens to disk with strict 0o600 file permissions.
 * Ensures parent directory exists with 0o700 directory permissions.
 *
 * @param tokens - Authorization tokens received from Google OAuth2 provider.
 */
export function saveCredentials(tokens: Record<string, unknown>): void {
  const credentialsPath = getCredentialsPath();
  const dir = path.dirname(credentialsPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  } else {
    try {
      fs.chmodSync(dir, 0o700);
    } catch {
      // Ignore if filesystem does not support chmod (e.g. Windows FAT32)
    }
  }

  fs.writeFileSync(credentialsPath, JSON.stringify(tokens, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  });

  try {
    fs.chmodSync(credentialsPath, 0o600);
  } catch {
    // Ignore if filesystem does not support chmod
  }
}

/**
 * Escapes characters for safe interpolation into HTML responses.
 *
 * @param str - Input string to escape.
 * @returns Escaped HTML-safe string.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Creates an HTTP loopback server listening on 127.0.0.1 on the specified port.
 *
 * @param port - Port to listen on (0 for dynamic/ephemeral OS-assigned port).
 * @returns Object containing the created server instance and bound port number.
 */
function createLoopbackServer(port: number): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once('error', (err) => {
      reject(err);
    });
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        resolve({ server, port: addr.port });
      } else {
        reject(new Error('Failed to resolve server address.'));
      }
    });
  });
}

/**
 * Attempts to open a URL in the user's default browser across Linux, macOS, and Windows.
 *
 * @param url - URL to open.
 * @returns Promise resolving to true if launch command executed successfully, false otherwise.
 */
async function openBrowser(url: string): Promise<boolean> {
  const { exec } = await import('node:child_process');
  return new Promise((resolve) => {
    let command: string;
    if (process.platform === 'darwin') {
      command = `open "${url}"`;
    } else if (process.platform === 'win32') {
      command = `start "" "${url}"`;
    } else {
      command = `xdg-open "${url}"`;
    }
    exec(command, (err) => {
      resolve(!err);
    });
  });
}

/**
 * Executes the native interactive OAuth2 authorization flow.
 *
 * Spins up a temporary Node.js HTTP loopback callback server on 127.0.0.1, opens the Google
 * authorization consent URL in the browser, exchanges the authorization code for tokens,
 * persists the credentials securely with 0o600 permissions, and shuts down the server cleanly.
 *
 * Avoids port 3000 conflicts by falling back gracefully to dynamic ephemeral ports per Google's
 * OAuth 2.0 Desktop App specification.
 *
 * @throws Error if OAuth client keys are missing or authentication fails.
 */
export async function runInteractiveAuth(): Promise<void> {
  console.log('====================================================');
  console.log('       Gmail MCP Server OAuth Setup & Auth          ');
  console.log('====================================================\n');

  const keysPath = getOauthKeysPath();
  const credentialsPath = getCredentialsPath();

  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
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

  const rawKeys = JSON.parse(fs.readFileSync(keysPath, 'utf8')) as OAuthKeysJson;
  const clientConfig = rawKeys.installed || rawKeys.web;

  if (!clientConfig || !clientConfig.client_id || !clientConfig.client_secret) {
    throw new Error('Invalid gcp-oauth.keys.json structure: missing client_id or client_secret.');
  }

  // Determine preferred port: GMAIL_AUTH_PORT env -> redirect_uri port -> 3000 default
  const envPort = process.env.GMAIL_AUTH_PORT ? parseInt(process.env.GMAIL_AUTH_PORT, 10) : undefined;
  let uriPort: number | undefined;
  let exactRedirectUri: string | undefined;

  if (clientConfig.redirect_uris && clientConfig.redirect_uris.length > 0) {
    for (const uri of clientConfig.redirect_uris) {
      try {
        const parsed = new URL(uri);
        if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
          if (parsed.port) {
            uriPort = parseInt(parsed.port, 10);
          }
          exactRedirectUri = uri;
          break;
        }
      } catch {
        // Ignore invalid URI format
      }
    }
  }

  const preferredPort = envPort ?? uriPort ?? 3000;

  // Attempt to bind to preferred port; gracefully fall back to an ephemeral port on collision
  let serverInfo: { server: http.Server; port: number };
  try {
    serverInfo = await createLoopbackServer(preferredPort);
  } catch (err: unknown) {
    const errCode = (err as NodeJS.ErrnoException)?.code;
    if (errCode === 'EADDRINUSE' || errCode === 'EACCES') {
      console.log(`Port ${preferredPort} is unavailable (${errCode}). Binding to an ephemeral loopback port instead...`);
      serverInfo = await createLoopbackServer(0);
    } else {
      throw err;
    }
  }

  // Construct redirect URI matching bound port
  const redirectUri =
    exactRedirectUri && uriPort === serverInfo.port
      ? exactRedirectUri
      : `http://127.0.0.1:${serverInfo.port}/oauth2callback`;

  const oauth2Client = new google.auth.OAuth2(
    clientConfig.client_id,
    clientConfig.client_secret,
    redirectUri
  );

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [...DEFAULT_SCOPES],
    prompt: 'consent',
  });

  console.log('Initializing native OAuth loopback flow...');
  console.log(`Bound loopback server on: http://127.0.0.1:${serverInfo.port}`);
  console.log(`\n🔗 Authorization URL:\n${authUrl}\n`);

  await new Promise<void>((resolve, reject) => {
    let resolved = false;

    const cleanup = () => {
      if (!resolved) {
        resolved = true;
        try {
          serverInfo.server.close();
        } catch {
          // Ignore close errors
        }
      }
    };

    // 5-minute timeout to avoid lingering background processes
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('OAuth authorization timed out after 5 minutes.'));
    }, 5 * 60 * 1000);

    const sigintHandler = () => {
      clearTimeout(timeout);
      cleanup();
      process.exit(130);
    };
    process.once('SIGINT', sigintHandler);

    serverInfo.server.on('request', async (req, res) => {
      if (req.method !== 'GET') {
        res.writeHead(405, { 'Content-Type': 'text/plain' });
        res.end('Method Not Allowed');
        return;
      }

      const reqUrl = new URL(req.url || '/', `http://127.0.0.1:${serverInfo.port}`);

      if (reqUrl.pathname === '/favicon.ico') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (reqUrl.pathname !== '/oauth2callback' && reqUrl.pathname !== '/') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return;
      }

      const code = reqUrl.searchParams.get('code');
      const error = reqUrl.searchParams.get('error');

      if (error) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><meta charset="utf-8"><title>OAuth Authorization Denied</title></head>
            <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #0f172a; color: #f8fafc;">
              <div style="background: #1e293b; padding: 2rem; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); text-align: center; max-width: 450px;">
                <div style="font-size: 3rem; margin-bottom: 1rem;">❌</div>
                <h1 style="font-size: 1.5rem; margin-bottom: 0.5rem; color: #f87171;">Authorization Denied</h1>
                <p style="color: #94a3b8; font-size: 0.95rem; line-height: 1.5;">${escapeHtml(error)}</p>
              </div>
            </body>
          </html>
        `);
        clearTimeout(timeout);
        process.removeListener('SIGINT', sigintHandler);
        cleanup();
        reject(new Error(`OAuth authorization error from Google: ${error}`));
        return;
      }

      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Missing authorization code in callback URL.');
        return;
      }

      try {
        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);
        saveCredentials(tokens as Record<string, unknown>);

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><meta charset="utf-8"><title>Authentication Successful</title></head>
            <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #0f172a; color: #f8fafc;">
              <div style="background: #1e293b; padding: 2.5rem; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); text-align: center; max-width: 480px;">
                <div style="font-size: 3.5rem; margin-bottom: 1rem;">🎉</div>
                <h1 style="font-size: 1.6rem; margin-bottom: 0.5rem; color: #38bdf8;">Authentication Successful!</h1>
                <p style="color: #94a3b8; font-size: 1rem; line-height: 1.6; margin-bottom: 1.5rem;">
                  Your Gmail MCP Server is now authorized. You can safely close this browser tab and return to your terminal.
                </p>
                <div style="font-size: 0.85rem; color: #64748b; border-top: 1px solid #334155; padding-top: 1rem;">
                  Tokens securely stored with 0600 permissions.
                </div>
              </div>
            </body>
          </html>
        `);

        console.log('\n🎉 Authentication successful!');
        console.log(`Tokens saved to: ${credentialsPath} (mode: 0600)`);
        console.log('The Gmail MCP Server is now authorized and ready for use.');

        clearTimeout(timeout);
        process.removeListener('SIGINT', sigintHandler);
        cleanup();
        resolve();
      } catch (tokenErr: unknown) {
        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><meta charset="utf-8"><title>Token Exchange Failed</title></head>
            <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #0f172a; color: #f8fafc;">
              <div style="background: #1e293b; padding: 2rem; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); text-align: center; max-width: 450px;">
                <div style="font-size: 3rem; margin-bottom: 1rem;">⚠️</div>
                <h1 style="font-size: 1.5rem; margin-bottom: 0.5rem; color: #fbbf24;">Token Exchange Failed</h1>
                <p style="color: #94a3b8; font-size: 0.95rem; line-height: 1.5;">${escapeHtml(tokenErr instanceof Error ? tokenErr.message : String(tokenErr))}</p>
              </div>
            </body>
          </html>
        `);
        clearTimeout(timeout);
        process.removeListener('SIGINT', sigintHandler);
        cleanup();
        reject(tokenErr instanceof Error ? tokenErr : new Error(String(tokenErr)));
      }
    });

    // Attempt to open the authorization URL in default browser
    openBrowser(authUrl).then((opened) => {
      if (opened) {
        console.log('Opened authorization URL in your default browser.');
      } else {
        console.log('Could not open browser automatically. Please open the authorization URL above manually.');
      }
      console.log(`Waiting for Google OAuth callback on http://127.0.0.1:${serverInfo.port}...`);
    });
  });
}

/**
 * Loads credentials and initializes an authenticated Gmail API client.
 * Automatically persists refreshed tokens back to disk with 0o600 permissions.
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

  // Automatically persist refreshed tokens back to disk
  oauth2Client.on('tokens', (newTokens) => {
    try {
      const existing = fs.existsSync(credentialsPath)
        ? JSON.parse(fs.readFileSync(credentialsPath, 'utf8'))
        : {};
      saveCredentials({ ...existing, ...newTokens });
    } catch {
      // Ignore background refresh persistence errors
    }
  });

  return google.gmail({ version: 'v1', auth: oauth2Client });
}
