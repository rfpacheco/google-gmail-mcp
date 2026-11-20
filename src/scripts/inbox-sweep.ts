/**
 * Inbox Cleanup Sweep Utility.
 *
 * Scans the user's INBOX for older promotional, social, and automated notification
 * emails, sorts them, and batch-triages them into appropriate taxonomy labels
 * while removing them from INBOX.
 *
 * @packageDocumentation
 */

import { getAuthenticatedGmailClient } from '../services/gmail-client.js';
import {
  searchAndSortEmails,
  batchApplyTriage,
  syncTaxonomyLabels,
} from '../services/batch-triage-service.js';

/**
 * Sweep category configuration.
 */
interface SweepConfig {
  name: string;
  queryCriteria: {
    category?: 'promotions' | 'social' | 'updates' | 'forums';
    olderThan?: string;
    label?: string;
  };
  targetLabelName: string;
  removeInbox: boolean;
  maxBatchSize: number;
}

/**
 * Executes the inbox cleanup sweep across promotional, social, and update categories.
 */
async function main(): Promise<void> {
  console.log('====================================================');
  console.log('             Gmail Inbox Cleanup Sweep              ');
  console.log('====================================================\n');

  const gmail = getAuthenticatedGmailClient();
  const labelMap = await syncTaxonomyLabels(gmail);

  // 1. Analyze Inbox composition
  console.log('📊 Analyzing INBOX breakdown...');

  const categories = ['promotions', 'social', 'updates', 'forums'] as const;
  for (const cat of categories) {
    const res = await gmail.users.messages.list({
      userId: 'me',
      q: `label:INBOX category:${cat}`,
      maxResults: 1,
    });
    const count = res.data.resultSizeEstimate || 0;
    console.log(` - category:${cat.padEnd(12)} ~${count} message(s) in INBOX`);
  }

  // 2. Define sweeps to execute
  const sweeps: SweepConfig[] = [
    {
      name: 'Promotional / Marketing Emails (older than 7d)',
      queryCriteria: {
        category: 'promotions',
        olderThan: '7d',
        label: 'INBOX',
      },
      targetLabelName: 'Newsletters',
      removeInbox: true,
      maxBatchSize: 100,
    },
    {
      name: 'Social Network Notifications (older than 7d)',
      queryCriteria: {
        category: 'social',
        olderThan: '7d',
        label: 'INBOX',
      },
      targetLabelName: 'SocialWeb',
      removeInbox: true,
      maxBatchSize: 100,
    },
    {
      name: 'Automated Updates & Alerts (older than 14d)',
      queryCriteria: {
        category: 'updates',
        olderThan: '14d',
        label: 'INBOX',
      },
      targetLabelName: 'System/Alerts',
      removeInbox: true,
      maxBatchSize: 100,
    },
  ];

  console.log('\n🚀 Starting Batch Sweeps...\n');

  for (const sweep of sweeps) {
    console.log(`▶ Executing: ${sweep.name}`);
    const targetLabelId = labelMap[sweep.targetLabelName];

    if (!targetLabelId) {
      console.log(`  ⚠️  Target label "${sweep.targetLabelName}" not found in label map. Skipping.`);
      continue;
    }

    const searchResult = await searchAndSortEmails(
      gmail,
      sweep.queryCriteria,
      { field: 'date', direction: 'desc' },
      sweep.maxBatchSize
    );

    console.log(`  Query: "${searchResult.query}"`);
    console.log(`  Matched: ${searchResult.totalFound} | Retrieved: ${searchResult.sortedEmails.length}`);

    if (searchResult.sortedEmails.length === 0) {
      console.log('  No emails matched this sweep.\n');
      continue;
    }

    const sample = searchResult.sortedEmails.slice(0, 3);
    console.log('  Top sample items:');
    sample.forEach((e, idx) => {
      console.log(`   ${idx + 1}. [${e.from}] "${e.subject}"`);
    });

    const idsToTriage = searchResult.sortedEmails.map((e) => e.id);
    const removeLabels = sweep.removeInbox ? ['INBOX'] : [];

    console.log(`  📦 Moving ${idsToTriage.length} message(s) to [${sweep.targetLabelName}]...`);
    const triageResult = await batchApplyTriage(
      gmail,
      idsToTriage,
      [targetLabelId],
      removeLabels
    );

    console.log(`  ✅ Successfully triaged ${triageResult.modifiedCount} message(s).\n`);
  }

  // 3. Post-sweep status
  const profile = await gmail.users.getProfile({ userId: 'me' });
  const inboxRes = await gmail.users.messages.list({
    userId: 'me',
    q: 'label:INBOX',
    maxResults: 1,
  });

  console.log('====================================================');
  console.log('                Sweep Summary Report                ');
  console.log('====================================================');
  console.log(`Remaining messages in INBOX: ~${inboxRes.data.resultSizeEstimate || 0}`);
  console.log(`Total messages in account:   ${profile.data.messagesTotal}`);
  console.log('Inbox cleanup completed successfully!\n');
}

main().catch((err: unknown) => {
  console.error('Fatal sweep error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
