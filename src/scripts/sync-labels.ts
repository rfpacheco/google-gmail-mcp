/**
 * CLI Tool for Synchronizing Gmail Label Taxonomy.
 *
 * Ensures all standard organizational labels (Action Required, Work, Finance,
 * Reading/Newsletters, etc.) exist in the user's Gmail account.
 *
 * @packageDocumentation
 */

import { getAuthenticatedGmailClient, checkCredentialsStatus } from '../services/gmail-client.js';
import { syncTaxonomyLabels } from '../services/batch-triage-service.js';

/**
 * Executes taxonomy label synchronization.
 */
async function main(): Promise<void> {
  console.log('====================================================');
  console.log('        Gmail Label Taxonomy Synchronizer           ');
  console.log('====================================================\n');

  const { hasKeys, hasTokens } = checkCredentialsStatus();
  if (!hasKeys || !hasTokens) {
    console.error('❌ Credentials missing or unauthenticated. Please run "npm run auth" first.');
    process.exit(1);
  }

  try {
    const gmail = getAuthenticatedGmailClient();
    console.log('🔄 Synchronizing taxonomy labels with Gmail...');
    const labelMap = await syncTaxonomyLabels(gmail);

    console.log('\n✅ All baseline taxonomy labels synchronized successfully:');
    Object.entries(labelMap).forEach(([name, id]) => {
      console.log(` - ${name.padEnd(25)} [ID: ${id}]`);
    });
  } catch (err: unknown) {
    console.error('❌ Synchronization failed:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

main();
