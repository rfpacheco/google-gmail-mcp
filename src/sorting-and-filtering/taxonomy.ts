/**
 * Gmail Label Taxonomy and Classification Structure.
 *
 * Establishes an organized classification model for Gmail labels, distinguishing
 * between system states, category buckets, and nested custom user hierarchies.
 *
 * @packageDocumentation
 */

/**
 * Standard Gmail System Labels.
 */
export const GMAIL_SYSTEM_LABELS = {
  INBOX: 'INBOX',
  SENT: 'SENT',
  DRAFT: 'DRAFT',
  TRASH: 'TRASH',
  SPAM: 'SPAM',
  STARRED: 'STARRED',
  UNREAD: 'UNREAD',
  IMPORTANT: 'IMPORTANT',
  CHAT: 'CHAT',
} as const;

/**
 * Gmail Automatic Smart Categories.
 */
export const GMAIL_SMART_CATEGORIES = {
  PERSONAL: 'CATEGORY_PERSONAL',
  SOCIAL: 'CATEGORY_SOCIAL',
  PROMOTIONS: 'CATEGORY_PROMOTIONS',
  UPDATES: 'CATEGORY_UPDATES',
  FORUMS: 'CATEGORY_FORUMS',
} as const;

/**
 * Standard nested label template hierarchy recommended for clean inbox management.
 */
export interface LabelHierarchyNode {
  /**
   * Display name of the label (supports forward slashes for nesting, e.g. "Finance/Invoices").
   */
  name: string;

  /**
   * Description of what belongs under this label.
   */
  purpose: string;

  /**
   * Recommended message list visibility ('show' or 'hide').
   */
  messageListVisibility?: 'show' | 'hide';

  /**
   * Recommended label list visibility in sidebar ('labelShow' | 'labelShowIfUnread' | 'labelHide').
   */
  labelListVisibility?: 'labelShow' | 'labelShowIfUnread' | 'labelHide';

  /**
   * Associated filter pattern rule.
   */
  suggestedFilterQuery?: string;
}

/**
 * Standard classification taxonomy for organizing a professional Gmail account.
 */
export const RECOMMENDED_LABEL_TAXONOMY: LabelHierarchyNode[] = [
  {
    name: 'Action/Today',
    purpose: 'Urgent emails requiring attention or response within the next 24 hours.',
    labelListVisibility: 'labelShow',
    messageListVisibility: 'show',
  },
  {
    name: 'Action/Waiting',
    purpose: 'Pending replies or blocked items waiting on an external party.',
    labelListVisibility: 'labelShowIfUnread',
    messageListVisibility: 'show',
  },
  {
    name: 'Projects',
    purpose: 'Parent container for active project workstreams.',
    labelListVisibility: 'labelShow',
    messageListVisibility: 'show',
  },
  {
    name: 'Finance/Invoices',
    purpose: 'Bills, receipts, payment receipts, and accounting correspondence.',
    labelListVisibility: 'labelShowIfUnread',
    messageListVisibility: 'show',
    suggestedFilterQuery: 'invoice OR receipt OR billing OR factura',
  },
  {
    name: 'Newsletters',
    purpose: 'Industry publications, blogs, and regular reading material.',
    labelListVisibility: 'labelShowIfUnread',
    messageListVisibility: 'hide',
    suggestedFilterQuery: 'unsubscribe OR "opt-out"',
  },
  {
    name: 'System/Alerts',
    purpose: 'Automated monitoring alerts, CI/CD notifications, and server status updates.',
    labelListVisibility: 'labelShowIfUnread',
    messageListVisibility: 'hide',
    suggestedFilterQuery: 'subject:("alert" OR "critical" OR "error" OR "status")',
  },
  {
    name: 'Reference/Archive',
    purpose: 'Historical records, documentation, and receipts kept for long-term reference.',
    labelListVisibility: 'labelHide',
    messageListVisibility: 'hide',
  },
];
