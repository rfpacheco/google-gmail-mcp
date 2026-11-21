#!/usr/bin/env node
/**
 * Hybrid Gmail MCP Server and CLI.
 *
 * Implements high-level, coarse-grained Model Context Protocol tools for AI agents
 * (Claude Code, Cursor, Copilot), backed by the shared sorting, filtering, and batch-triage engine.
 * Also provides an interactive `auth` CLI subcommand for seamless user onboarding via npx.
 *
 * @packageDocumentation
 */

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  getAuthenticatedGmailClient,
  checkCredentialsStatus,
  runInteractiveAuth,
} from '../services/gmail-client.js';
import {
  searchAndSortEmails,
  batchApplyTriage,
  syncTaxonomyLabels,
  createPersistentFilter,
} from '../services/batch-triage-service.js';
import { SortField, SortDirection } from '../sorting-and-filtering/sorter.js';

/**
 * Initializes and starts the Hybrid Gmail MCP Server over Stdio.
 */
export async function startHybridMcpServer(): Promise<void> {
  const server = new McpServer({
    name: 'google-gmail-mcp',
    version: '1.0.0',
  });

  /**
   * Tool 1: gmail_search_and_sort
   * Searches emails with native operators and applies client-side sorting.
   */
  server.tool(
    'gmail_search_and_sort',
    'Searches emails with structured criteria and returns client-side sorted results (by date, size, from, or subject).',
    {
      from: z.string().optional().describe('Sender email or domain'),
      to: z.string().optional().describe('Recipient email'),
      subject: z.string().optional().describe('Subject keyword or phrase'),
      text: z.string().optional().describe('Free text terms in email body'),
      hasAttachment: z.boolean().optional().describe('Filter messages containing attachments'),
      afterDate: z.string().optional().describe('Filter after date (YYYY-MM-DD or YYYY/MM/DD)'),
      beforeDate: z.string().optional().describe('Filter before date (YYYY-MM-DD or YYYY/MM/DD)'),
      isUnread: z.boolean().optional().describe('True for unread only, false for read only'),
      label: z.string().optional().describe('Gmail label name (e.g. INBOX, Work)'),
      category: z
        .enum(['primary', 'social', 'promotions', 'updates', 'forums'])
        .optional()
        .describe('Gmail smart category'),
      sortField: z
        .enum(['date', 'size', 'from', 'subject', 'unreadPriority', 'importance'])
        .default('date')
        .describe('Field to sort by'),
      sortDirection: z.enum(['asc', 'desc']).default('desc').describe('Sort order'),
      maxResults: z.number().min(1).max(250).default(50).describe('Max messages to retrieve and sort'),
    },
    async (args) => {
      const { hasTokens } = checkCredentialsStatus();
      if (!hasTokens) {
        return {
          content: [
            {
              type: 'text',
              text: 'Error: Gmail credentials are not authenticated. Run "npx google-gmail-mcp auth" first.',
            },
          ],
        };
      }

      const gmail = getAuthenticatedGmailClient();
      const sortField = args.sortField as SortField;
      const sortDirection = args.sortDirection as SortDirection;

      const result = await searchAndSortEmails(
        gmail,
        {
          from: args.from,
          to: args.to,
          subject: args.subject,
          text: args.text,
          hasAttachment: args.hasAttachment,
          afterDate: args.afterDate,
          beforeDate: args.beforeDate,
          isUnread: args.isUnread,
          label: args.label,
          category: args.category,
        },
        {
          field: sortField,
          direction: sortDirection,
        },
        args.maxResults
      );

      const summaryText = [
        `Search Query: "${result.query}"`,
        `Matched Messages: ${result.totalFound}`,
        `Retrieved & Sorted: ${result.sortedEmails.length}`,
        '',
        ...result.sortedEmails.map((e, idx) => {
          const dateStr = typeof e.date === 'string' ? e.date : new Date(e.date).toISOString();
          const sizeStr = e.sizeEstimate ? ` [${Math.round(e.sizeEstimate / 1024)} KB]` : '';
          return `${idx + 1}. [${e.id}] From: ${e.from} | Subject: "${e.subject}" | Date: ${dateStr}${sizeStr}`;
        }),
      ].join('\n');

      return {
        content: [
          {
            type: 'text',
            text: summaryText,
          },
        ],
      };
    }
  );

  /**
   * Tool 2: gmail_batch_triage
   * Applies or removes labels across multiple messages in bulk.
   */
  server.tool(
    'gmail_batch_triage',
    'Batch applies labels, archives, or marks emails as read in a single atomic operation.',
    {
      messageIds: z.array(z.string()).min(1).describe('Array of Gmail message IDs to modify'),
      addLabelNames: z.array(z.string()).optional().describe('Label names to apply (e.g. ["Work", "Finance"])'),
      archiveInbox: z.boolean().default(false).describe('Whether to remove the INBOX label (archive)'),
      markAsRead: z.boolean().default(false).describe('Whether to remove the UNREAD label (mark as read)'),
    },
    async (args) => {
      const { hasTokens } = checkCredentialsStatus();
      if (!hasTokens) {
        return {
          content: [
            {
              type: 'text',
              text: 'Error: Gmail credentials are not authenticated. Run "npx google-gmail-mcp auth" first.',
            },
          ],
        };
      }

      const gmail = getAuthenticatedGmailClient();
      const labelMap = await syncTaxonomyLabels(gmail);

      const addLabelIds: string[] = [];
      if (args.addLabelNames && args.addLabelNames.length > 0) {
        for (const name of args.addLabelNames) {
          const matchedId = labelMap[name] || labelMap[name.toUpperCase()];
          if (matchedId) {
            addLabelIds.push(matchedId);
          } else {
            const created = await gmail.users.labels.create({
              userId: 'me',
              requestBody: { name, labelListVisibility: 'labelShow', messageListVisibility: 'show' },
            });
            if (created.data.id) addLabelIds.push(created.data.id);
          }
        }
      }

      const removeLabelIds: string[] = [];
      if (args.archiveInbox) removeLabelIds.push('INBOX');
      if (args.markAsRead) removeLabelIds.push('UNREAD');

      const triageResult = await batchApplyTriage(gmail, args.messageIds, addLabelIds, removeLabelIds);

      return {
        content: [
          {
            type: 'text',
            text: `Successfully triaged ${triageResult.modifiedCount} message(s).\nAdded Labels: ${addLabelIds.join(', ') || 'None'}\nRemoved Labels: ${removeLabelIds.join(', ') || 'None'}`,
          },
        ],
      };
    }
  );

  /**
   * Tool 3: gmail_sync_taxonomy_labels
   * Idempotently creates the baseline taxonomy labels.
   */
  server.tool(
    'gmail_sync_taxonomy_labels',
    'Ensures all standardized organizational labels (Work, Finance, Newsletters, etc.) exist in the user Gmail account.',
    {},
    async () => {
      const { hasTokens } = checkCredentialsStatus();
      if (!hasTokens) {
        return {
          content: [
            {
              type: 'text',
              text: 'Error: Gmail credentials are not authenticated. Run "npx google-gmail-mcp auth" first.',
            },
          ],
        };
      }

      const gmail = getAuthenticatedGmailClient();
      const labelMap = await syncTaxonomyLabels(gmail);

      const lines = Object.entries(labelMap).map(([name, id]) => ` - ${name}: ${id}`);
      return {
        content: [
          {
            type: 'text',
            text: `Label taxonomy synchronized (${Object.keys(labelMap).length} labels total):\n${lines.join('\n')}`,
          },
        ],
      };
    }
  );

  /**
   * Tool 4: gmail_create_filter
   * Creates an automated incoming filter rule in Gmail settings.
   */
  server.tool(
    'gmail_create_filter',
    'Creates a persistent automated server-side filter rule in Gmail settings with Skip Inbox option.',
    {
      from: z.string().optional().describe('Sender email or domain to match'),
      subject: z.string().optional().describe('Subject keywords to match'),
      query: z.string().optional().describe('Search query matching email body/metadata'),
      targetLabelName: z.string().optional().describe('Label name to apply to matching emails'),
      archiveInbox: z.boolean().default(false).describe('Whether to skip the inbox'),
    },
    async (args) => {
      const { hasTokens } = checkCredentialsStatus();
      if (!hasTokens) {
        return {
          content: [
            {
              type: 'text',
              text: 'Error: Gmail credentials are not authenticated. Run "npx google-gmail-mcp auth" first.',
            },
          ],
        };
      }

      const gmail = getAuthenticatedGmailClient();
      let targetLabelId: string | undefined;

      if (args.targetLabelName) {
        const labelMap = await syncTaxonomyLabels(gmail);
        targetLabelId = labelMap[args.targetLabelName];
        if (!targetLabelId) {
          const created = await gmail.users.labels.create({
            userId: 'me',
            requestBody: {
              name: args.targetLabelName,
              labelListVisibility: 'labelShow',
              messageListVisibility: 'show',
            },
          });
          targetLabelId = created.data.id || undefined;
        }
      }

      const addLabelIds = targetLabelId ? [targetLabelId] : [];
      const removeLabelIds = args.archiveInbox ? ['INBOX'] : [];

      const filter = await createPersistentFilter(
        gmail,
        {
          from: args.from,
          subject: args.subject,
          query: args.query,
        },
        {
          addLabelIds,
          removeLabelIds,
        }
      );

      return {
        content: [
          {
            type: 'text',
            text: `Automated filter created successfully (ID: ${filter.id}).\nCriteria: ${JSON.stringify(filter.criteria)}\nAction: ${JSON.stringify(filter.action)}`,
          },
        ],
      };
    }
  );

  /**
   * Tool 5: gmail_list_filters
   * Lists existing server-side Gmail filters to inspect before creating duplicates.
   */
  server.tool(
    'gmail_list_filters',
    'Lists all existing automated server-side filter rules registered in the user Gmail settings.',
    {},
    async () => {
      const { hasTokens } = checkCredentialsStatus();
      if (!hasTokens) {
        return {
          content: [
            {
              type: 'text',
              text: 'Error: Gmail credentials are not authenticated. Run "npx google-gmail-mcp auth" first.',
            },
          ],
        };
      }

      const gmail = getAuthenticatedGmailClient();
      const res = await gmail.users.settings.filters.list({ userId: 'me' });
      const filters = res.data.filter || [];

      const summaryLines = filters.map((f, idx) => {
        const criteriaParts: string[] = [];
        if (f.criteria?.from) criteriaParts.push(`from: "${f.criteria.from}"`);
        if (f.criteria?.to) criteriaParts.push(`to: "${f.criteria.to}"`);
        if (f.criteria?.subject) criteriaParts.push(`subject: "${f.criteria.subject}"`);
        if (f.criteria?.query) criteriaParts.push(`query: "${f.criteria.query}"`);

        const actionParts: string[] = [];
        if (f.action?.addLabelIds?.length) actionParts.push(`addLabels: [${f.action.addLabelIds.join(', ')}]`);
        if (f.action?.removeLabelIds?.length) actionParts.push(`removeLabels: [${f.action.removeLabelIds.join(', ')}]`);

        return `${idx + 1}. [ID: ${f.id}]\n   Match: ${criteriaParts.join(' | ') || 'all'}\n   Action: ${actionParts.join(' | ') || 'none'}`;
      });

      return {
        content: [
          {
            type: 'text',
            text: `Total Active Gmail Filters: ${filters.length}\n\n${summaryLines.join('\n\n') || 'No filters configured.'}`,
          },
        ],
      };
    }
  );

  /**
   * Tool 6: gmail_delete_filter
   * Deletes a server-side filter rule by its unique filter ID.
   */
  server.tool(
    'gmail_delete_filter',
    'Deletes an existing server-side Gmail filter rule by its unique filter ID.',
    {
      filterId: z.string().describe('The unique filter ID to delete (obtain from gmail_list_filters)'),
    },
    async (args) => {
      const { hasTokens } = checkCredentialsStatus();
      if (!hasTokens) {
        return {
          content: [
            {
              type: 'text',
              text: 'Error: Gmail credentials are not authenticated. Run "npx google-gmail-mcp auth" first.',
            },
          ],
        };
      }

      const gmail = getAuthenticatedGmailClient();
      await gmail.users.settings.filters.delete({ userId: 'me', id: args.filterId });

      return {
        content: [
          {
            type: 'text',
            text: `Successfully deleted Gmail filter rule with ID: ${args.filterId}`,
          },
        ],
      };
    }
  );

  /**
   * Tool 7: gmail_inbox_summary
   * Read-only inbox summary of total, unread, and category message counts.
   */
  server.tool(
    'gmail_inbox_summary',
    'Read-only summary of the current INBOX status: total messages, unread count, and breakdown across Gmail smart categories without mutating anything.',
    {},
    async () => {
      const { hasTokens } = checkCredentialsStatus();
      if (!hasTokens) {
        return {
          content: [
            {
              type: 'text',
              text: 'Error: Gmail credentials are not authenticated. Run "npx google-gmail-mcp auth" first.',
            },
          ],
        };
      }

      const gmail = getAuthenticatedGmailClient();

      async function getCategoryEstimate(category: string): Promise<number> {
        try {
          const res = await gmail.users.messages.list({
            userId: 'me',
            q: `label:INBOX category:${category}`,
            maxResults: 1,
          });
          return res.data.resultSizeEstimate ?? (res.data.messages?.length || 0);
        } catch {
          return 0;
        }
      }

      const [inboxRes, unreadRes, primaryCount, updatesCount, promoCount, socialCount, forumsCount] =
        await Promise.all([
          gmail.users.messages.list({ userId: 'me', q: 'label:INBOX', maxResults: 500 }),
          gmail.users.messages.list({ userId: 'me', q: 'label:INBOX is:unread', maxResults: 500 }),
          getCategoryEstimate('primary'),
          getCategoryEstimate('updates'),
          getCategoryEstimate('promotions'),
          getCategoryEstimate('social'),
          getCategoryEstimate('forums'),
        ]);

      const totalInbox = inboxRes.data.messages?.length || 0;
      const unreadInbox = unreadRes.data.messages?.length || 0;
      const isInboxZero = totalInbox === 0;

      const reportLines = [
        `====================================================`,
        `                 Gmail Inbox Summary                `,
        `====================================================`,
        `Inbox Status:        ${isInboxZero ? '🎯 TRUE INBOX ZERO (0 messages)' : `${totalInbox} message(s)`}`,
        `Unread Messages:     ${unreadInbox}`,
        '',
        `Category Breakdown (in INBOX):`,
        ` - Primary:         ${primaryCount}`,
        ` - Updates:         ${updatesCount}`,
        ` - Promotions:      ${promoCount}`,
        ` - Social:          ${socialCount}`,
        ` - Forums:          ${forumsCount}`,
        `====================================================`,
      ];

      return {
        content: [
          {
            type: 'text',
            text: reportLines.join('\n'),
          },
        ],
      };
    }
  );

  /**
   * Tool 8: gmail_storage_audit
   * Read-only audit scanning for heavy emails above a size threshold.
   */
  server.tool(
    'gmail_storage_audit',
    'Read-only scan for heavy emails exceeding a size threshold (in MB). Returns sorted metadata without mutating or deleting any messages.',
    {
      minSizeMb: z.number().min(1).default(5).describe('Minimum email size in megabytes to search for (default: 5)'),
      maxResults: z
        .number()
        .min(1)
        .max(100)
        .default(25)
        .describe('Maximum number of heavy email records to return (default: 25)'),
    },
    async (args) => {
      const { hasTokens } = checkCredentialsStatus();
      if (!hasTokens) {
        return {
          content: [
            {
              type: 'text',
              text: 'Error: Gmail credentials are not authenticated. Run "npx google-gmail-mcp auth" first.',
            },
          ],
        };
      }

      const gmail = getAuthenticatedGmailClient();
      const query = `larger:${args.minSizeMb}M`;
      const listRes = await gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults: args.maxResults,
      });

      const messages = listRes.data.messages || [];
      const items: Array<{
        id: string;
        from: string;
        subject: string;
        date: string;
        sizeKb: number;
        labels: string[];
      }> = [];

      for (const m of messages) {
        if (!m.id) continue;
        try {
          const msg = await gmail.users.messages.get({
            userId: 'me',
            id: m.id,
            format: 'metadata',
            metadataHeaders: ['From', 'Subject', 'Date'],
          });
          const headers = msg.data.payload?.headers || [];
          const from = headers.find((h) => h.name?.toLowerCase() === 'from')?.value || 'Unknown Sender';
          const subject = headers.find((h) => h.name?.toLowerCase() === 'subject')?.value || '(no subject)';
          const date = headers.find((h) => h.name?.toLowerCase() === 'date')?.value || '';
          const sizeKb = Math.round((msg.data.sizeEstimate || 0) / 1024);
          items.push({
            id: m.id,
            from,
            subject,
            date,
            sizeKb,
            labels: msg.data.labelIds || [],
          });
        } catch {
          // Skip if unable to fetch metadata
        }
      }

      items.sort((a, b) => b.sizeKb - a.sizeKb);

      const lines = items.map((item, idx) => {
        const sizeMb = (item.sizeKb / 1024).toFixed(1);
        return `${idx + 1}. [${item.id}] ${sizeMb} MB | From: ${item.from} | Subject: "${item.subject}" | Date: ${item.date}`;
      });

      return {
        content: [
          {
            type: 'text',
            text: `Storage Audit (${query}): Found ${messages.length} message(s) >= ${args.minSizeMb} MB:\n\n${lines.join('\n') || 'No messages found exceeding size threshold.'}`,
          },
        ],
      };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

/**
 * Main entrypoint for CLI command execution.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('auth') || args.includes('--auth')) {
    await runInteractiveAuth();
    return;
  }

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
google-gmail-mcp - Stdio MCP Server & Automation Suite for Gmail

Usage:
  google-gmail-mcp               Start Stdio MCP server (default)
  google-gmail-mcp auth          Run interactive OAuth authorization flow
  google-gmail-mcp --help        Show this help message

Environment Variables:
  GMAIL_OAUTH_PATH       Path to gcp-oauth.keys.json
  GMAIL_CREDENTIALS_PATH Path to credentials.json
`);
    return;
  }

  await startHybridMcpServer();
}

/**
 * Determines whether the current module was executed directly as the CLI entrypoint.
 * Safely resolves symlinks (e.g. npx cache, node_modules/.bin shims, global npm links) via realpathSync.
 *
 * @returns True if executed directly as the CLI entrypoint.
 */
function isEntrypoint(): boolean {
  if (!process.argv[1]) {
    return false;
  }
  try {
    const currentFilePath = fs.realpathSync(fileURLToPath(import.meta.url));
    const executedFilePath = fs.realpathSync(process.argv[1]);
    if (currentFilePath === executedFilePath) {
      return true;
    }
  } catch {
    // Fallback if realpathSync fails (e.g. virtual filesystem or missing file)
  }

  return (
    import.meta.url === `file://${process.argv[1]}` ||
    process.argv[1].endsWith('hybrid-server.js') ||
    process.argv[1].endsWith('google-gmail-mcp')
  );
}

// Auto-run if executed directly as entrypoint or via bin wrapper
if (isEntrypoint()) {
  main().catch((err: unknown) => {
    console.error('Fatal MCP Server Error:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
