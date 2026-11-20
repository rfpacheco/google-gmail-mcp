/**
 * Gmail Batch Triage and Sorting Service.
 *
 * Implements high-throughput operations for querying, client-side sorting,
 * batch-label modification, and automated filter creation.
 *
 * @packageDocumentation
 */

import { gmail_v1 } from 'googleapis';
import {
  GmailQueryBuilder,
  GmailSearchCriteria,
} from '../sorting-and-filtering/query-builder.js';
import {
  GmailSorter,
  EmailSummary,
  SortOptions,
} from '../sorting-and-filtering/sorter.js';
import {
  GmailFilterCriteria,
  GmailFilterAction,
} from '../sorting-and-filtering/filter-manager.js';
import {
  RECOMMENDED_LABEL_TAXONOMY,
  LabelHierarchyNode,
} from '../sorting-and-filtering/taxonomy.js';

/**
 * Result structure returned after searching and sorting emails.
 */
export interface SearchAndSortResult {
  /**
   * The compiled Gmail query string used for search.
   */
  query: string;

  /**
   * Number of message IDs matched by Gmail search index.
   */
  totalFound: number;

  /**
   * Array of normalized and sorted email summaries.
   */
  sortedEmails: EmailSummary[];
}

/**
 * Result structure returned after executing a batch triage operation.
 */
export interface BatchTriageResult {
  /**
   * Total number of messages modified.
   */
  modifiedCount: number;

  /**
   * Array of message IDs that were successfully modified.
   */
  modifiedIds: string[];

  /**
   * Label IDs added during triage.
   */
  addedLabelIds: string[];

  /**
   * Label IDs removed during triage.
   */
  removedLabelIds: string[];
}

/**
 * Ensures all taxonomy labels exist in the user's Gmail account, creating missing ones idempotently.
 *
 * @param gmail - Authenticated Gmail API client.
 * @param taxonomy - Optional custom taxonomy list; defaults to RECOMMENDED_LABEL_TAXONOMY.
 * @returns Map of label name to unique Gmail label ID.
 */
export async function syncTaxonomyLabels(
  gmail: gmail_v1.Gmail,
  taxonomy: LabelHierarchyNode[] = RECOMMENDED_LABEL_TAXONOMY
): Promise<Record<string, string>> {
  const existingLabelsRes = await gmail.users.labels.list({ userId: 'me' });
  const existing = existingLabelsRes.data.labels || [];
  const labelMap: Record<string, string> = {};

  for (const label of existing) {
    if (label.name && label.id) {
      labelMap[label.name] = label.id;
    }
  }

  for (const node of taxonomy) {
    if (!labelMap[node.name]) {
      const created = await gmail.users.labels.create({
        userId: 'me',
        requestBody: {
          name: node.name,
          labelListVisibility: node.labelListVisibility || 'labelShow',
          messageListVisibility: node.messageListVisibility || 'show',
        },
      });

      if (created.data.name && created.data.id) {
        labelMap[created.data.name] = created.data.id;
      }
    }
  }

  return labelMap;
}

/**
 * Queries emails matching criteria and applies deterministic client-side sorting.
 *
 * @param gmail - Authenticated Gmail API client.
 * @param criteria - Structured search criteria.
 * @param sortOptions - Sorting configuration (field, direction, secondary field).
 * @param maxResults - Maximum messages to retrieve and sort (defaults to 50, max 500).
 * @returns Sorted email summaries and query metadata.
 */
export async function searchAndSortEmails(
  gmail: gmail_v1.Gmail,
  criteria: GmailSearchCriteria,
  sortOptions: SortOptions,
  maxResults: number = 50
): Promise<SearchAndSortResult> {
  const query = GmailQueryBuilder.build(criteria);
  const listRes = await gmail.users.messages.list({
    userId: 'me',
    q: query || undefined,
    maxResults: Math.min(maxResults, 500),
  });

  const messageRefs = listRes.data.messages || [];
  if (messageRefs.length === 0) {
    return {
      query,
      totalFound: 0,
      sortedEmails: [],
    };
  }

  // Fetch metadata concurrently in controlled chunks to respect rate limits
  const CHUNK_SIZE = 10;
  const summaries: EmailSummary[] = [];

  for (let i = 0; i < messageRefs.length; i += CHUNK_SIZE) {
    const chunk = messageRefs.slice(i, i + CHUNK_SIZE);
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

        const summary: EmailSummary = {
          id: msg.data.id || ref.id,
          threadId: msg.data.threadId || undefined,
          from: getHeader('From'),
          to: getHeader('To') ? [getHeader('To')] : undefined,
          subject: getHeader('Subject'),
          date: getHeader('Date') || (msg.data.internalDate ? parseInt(msg.data.internalDate, 10) : new Date()),
          sizeEstimate: msg.data.sizeEstimate || undefined,
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

  const sortedEmails = GmailSorter.sort(summaries, sortOptions);

  return {
    query,
    totalFound: messageRefs.length,
    sortedEmails,
  };
}

/**
 * Modifies labels across a collection of messages in bulk using atomic batches.
 *
 * @param gmail - Authenticated Gmail API client.
 * @param messageIds - Array of message IDs to update.
 * @param addLabelIds - Label IDs to attach.
 * @param removeLabelIds - Label IDs to detach (e.g. `['INBOX']` to archive, `['UNREAD']` to mark read).
 * @returns Summary of batch modification.
 */
export async function batchApplyTriage(
  gmail: gmail_v1.Gmail,
  messageIds: string[],
  addLabelIds: string[] = [],
  removeLabelIds: string[] = []
): Promise<BatchTriageResult> {
  if (messageIds.length === 0) {
    return {
      modifiedCount: 0,
      modifiedIds: [],
      addedLabelIds: addLabelIds,
      removedLabelIds: removeLabelIds,
    };
  }

  // Gmail batchModify supports up to 1,000 IDs per request
  const BATCH_SIZE = 1000;
  const processedIds: string[] = [];

  for (let i = 0; i < messageIds.length; i += BATCH_SIZE) {
    const chunk = messageIds.slice(i, i + BATCH_SIZE);
    await gmail.users.messages.batchModify({
      userId: 'me',
      requestBody: {
        ids: chunk,
        addLabelIds,
        removeLabelIds,
      },
    });
    processedIds.push(...chunk);
  }

  return {
    modifiedCount: processedIds.length,
    modifiedIds: processedIds,
    addedLabelIds: addLabelIds,
    removedLabelIds: removeLabelIds,
  };
}

/**
 * Creates an automated server-side filter in Gmail.
 *
 * @param gmail - Authenticated Gmail API client.
 * @param criteria - Filter match criteria.
 * @param action - Filter execution action.
 * @returns Created Gmail filter object.
 */
export async function createPersistentFilter(
  gmail: gmail_v1.Gmail,
  criteria: GmailFilterCriteria,
  action: GmailFilterAction
): Promise<gmail_v1.Schema$Filter> {
  const res = await gmail.users.settings.filters.create({
    userId: 'me',
    requestBody: {
      criteria: {
        from: criteria.from,
        to: criteria.to,
        subject: criteria.subject,
        query: criteria.query,
        negatedQuery: criteria.negatedQuery,
        hasAttachment: criteria.hasAttachment,
        excludeChats: criteria.excludeChats,
        size: criteria.size,
        sizeComparison: criteria.sizeComparison,
      },
      action: {
        addLabelIds: action.addLabelIds,
        removeLabelIds: action.removeLabelIds,
        forward: action.forward,
      },
    },
  });

  return res.data;
}
