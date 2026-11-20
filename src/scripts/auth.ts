/**
 * CLI Authentication Assistant for Gmail MCP Server.
 *
 * Verifies the presence of OAuth client credentials (gcp-oauth.keys.json),
 * guides the user through obtaining credentials from Google Cloud Console if missing,
 * and executes the interactive OAuth2 authorization flow.
 *
 * @packageDocumentation
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { AuthService } from '@pouyanafisi/gmail-mcp/dist/services/auth.service.js';

const CONFIG_DIR = path.join(os.homedir(), '.gmail-mcp');
const OAUTH_KEYS_PATH = path.join(CONFIG_DIR, 'gcp-oauth.keys.json');
const LOCAL_KEYS_PATH = path.join(process.cwd(), 'gcp-oauth.keys.json');

/**
 * Runs the OAuth setup and authentication flow.
 */
async function main(): Promise<void> {
  console.log('====================================================');
  console.log('       Gmail MCP Server OAuth Setup & Auth          ');
  console.log('====================================================\n');

  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }

  const hasLocal = fs.existsSync(LOCAL_KEYS_PATH);
  const hasGlobal = fs.existsSync(OAUTH_KEYS_PATH);

  if (!hasLocal && !hasGlobal) {
    console.error('❌ Missing Google Cloud OAuth Client Credentials (gcp-oauth.keys.json)!\n');
    console.log('To connect to Gmail via OAuth2:');
    console.log('1. Go to Google Cloud Console: https://console.cloud.google.com/');
    console.log('2. Create or select a project.');
    console.log('3. Enable "Gmail API" under APIs & Services > Enabled APIs & Services.');
    console.log('4. Go to APIs & Services > Credentials > Create Credentials > OAuth client ID.');
    console.log('5. Select Application Type: "Desktop app" (or "Web application" with http://localhost:3000/oauth2callback).');
    console.log('6. Download the JSON credential file and save it as:');
    console.log(`   - ${LOCAL_KEYS_PATH} (in this project root), OR`);
    console.log(`   - ${OAUTH_KEYS_PATH} (global config directory)\n`);
    console.log('Once placed, re-run this script: npm run auth');
    process.exit(1);
  }

  console.log('✅ Found OAuth Client credentials. Initializing authentication flow...');
  const authService = new AuthService();

  try {
    await authService.authenticate();
    console.log('\n🎉 Authentication successful!');
    console.log(`Tokens saved to: ${path.join(CONFIG_DIR, 'credentials.json')}`);
    console.log('The Gmail MCP Server is now authorized and ready for use.');
  } catch (err: unknown) {
    console.error('\n❌ Authentication failed:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

main();
