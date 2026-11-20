/**
 * Gmail Label Taxonomy Restructuring and Automated Filter Creator.
 *
 * 1. Restructures existing Gmail labels into clean, standardized hierarchies
 *    based on user-configured or baseline taxonomy mappings.
 * 2. Creates persistent server-side Google filter rules for recurring senders with
 *    "Skip Inbox" (`removeLabelIds: ['INBOX']`) explicitly enforced.
 *
 * @packageDocumentation
 */

import { getAuthenticatedGmailClient } from '../services/gmail-client.js';
import { createPersistentFilter } from '../services/batch-triage-service.js';
import { loadRulesConfig } from '../utils/config-loader.js';

/**
 * Executes taxonomy restructuring and filter creation.
 */
async function main(): Promise<void> {
  console.log('====================================================');
  console.log('       Gmail Taxonomy Restructuring & Filters       ');
  console.log('====================================================\n');

  const config = loadRulesConfig();
  const labelRenameMap = config.labelRenameMap || {};
  const automatedRules = config.automatedRules || [];

  console.log(`📋 Loaded ${Object.keys(labelRenameMap).length} label rename mapping(s).`);
  console.log(`📋 Loaded ${automatedRules.length} automated rule(s) to synchronize.\n`);

  const gmail = getAuthenticatedGmailClient();

  // 1. Fetch current labels
  console.log('🏷️  Step 1: Auditing and restructuring labels...');
  const labelsRes = await gmail.users.labels.list({ userId: 'me' });
  const allLabels = labelsRes.data.labels || [];
  const labelMapByName: Record<string, string> = {};

  for (const label of allLabels) {
    if (label.name && label.id) {
      labelMapByName[label.name] = label.id;
    }
  }

  // 2. Rename labels in place to clean hierarchies
  for (const [oldName, newName] of Object.entries(labelRenameMap)) {
    const labelId = labelMapByName[oldName];
    if (!labelId) continue;
    if (oldName === newName) continue;

    try {
      console.log(`  🔄 Renaming [${oldName}] -> [${newName}]...`);
      await gmail.users.labels.patch({
        userId: 'me',
        id: labelId,
        requestBody: {
          name: newName,
          labelListVisibility: 'labelShow',
          messageListVisibility: 'show',
        },
      });
      // Update our local map
      delete labelMapByName[oldName];
      labelMapByName[newName] = labelId;
    } catch (err: unknown) {
      console.warn(`  ⚠️  Failed to rename "${oldName}":`, err instanceof Error ? err.message : String(err));
    }
  }

  // 3. Ensure any missing target labels exist
  console.log('\n📁 Step 2: Ensuring all target labels exist...');
  for (const rule of automatedRules) {
    if (!labelMapByName[rule.targetLabelName]) {
      console.log(`  ➕ Creating missing label [${rule.targetLabelName}]...`);
      const created = await gmail.users.labels.create({
        userId: 'me',
        requestBody: {
          name: rule.targetLabelName,
          labelListVisibility: 'labelShow',
          messageListVisibility: 'show',
        },
      });
      if (created.data.name && created.data.id) {
        labelMapByName[created.data.name] = created.data.id;
      }
    }
  }

  // 4. Fetch existing filters to avoid duplicates
  console.log('\n⚙️  Step 3: Checking existing filters...');
  const existingFiltersRes = await gmail.users.settings.filters.list({ userId: 'me' });
  const existingFilters = existingFiltersRes.data.filter || [];
  console.log(`Found ${existingFilters.length} existing filter(s).`);

  // Check if rule (verify device) needs Skip Inbox
  for (const f of existingFilters) {
    if (f.criteria?.subject?.includes('verify') && !f.action?.removeLabelIds?.includes('INBOX')) {
      console.log(`  🔄 Updating filter #${f.id} to enforce "Skip Inbox"...`);
      if (f.id) {
        await gmail.users.settings.filters.delete({ userId: 'me', id: f.id });
        await gmail.users.settings.filters.create({
          userId: 'me',
          requestBody: {
            criteria: f.criteria,
            action: {
              addLabelIds: f.action?.addLabelIds || [],
              removeLabelIds: ['INBOX'],
            },
          },
        });
        console.log('  ✅ Filter updated with Skip Inbox.');
      }
    }
  }

  // 5. Create new persistent filters with "Skip Inbox"
  console.log('\n⚡ Step 4: Creating new automated persistent filters (Skip Inbox enforced)...');
  let createdCount = 0;

  for (const rule of automatedRules) {
    const targetLabelId = labelMapByName[rule.targetLabelName];
    if (!targetLabelId) {
      console.warn(`  ⚠️  Target label "${rule.targetLabelName}" could not be resolved. Skipping rule "${rule.name}".`);
      continue;
    }

    // Check if a filter with identical criteria already exists
    const duplicate = existingFilters.find(
      (ef) => ef.criteria?.from?.toLowerCase() === rule.criteria.from?.toLowerCase()
    );

    if (duplicate) {
      console.log(`  ℹ️  Filter for "${rule.name}" already exists (${duplicate.id}). Skipping.`);
      continue;
    }

    const removeLabelIds = rule.removeLabelIds || ['INBOX'];

    console.log(`  ➕ Creating rule for "${rule.name}":`);
    console.log(`     From: ${rule.criteria.from || ''}`);
    console.log(`     Action: Add [${rule.targetLabelName}] + Remove [${removeLabelIds.join(', ')}]`);

    const createdFilter = await createPersistentFilter(
      gmail,
      rule.criteria,
      {
        addLabelIds: [targetLabelId],
        removeLabelIds, // SKIP INBOX!
      }
    );

    console.log(`     ✅ Created filter ID: ${createdFilter.id}`);
    createdCount++;
  }

  console.log('\n====================================================');
  console.log('                    Summary                         ');
  console.log('====================================================');
  console.log(`✨ Labels restructured to clean standardized hierarchies.`);
  console.log(`✨ Created ${createdCount} new automated filter rule(s) with "Skip Inbox" enforced.`);
  console.log('All future incoming emails matching these rules will bypass INBOX automatically!\n');
}

main().catch((err: unknown) => {
  console.error('Fatal error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
