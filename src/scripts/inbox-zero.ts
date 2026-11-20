/**
 * Inbox Zero Full Sweep Engine.
 *
 * Scans all remaining emails currently residing in INBOX, categorizes them
 * based on their Gmail smart category and sender profile, applies the corresponding
 * structured taxonomy label, and archives them from INBOX in high-throughput batches.
 *
 * @packageDocumentation
 */

import { getAuthenticatedGmailClient } from '../services/gmail-client.js';
import { batchApplyTriage, syncTaxonomyLabels } from '../services/batch-triage-service.js';

/**
 * Executes a full sweep of all remaining messages in INBOX to reach true Inbox Zero.
 */
async function main(): Promise<void> {
  console.log('====================================================');
  console.log('         Inbox Zero Complete Sweep Engine           ');
  console.log('====================================================\n');

  const gmail = getAuthenticatedGmailClient();
  const labelMap = await syncTaxonomyLabels(gmail);

  const newslettersLabelId = labelMap['Newsletters'];
  const socialLabelId = labelMap['Social'];
  const alertsLabelId = labelMap['System/Alerts'];
  const archiveLabelId = labelMap['Reference/Archive'];

  const categoryConfigs = [
    { name: 'Promotions', query: 'label:INBOX category:promotions', targetLabelId: newslettersLabelId, labelName: 'Newsletters' },
    { name: 'Social', query: 'label:INBOX category:social', targetLabelId: socialLabelId, labelName: 'Social' },
    { name: 'Updates', query: 'label:INBOX category:updates', targetLabelId: alertsLabelId, labelName: 'System/Alerts' },
    { name: 'Remaining / Other', query: 'label:INBOX', targetLabelId: archiveLabelId, labelName: 'Reference/Archive' },
  ];

  let totalTriaged = 0;

  for (const config of categoryConfigs) {
    console.log(`🔍 Scanning: ${config.name} (${config.query})...`);
    let pageToken: string | undefined;
    const matchedIds: string[] = [];

    do {
      const res = await gmail.users.messages.list({
        userId: 'me',
        q: config.query,
        maxResults: 500,
        pageToken,
      });

      const msgs = res.data.messages || [];
      for (const m of msgs) {
        if (m.id && !matchedIds.includes(m.id)) {
          matchedIds.push(m.id);
        }
      }
      pageToken = res.data.nextPageToken || undefined;
    } while (pageToken);

    console.log(`   Found ${matchedIds.length} message(s) for ${config.name}.`);

    if (matchedIds.length > 0 && config.targetLabelId) {
      console.log(`   📦 Moving ${matchedIds.length} message(s) to [${config.labelName}] & removing from INBOX...`);
      const result = await batchApplyTriage(
        gmail,
        matchedIds,
        [config.targetLabelId],
        ['INBOX']
      );
      totalTriaged += result.modifiedCount;
      console.log(`   ✅ Successfully triaged ${result.modifiedCount} message(s).\n`);
    } else {
      console.log(`   No remaining messages to triage for this category.\n`);
    }
  }

  // Final validation of INBOX count
  const finalInboxRes = await gmail.users.messages.list({
    userId: 'me',
    q: 'label:INBOX',
    maxResults: 10,
  });

  const remaining = finalInboxRes.data.messages?.length || 0;

  console.log('====================================================');
  console.log('                Inbox Zero Report                   ');
  console.log('====================================================');
  console.log(`Total messages triaged in this pass: ${totalTriaged}`);
  console.log(`Current messages in INBOX:           ${remaining}`);

  if (remaining === 0) {
    console.log('\n🎉 CONGRATULATIONS! You have reached TRUE INBOX ZERO! 🎯');
  } else {
    console.log(`\nRemaining messages in INBOX: ${remaining}.`);
  }
}

main().catch((err: unknown) => {
  console.error('Fatal Inbox Zero error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
