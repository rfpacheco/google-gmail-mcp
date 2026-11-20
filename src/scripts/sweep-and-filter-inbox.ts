/**
 * Gmail Automated Sweep, Filter Expansion, and Triage Engine.
 *
 * Checks INBOX for unorganized emails, generates persistent server-side filters
 * with "Skip Inbox" enforced for recurring senders based on external configuration,
 * and batch-triages remaining emails into standardized hierarchical taxonomy labels
 * to maintain True Inbox Zero.
 *
 * @packageDocumentation
 */

import { getAuthenticatedGmailClient } from '../services/gmail-client.js';
import {
  batchApplyTriage,
  createPersistentFilter,
  syncTaxonomyLabels,
} from '../services/batch-triage-service.js';
import { loadRulesConfig } from '../utils/config-loader.js';

/**
 * Main execution function to register filters, organize messages, and verify Inbox Zero.
 */
async function main(): Promise<void> {
  console.log('====================================================');
  console.log('   Gmail Filter Expansion & Inbox Re-ordering       ');
  console.log('====================================================\n');

  const config = loadRulesConfig();
  const automatedRules = config.automatedRules || [];
  const senderMappings = config.senderTriageMappings || [];

  console.log(`📋 Loaded ${automatedRules.length} automated rule(s) from configuration.`);
  console.log(`📋 Loaded ${senderMappings.length} sender triage mapping(s).\n`);

  const gmail = getAuthenticatedGmailClient();
  const labelMap = await syncTaxonomyLabels(gmail);

  // 1. Audit and register new persistent server-side filters
  console.log('⚡ Step 1: Checking and registering persistent server-side filters...');
  const existingFiltersRes = await gmail.users.settings.filters.list({ userId: 'me' });
  const existingFilters = existingFiltersRes.data.filter || [];
  console.log(`Currently registered filters: ${existingFilters.length}`);

  // Clean up outdated langchain.dev filter if present so it does not conflict
  for (const f of existingFilters) {
    if (f.criteria?.from === 'langchain.dev OR mail.langchain.dev' && f.id) {
      console.log(`  🗑️  Removing outdated LangChain filter #${f.id}...`);
      await gmail.users.settings.filters.delete({ userId: 'me', id: f.id });
    }
  }

  let createdFilterCount = 0;
  for (const rule of automatedRules) {
    const targetLabelId = labelMap[rule.targetLabelName];
    if (!targetLabelId) {
      console.warn(`  ⚠️  Target label "${rule.targetLabelName}" not found. Skipping rule "${rule.name}".`);
      continue;
    }

    const duplicate = existingFilters.find(
      (ef) => ef.criteria?.from?.toLowerCase() === rule.criteria.from?.toLowerCase()
    );

    if (duplicate) {
      console.log(`  ℹ️  Filter for "${rule.name}" already active (${duplicate.id}). Skipping.`);
      continue;
    }

    const removeLabelIds = rule.removeLabelIds || ['INBOX'];

    console.log(`  ➕ Creating filter: "${rule.name}"`);
    console.log(`     From: ${rule.criteria.from || ''}`);
    console.log(`     Action: Add [${rule.targetLabelName}] + Remove [${removeLabelIds.join(', ')}]`);

    const created = await createPersistentFilter(gmail, rule.criteria, {
      addLabelIds: [targetLabelId],
      removeLabelIds,
    });

    console.log(`     ✅ Created filter ID: ${created.id}`);
    createdFilterCount++;
  }

  console.log(`\n✅ Filter registration complete. Added ${createdFilterCount} new server-side rule(s).\n`);

  // 2. Fetch all messages currently in INBOX
  console.log('📬 Step 2: Inspecting remaining unorganized messages in INBOX...');
  const inboxRes = await gmail.users.messages.list({
    userId: 'me',
    q: 'label:INBOX',
    maxResults: 100,
  });

  const inboxMessages = inboxRes.data.messages || [];
  console.log(`Found ${inboxMessages.length} message(s) in INBOX.\n`);

  if (inboxMessages.length === 0) {
    console.log('✨ INBOX is already empty! True Inbox Zero achieved.');
    return;
  }

  // 3. Triage each message to its appropriate label
  console.log('🏷️  Step 3: Categorizing and triaging messages from INBOX...');

  for (const m of inboxMessages) {
    if (!m.id) continue;
    const msg = await gmail.users.messages.get({
      userId: 'me',
      id: m.id,
      format: 'metadata',
      metadataHeaders: ['From', 'Subject', 'Date'],
    });

    const headers = msg.data.payload?.headers || [];
    const from = (headers.find((h) => h.name === 'From')?.value || '').toLowerCase();
    const subject = headers.find((h) => h.name === 'Subject')?.value || '';

    let targetLabelName = 'Reference/Archive';
    const additionalLabels: string[] = [];

    // Match against configured sender triage mappings
    let matched = false;
    for (const mapping of senderMappings) {
      if (from.includes(mapping.match.toLowerCase())) {
        targetLabelName = mapping.targetLabel;
        if (mapping.additionalLabels) {
          additionalLabels.push(...mapping.additionalLabels);
        }
        matched = true;
        break;
      }
    }

    if (!matched) {
      // General fallbacks based on common domain prefixes
      if (from.includes('github.com')) {
        targetLabelName = 'Dev/GitHub';
      } else if (from.includes('google.com')) {
        targetLabelName = 'System/Alerts';
      }
    }

    const targetLabelId = labelMap[targetLabelName];
    const addLabelIds: string[] = [];
    if (targetLabelId) addLabelIds.push(targetLabelId);
    for (const extra of additionalLabels) {
      if (labelMap[extra]) addLabelIds.push(labelMap[extra]);
    }

    console.log(`  📦 [${m.id}] "${subject}" (${from})`);
    console.log(
      `     -> Assigning [${targetLabelName}${additionalLabels.length ? ', ' + additionalLabels.join(', ') : ''}] & archiving from INBOX...`
    );

    await batchApplyTriage(gmail, [m.id], addLabelIds, ['INBOX']);
  }

  // 4. Verify INBOX count
  console.log('\n🎯 Step 4: Final verification of INBOX count...');
  const verifyRes = await gmail.users.messages.list({
    userId: 'me',
    q: 'label:INBOX',
    maxResults: 10,
  });

  const remaining = verifyRes.data.messages?.length || 0;
  console.log('====================================================');
  console.log('                  Summary Report                    ');
  console.log('====================================================');
  console.log(`Server-side filters created: ${createdFilterCount}`);
  console.log(`Messages triaged & archived: ${inboxMessages.length}`);
  console.log(`Remaining messages in INBOX: ${remaining}`);

  if (remaining === 0) {
    console.log('\n🎉 SUCCESS: All unorganized messages triaged and TRUE INBOX ZERO restored! 🎯\n');
  } else {
    console.log(`\n⚠️  Notice: ${remaining} message(s) still remain in INBOX.\n`);
  }
}

main().catch((err: unknown) => {
  console.error('Fatal error during sweep and filter execution:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
