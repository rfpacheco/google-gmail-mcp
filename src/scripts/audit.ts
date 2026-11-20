/**
 * CLI Audit Tool for Gmail Filters and Labels.
 *
 * Inspects the current Gmail configuration, listing active automated filters,
 * system and custom label hierarchies, and unread/total email counts across categories.
 *
 * @packageDocumentation
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { google } from 'googleapis';
import { RECOMMENDED_LABEL_TAXONOMY } from '../sorting-and-filtering/taxonomy.js';

const CONFIG_DIR = path.join(os.homedir(), '.gmail-mcp');
const OAUTH_KEYS_PATH = path.join(CONFIG_DIR, 'gcp-oauth.keys.json');
const LOCAL_KEYS_PATH = path.join(process.cwd(), 'gcp-oauth.keys.json');
const CREDENTIALS_PATH = path.join(CONFIG_DIR, 'credentials.json');

/**
 * Executes the audit of active Gmail filters and labels.
 */
async function main(): Promise<void> {
  console.log('====================================================');
  console.log('        Gmail Filters & Labels Audit Report         ');
  console.log('====================================================\n');

  if (!fs.existsSync(CREDENTIALS_PATH)) {
    console.log('⚠️  Gmail credentials not found at:', CREDENTIALS_PATH);
    console.log('To authenticate, run: npm run auth\n');
    console.log('Recommended Sorting & Filtering Baseline Taxonomy:');
    RECOMMENDED_LABEL_TAXONOMY.forEach((node, idx) => {
      console.log(` ${idx + 1}. [${node.name}] - ${node.purpose}`);
      if (node.suggestedFilterQuery) {
        console.log(`    ↳ Suggested Filter: ${node.suggestedFilterQuery}`);
      }
    });
    return;
  }

  const keysPath = fs.existsSync(LOCAL_KEYS_PATH) ? LOCAL_KEYS_PATH : OAUTH_KEYS_PATH;
  const keysContent = JSON.parse(fs.readFileSync(keysPath, 'utf8'));
  const keys = keysContent.installed || keysContent.web;

  const oauth2Client = new google.auth.OAuth2(keys.client_id, keys.client_secret, 'http://localhost:3000/oauth2callback');
  const tokens = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
  oauth2Client.setCredentials(tokens);

  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  try {
    console.log('🔍 Fetching user profile...');
    const profile = await gmail.users.getProfile({ userId: 'me' });
    console.log(`Authenticated as: ${profile.data.emailAddress}`);
    console.log(`Total messages in account: ${profile.data.messagesTotal}`);
    console.log(`Total threads in account: ${profile.data.threadsTotal}\n`);

    console.log('🏷️  Auditing Labels...');
    const labelsRes = await gmail.users.labels.list({ userId: 'me' });
    const labels = labelsRes.data.labels || [];
    const systemLabels = labels.filter((l) => l.type === 'system');
    const userLabels = labels.filter((l) => l.type === 'user');

    console.log(`System Labels: ${systemLabels.length}`);
    console.log(`User-Created Labels: ${userLabels.length}`);
    userLabels.forEach((l) => {
      console.log(` - ${l.name} (id: ${l.id})`);
    });

    console.log('\n⚙️  Auditing Active Filters...');
    const filtersRes = await gmail.users.settings.filters.list({ userId: 'me' });
    const filters = filtersRes.data.filter || [];

    if (filters.length === 0) {
      console.log('No automated filter rules currently set up in this account.');
    } else {
      console.log(`Found ${filters.length} active filter rule(s):`);
      filters.forEach((f, idx) => {
        console.log(`\nRule #${idx + 1} (id: ${f.id}):`);
        console.log('  Criteria:', JSON.stringify(f.criteria, null, 2));
        console.log('  Action:  ', JSON.stringify(f.action, null, 2));
      });
    }
  } catch (err: unknown) {
    console.error('Audit failed:', err instanceof Error ? err.message : String(err));
  }
}

main();
