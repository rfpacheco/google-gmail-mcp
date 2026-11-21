/**
 * Unit Tests for Gmail Sorting, Filtering, Query Building, and Taxonomy.
 *
 * Exercises pure logic without performing any network requests or Gmail I/O.
 *
 * @packageDocumentation
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  GmailQueryBuilder,
  GmailSorter,
  GmailFilterTemplates,
  RECOMMENDED_LABEL_TAXONOMY,
  GMAIL_SYSTEM_LABELS,
  GMAIL_SMART_CATEGORIES,
} from '../src/sorting-and-filtering/index.js';
import type { EmailSummary } from '../src/sorting-and-filtering/sorter.js';

describe('GmailQueryBuilder', () => {
  it('should build a query with basic criteria', () => {
    const query = GmailQueryBuilder.build({
      from: 'alerts@service.com',
      to: 'me@company.com',
      subject: 'Security Alert',
      hasAttachment: true,
      isUnread: true,
    });
    assert.match(query, /from:alerts@service\.com/);
    assert.match(query, /to:me@company\.com/);
    assert.match(query, /subject:"Security Alert"/);
    assert.match(query, /has:attachment/);
    assert.match(query, /is:unread/);
  });

  it('should return empty string for empty criteria', () => {
    const query = GmailQueryBuilder.build({});
    assert.equal(query, '');
  });

  it('should handle date filters and smart categories', () => {
    const query = GmailQueryBuilder.build({
      afterDate: '2026/01/01',
      beforeDate: '2026/12/31',
      category: 'promotions',
      label: 'INBOX',
    });
    assert.match(query, /after:2026\/01\/01/);
    assert.match(query, /before:2026\/12\/31/);
    assert.match(query, /category:promotions/);
    assert.match(query, /label:INBOX/);
  });

  it('should handle exact phrase and excluded terms', () => {
    const query = GmailQueryBuilder.build({
      exactPhrase: 'confidential report',
      excludeText: 'spam',
    });
    assert.match(query, /"confidential report"/);
    assert.match(query, /-spam/);
  });
});

describe('GmailSorter', () => {
  const sampleEmails: EmailSummary[] = [
    {
      id: 'msg-1',
      from: 'alice@alpha.com',
      subject: 'Beta testing',
      date: '2026-05-10T10:00:00Z',
      sizeEstimate: 5000,
      labelIds: ['INBOX', 'UNREAD'],
    },
    {
      id: 'msg-2',
      from: 'charlie@gamma.com',
      subject: 'Alpha launch',
      date: '2026-05-12T10:00:00Z',
      sizeEstimate: 20000,
      labelIds: ['INBOX', 'IMPORTANT'],
    },
    {
      id: 'msg-3',
      from: 'bob@beta.com',
      subject: 'Gamma status',
      date: '2026-05-01T10:00:00Z',
      sizeEstimate: 12000,
      labelIds: ['INBOX'],
    },
  ];

  it('should sort by date descending (newest first)', () => {
    const sorted = GmailSorter.sort(sampleEmails, { field: 'date', direction: 'desc' });
    assert.equal(sorted[0].id, 'msg-2');
    assert.equal(sorted[1].id, 'msg-1');
    assert.equal(sorted[2].id, 'msg-3');
  });

  it('should sort by date ascending (oldest first)', () => {
    const sorted = GmailSorter.sort(sampleEmails, { field: 'date', direction: 'asc' });
    assert.equal(sorted[0].id, 'msg-3');
    assert.equal(sorted[1].id, 'msg-1');
    assert.equal(sorted[2].id, 'msg-2');
  });

  it('should sort by size descending (largest first)', () => {
    const sorted = GmailSorter.sort(sampleEmails, { field: 'size', direction: 'desc' });
    assert.equal(sorted[0].id, 'msg-2'); // 20000
    assert.equal(sorted[1].id, 'msg-3'); // 12000
    assert.equal(sorted[2].id, 'msg-1'); // 5000
  });

  it('should sort by from ascending (alphabetical sender)', () => {
    const sorted = GmailSorter.sort(sampleEmails, { field: 'from', direction: 'asc' });
    assert.equal(sorted[0].id, 'msg-1'); // alice
    assert.equal(sorted[1].id, 'msg-3'); // bob
    assert.equal(sorted[2].id, 'msg-2'); // charlie
  });

  it('should sort by subject ascending', () => {
    const sorted = GmailSorter.sort(sampleEmails, { field: 'subject', direction: 'asc' });
    assert.equal(sorted[0].id, 'msg-2'); // Alpha launch
    assert.equal(sorted[1].id, 'msg-1'); // Beta testing
    assert.equal(sorted[2].id, 'msg-3'); // Gamma status
  });

  it('should sort by unreadPriority (unread messages prioritized)', () => {
    const sorted = GmailSorter.sort(sampleEmails, { field: 'unreadPriority', direction: 'desc' });
    assert.equal(sorted[0].id, 'msg-1'); // contains UNREAD
  });

  it('should sort by importance (starred/important prioritized)', () => {
    const sorted = GmailSorter.sort(sampleEmails, { field: 'importance', direction: 'desc' });
    assert.equal(sorted[0].id, 'msg-2'); // contains STARRED
  });

  it('should group emails by sender', () => {
    const grouped = GmailSorter.group(sampleEmails, 'sender');
    assert.equal(grouped.size, 3);
    assert.ok(grouped.has('alice@alpha.com'));
  });

  it('should group emails by fromDomain', () => {
    const grouped = GmailSorter.group(sampleEmails, 'fromDomain');
    assert.ok(grouped.has('alpha.com'));
    assert.ok(grouped.has('beta.com'));
    assert.ok(grouped.has('gamma.com'));
  });
});

describe('GmailFilterTemplates', () => {
  it('should generate financialInvoicesAndReceipts template with archive & label', () => {
    const filter = GmailFilterTemplates.create('financialInvoicesAndReceipts', {
      labelId: 'Label_Finance',
      archive: true,
      markImportant: true,
    });
    assert.ok(filter.action.addLabelIds?.includes('Label_Finance'));
    assert.ok(filter.action.addLabelIds?.includes('IMPORTANT'));
    assert.ok(filter.action.removeLabelIds?.includes('INBOX'));
  });

  it('should generate automatedSystemAlerts with markAsRead', () => {
    const filter = GmailFilterTemplates.create('automatedSystemAlerts', {
      subjectPattern: '[CRITICAL]',
      markAsRead: true,
    });
    assert.ok(filter.action.removeLabelIds?.includes('UNREAD'));
    assert.equal(filter.criteria.subject, '[CRITICAL]');
  });
});

describe('RECOMMENDED_LABEL_TAXONOMY', () => {
  it('should contain standardized baseline labels', () => {
    assert.ok(Array.isArray(RECOMMENDED_LABEL_TAXONOMY));
    assert.ok(RECOMMENDED_LABEL_TAXONOMY.length >= 7);
    const names = RECOMMENDED_LABEL_TAXONOMY.map((l) => l.name);
    assert.ok(names.includes('Projects'));
    assert.ok(names.includes('Finance/Invoices'));
    assert.ok(names.includes('Newsletters'));
  });

  it('should have valid constants for system labels and smart categories', () => {
    assert.equal(GMAIL_SYSTEM_LABELS.INBOX, 'INBOX');
    assert.equal(GMAIL_SYSTEM_LABELS.UNREAD, 'UNREAD');
    assert.equal(GMAIL_SMART_CATEGORIES.PROMOTIONS, 'CATEGORY_PROMOTIONS');
  });
});
