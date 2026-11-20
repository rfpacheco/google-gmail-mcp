/**
 * Safe Storage Purge and Mailbox Reclamation Engine.
 *
 * Evaluates candidate emails (e.g. heavy attachments, messages older than 5 years)
 * against a user-configurable whitelist protection policy before trashing.
 * Defaults to safe dry-run mode unless `--execute` is explicitly passed.
 *
 * @packageDocumentation
 */

import { getAuthenticatedGmailClient } from '../services/gmail-client.js';
import { loadPurgeConfig } from '../utils/config-loader.js';

/**
 * Checks whether an email matches any of the protection whitelist criteria.
 *
 * @param from - Sender header.
 * @param to - Recipient header.
 * @param cc - CC header.
 * @param subject - Subject header.
 * @param patterns - Whitelist substring patterns.
 * @returns True if protected, false otherwise.
 */
function isProtected(
  from: string,
  to: string,
  cc: string,
  subject: string,
  patterns: string[]
): boolean {
  if (!patterns || patterns.length === 0) {
    return false;
  }
  const combined = `${from} ${to} ${cc} ${subject}`.toLowerCase();
  return patterns.some((pattern) => combined.includes(pattern.toLowerCase()));
}

/**
 * Executes the safe purge engine.
 */
async function main(): Promise<void> {
  const isExecute = process.argv.includes('--execute');
  const isDryRun = process.argv.includes('--dry-run') || !isExecute;

  console.log('====================================================');
  console.log('       Safe Purge & Storage Reclamation Engine      ');
  console.log('====================================================');
  console.log(`Mode: ${isDryRun ? '🔍 DRY RUN (Simulated)' : '⚡ LIVE EXECUTION'}\n`);

  if (isDryRun) {
    console.log('ℹ️  Running in safe dry-run mode. No emails will be trashed.');
    console.log('   Pass `--execute` to perform the actual deletion.\n');
  }

  const config = loadPurgeConfig();
  const protectionPatterns = config.protectionPatterns || [];
  const candidateIds = config.candidateIds || [];
  const candidateQuery = config.candidateQuery || 'older_than:5y';

  console.log(`📋 Loaded protection patterns: ${protectionPatterns.length} rule(s)`);
  console.log(`🔍 Candidate search query:    "${candidateQuery}"`);
  console.log(`📌 Explicit candidate IDs:    ${candidateIds.length} item(s)\n`);

  const gmail = getAuthenticatedGmailClient();

  // 1. Gather messages matching candidate query
  console.log(`🔍 Querying Gmail for candidates (${candidateQuery})...`);
  const queryMatchedIds: string[] = [];
  let pageToken: string | undefined;

  do {
    const res = await gmail.users.messages.list({
      userId: 'me',
      q: candidateQuery,
      maxResults: 500,
      pageToken,
    });
    const msgs = res.data.messages || [];
    for (const m of msgs) {
      if (m.id && !queryMatchedIds.includes(m.id)) {
        queryMatchedIds.push(m.id);
      }
    }
    pageToken = res.data.nextPageToken || undefined;
  } while (pageToken);

  console.log(`Found ${queryMatchedIds.length} candidate message(s) via query search.`);

  // Combine and deduplicate
  const allCandidateIds = Array.from(new Set([...candidateIds, ...queryMatchedIds]));
  console.log(`Total unique candidate IDs to evaluate: ${allCandidateIds.length}\n`);

  if (allCandidateIds.length === 0) {
    console.log('No messages eligible for evaluation.');
    return;
  }

  // 2. Inspect candidates against whitelist
  console.log('🛡️  Evaluating candidates against protection whitelist...');
  const safeToPurgeIds: string[] = [];
  const protectedEmails: Array<{ id: string; from: string; subject: string }> = [];

  for (const id of allCandidateIds) {
    try {
      const msg = await gmail.users.messages.get({
        userId: 'me',
        id,
        format: 'metadata',
        metadataHeaders: ['From', 'To', 'Cc', 'Subject', 'Date'],
      });

      const headers = msg.data.payload?.headers || [];
      const getHeader = (name: string): string =>
        headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

      const from = getHeader('From');
      const to = getHeader('To');
      const cc = getHeader('Cc');
      const subject = getHeader('Subject');

      if (isProtected(from, to, cc, subject, protectionPatterns)) {
        protectedEmails.push({ id, from, subject });
        console.log(`  🔒 PROTECTED: [${from}] "${subject}" (id: ${id})`);
      } else {
        safeToPurgeIds.push(id);
      }
    } catch {
      // If message cannot be retrieved, do not purge
    }
  }

  console.log(`\nProtection audit summary:`);
  console.log(` - Whitelist Protected: ${protectedEmails.length} message(s) strictly preserved.`);
  console.log(` - Eligible for Purge:  ${safeToPurgeIds.length} message(s).\n`);

  if (safeToPurgeIds.length === 0) {
    console.log('All candidates are protected. Zero messages eligible for purge.');
    return;
  }

  // 3. Execute or simulate trash operation
  let trashedCount = 0;

  if (isDryRun) {
    console.log(`[DRY RUN] Would move ${safeToPurgeIds.length} message(s) to Trash.`);
    console.log('To execute this purge, rerun with: npm run purge -- --execute\n');
  } else {
    console.log(`🗑️  Moving ${safeToPurgeIds.length} message(s) to Trash...`);
    for (const id of safeToPurgeIds) {
      try {
        await gmail.users.messages.trash({
          userId: 'me',
          id,
        });
        trashedCount++;
      } catch (err: unknown) {
        console.warn(`Failed to trash message ${id}:`, err instanceof Error ? err.message : String(err));
      }
    }
  }

  console.log('====================================================');
  console.log('                 Purge Report                       ');
  console.log('====================================================');
  console.log(`Status:                      ${isDryRun ? 'Simulated (Dry Run)' : 'Executed'}`);
  console.log(`Total messages moved to Trash: ${trashedCount}`);
  console.log(`Total whitelist protected:    ${protectedEmails.length}`);
  console.log('Protected emails remain 100% untouched and preserved in your mailbox.\n');
}

main().catch((err: unknown) => {
  console.error('Fatal purge error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
