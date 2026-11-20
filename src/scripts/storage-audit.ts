/**
 * Gmail Storage Reclamation and Large Attachment Audit Tool.
 *
 * Scans the user's Gmail account for heavy emails (attachments >10MB and >5MB),
 * retrieves metadata, sorts them deterministically by payload size (largest first),
 * and generates a comprehensive storage report.
 *
 * @packageDocumentation
 */

import { getAuthenticatedGmailClient } from '../services/gmail-client.js';
import { GmailSorter, EmailSummary } from '../sorting-and-filtering/sorter.js';
import { syncTaxonomyLabels } from '../services/batch-triage-service.js';

/**
 * Format bytes into human-readable MB / GB.
 *
 * @param bytes - Size in bytes.
 * @returns Formatted size string.
 */
function formatBytes(bytes?: number): string {
  if (!bytes) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(2)} GB`;
  }
  return `${mb.toFixed(2)} MB`;
}

/**
 * Executes the large attachment storage audit.
 */
async function main(): Promise<void> {
  console.log('====================================================');
  console.log('       Gmail Storage Reclamation & Size Audit        ');
  console.log('====================================================\n');

  const gmail = getAuthenticatedGmailClient();
  const labelMap = await syncTaxonomyLabels(gmail);

  // Invert labelMap to resolve ID -> Name
  const idToName: Record<string, string> = {};
  for (const [name, id] of Object.entries(labelMap)) {
    idToName[id] = name;
  }

  // 1. Scan for emails >10MB
  console.log('🔍 Scanning for messages larger than 10MB (query: "larger:10M")...');
  const res10M = await gmail.users.messages.list({
    userId: 'me',
    q: 'larger:10M',
    maxResults: 100,
  });

  const messageRefs10M = res10M.data.messages || [];
  console.log(`Found ${messageRefs10M.length} message(s) larger than 10MB.\n`);

  // 2. Scan for emails >5MB
  console.log('🔍 Scanning for messages larger than 5MB (query: "larger:5M")...');
  const res5M = await gmail.users.messages.list({
    userId: 'me',
    q: 'larger:5M',
    maxResults: 150,
  });

  const messageRefs5M = res5M.data.messages || [];
  console.log(`Found ${messageRefs5M.length} message(s) larger than 5MB.\n`);

  const targetRefs = messageRefs10M.length > 0 ? messageRefs10M : messageRefs5M;
  const sizeThresholdLabel = messageRefs10M.length > 0 ? '10MB' : '5MB';

  if (targetRefs.length === 0) {
    console.log('✅ Great news! No heavy emails found above 5MB in your entire account.');
    return;
  }

  console.log(`📦 Fetching detailed payload metadata for ${targetRefs.length} heavy email(s)...`);
  const summaries: EmailSummary[] = [];
  let totalBytes = 0;

  // Fetch in concurrent batches of 10
  const BATCH_SIZE = 10;
  for (let i = 0; i < targetRefs.length; i += BATCH_SIZE) {
    const chunk = targetRefs.slice(i, i + BATCH_SIZE);
    const promises = chunk.map(async (ref) => {
      if (!ref.id) return null;
      try {
        const msg = await gmail.users.messages.get({
          userId: 'me',
          id: ref.id,
          format: 'metadata',
          metadataHeaders: ['From', 'Subject', 'Date', 'To'],
        });

        const headers = msg.data.payload?.headers || [];
        const getHeader = (name: string): string =>
          headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

        const size = msg.data.sizeEstimate || 0;
        totalBytes += size;

        const summary: EmailSummary = {
          id: msg.data.id || ref.id,
          threadId: msg.data.threadId || undefined,
          from: getHeader('From'),
          to: getHeader('To') ? [getHeader('To')] : undefined,
          subject: getHeader('Subject'),
          date: getHeader('Date') || (msg.data.internalDate ? parseInt(msg.data.internalDate, 10) : new Date()),
          sizeEstimate: size,
          labelIds: msg.data.labelIds || [],
          snippet: msg.data.snippet || undefined,
        };
        return summary;
      } catch {
        return null;
      }
    });

    const results = await Promise.all(promises);
    for (const item of results) {
      if (item) summaries.push(item);
    }
  }

  // Sort descending by size (largest first)
  const sortedEmails = GmailSorter.sort(summaries, {
    field: 'size',
    direction: 'desc',
  });

  console.log('\n====================================================');
  console.log(`       Top Storage-Consuming Emails (>${sizeThresholdLabel})       `);
  console.log('====================================================\n');

  sortedEmails.forEach((e, idx) => {
    const labels = (e.labelIds || [])
      .map((id) => idToName[id] || id)
      .filter((n) => n !== 'UNREAD');
    const dateStr = typeof e.date === 'string' ? e.date.slice(0, 16) : new Date(e.date).toLocaleDateString();

    console.log(`${(idx + 1).toString().padStart(2, ' ')}. [${formatBytes(e.sizeEstimate).padEnd(9)}] ID: ${e.id}`);
    console.log(`    From:    ${e.from}`);
    console.log(`    Subject: "${e.subject || '(no subject)'}"`);
    console.log(`    Date:    ${dateStr}`);
    console.log(`    Labels:  [${labels.join(', ')}]`);
    console.log('');
  });

  console.log('====================================================');
  console.log('              Storage Audit Summary                 ');
  console.log('====================================================');
  console.log(`Total heavy emails analyzed: ${sortedEmails.length}`);
  console.log(`Total storage occupied:     ${formatBytes(totalBytes)}`);
  console.log('====================================================\n');
}

main().catch((err: unknown) => {
  console.error('Fatal storage audit error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
