/**
 * CLI Tool for Running Automated Batch Triage Sweeps.
 *
 * Demonstrates headless execution of query filtering, deterministic sorting,
 * and bulk label modification without LLM latency.
 *
 * @packageDocumentation
 */

import { getAuthenticatedGmailClient, checkCredentialsStatus } from '../services/gmail-client.js';
import {
  searchAndSortEmails,
  batchApplyTriage,
  syncTaxonomyLabels,
} from '../services/batch-triage-service.js';

/**
 * Runs a sample batch triage sweep (e.g. finding newsletters in the inbox and categorizing them).
 */
async function main(): Promise<void> {
  console.log('====================================================');
  console.log('            Gmail Batch Triage Runner               ');
  console.log('====================================================\n');

  const { hasKeys, hasTokens } = checkCredentialsStatus();
  if (!hasKeys || !hasTokens) {
    console.error('❌ Credentials missing or unauthenticated. Please run "npm run auth" first.');
    process.exit(1);
  }

  const gmail = getAuthenticatedGmailClient();
  const labelMap = await syncTaxonomyLabels(gmail);

  console.log('🔍 Searching unread newsletters in INBOX older than 7 days...');
  const searchResult = await searchAndSortEmails(
    gmail,
    {
      category: 'promotions',
      olderThan: '7d',
      label: 'INBOX',
    },
    {
      field: 'date',
      direction: 'desc',
    },
    25
  );

  console.log(`Matched ${searchResult.totalFound} email(s) with query: ${searchResult.query}`);
  if (searchResult.sortedEmails.length === 0) {
    console.log('No matching messages found for this sweep.');
    return;
  }

  console.log('\nTop sorted emails:');
  searchResult.sortedEmails.slice(0, 5).forEach((e, idx) => {
    console.log(` ${idx + 1}. From: ${e.from} | Subject: "${e.subject}"`);
  });

  const targetLabelName = 'Newsletters';
  const targetLabelId = labelMap[targetLabelName];

  if (!targetLabelId) {
    console.log(`Target label "${targetLabelName}" not found in label map.`);
    return;
  }

  const idsToTriage = searchResult.sortedEmails.map((e) => e.id);
  console.log(`\n📦 Batch-triaging ${idsToTriage.length} message(s): adding [${targetLabelName}], removing [INBOX]...`);

  const triageResult = await batchApplyTriage(gmail, idsToTriage, [targetLabelId], ['INBOX']);
  console.log(`✅ Successfully processed ${triageResult.modifiedCount} email(s) in a single atomic batch.`);
}

main();
