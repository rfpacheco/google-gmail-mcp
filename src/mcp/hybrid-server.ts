/**
 * Hybrid Gmail MCP Server.
 *
 * Implements high-level, coarse-grained Model Context Protocol tools for AI agents,
 * backed by the shared sorting, filtering, and batch-triage engine.
 *
 * @packageDocumentation
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { getAuthenticatedGmailClient, checkCredentialsStatus } from '../services/gmail-client.js';
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
    name: 'gmail-hybrid-mcp',
    version: '1.0.0',
  });

  /**
   * Tool: gmail_search_and_sort
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
              text: 'Error: Gmail credentials are not authenticated. Run "npm run auth" first.',
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
   * Tool: gmail_batch_triage
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
              text: 'Error: Gmail credentials are not authenticated. Run "npm run auth" first.',
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
            // Auto-create missing custom label
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
   * Tool: gmail_sync_taxonomy_labels
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
              text: 'Error: Gmail credentials are not authenticated. Run "npm run auth" first.',
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
   * Tool: gmail_create_filter
   * Creates an automated incoming filter rule in Gmail settings.
   */
  server.tool(
    'gmail_create_filter',
    'Creates a persistent automated server-side filter rule in Gmail settings.',
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
              text: 'Error: Gmail credentials are not authenticated. Run "npm run auth" first.',
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

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Auto-run if executed directly as entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  startHybridMcpServer().catch((err: unknown) => {
    console.error('Fatal MCP Server Error:', err);
    process.exit(1);
  });
}
