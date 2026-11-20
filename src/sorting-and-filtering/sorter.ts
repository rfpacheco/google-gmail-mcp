/**
 * Client-Side Gmail Sorting Pipeline.
 *
 * Gmail's native API does not provide custom `ORDER BY` operators (e.g., sort by
 * sender, size, or thread depth). This module provides deterministic in-memory sorting
 * pipelines to structure and order email messages retrieved via MCP.
 *
 * @packageDocumentation
 */

/**
 * Normalized email summary for sorting operations.
 */
export interface EmailSummary {
  /**
   * Unique message ID.
   */
  id: string;

  /**
   * Thread ID to which the message belongs.
   */
  threadId?: string;

  /**
   * Sender email or name.
   */
  from: string;

  /**
   * Recipient list.
   */
  to?: string[];

  /**
   * Subject line.
   */
  subject: string;

  /**
   * Date received or sent (ISO string or timestamp).
   */
  date: string | number | Date;

  /**
   * Estimated or exact message size in bytes.
   */
  sizeEstimate?: number;

  /**
   * Labels attached to the message.
   */
  labelIds?: string[];

  /**
   * Snippet or preview text.
   */
  snippet?: string;

  /**
   * Whether the email has attachments.
   */
  hasAttachments?: boolean;
}

/**
 * Supported sorting criteria for emails.
 */
export type SortField =
  | 'date'
  | 'size'
  | 'from'
  | 'subject'
  | 'unreadPriority'
  | 'importance';

/**
 * Sort direction.
 */
export type SortDirection = 'asc' | 'desc';

/**
 * Configuration options for sorting an email collection.
 */
export interface SortOptions {
  /**
   * Primary field to sort on.
   */
  field: SortField;

  /**
   * Sort direction ('asc' or 'desc'). Defaults to 'desc' for date and size, 'asc' for text.
   */
  direction?: SortDirection;

  /**
   * Optional secondary field to break ties.
   */
  secondaryField?: SortField;

  /**
   * Secondary sort direction.
   */
  secondaryDirection?: SortDirection;
}

/**
 * Email sorting engine providing multi-attribute ordering for Gmail message lists.
 */
export class GmailSorter {
  /**
   * Sorts an array of email summaries according to specified criteria.
   *
   * @param emails - Array of email summaries to sort.
   * @param options - Sort parameters.
   * @returns New sorted array of email summaries.
   *
   * @example
   * ```typescript
   * const sortedBySender = GmailSorter.sort(inboxEmails, {
   *   field: 'from',
   *   direction: 'asc',
   *   secondaryField: 'date',
   *   secondaryDirection: 'desc'
   * });
   * ```
   */
  public static sort(emails: EmailSummary[], options: SortOptions): EmailSummary[] {
    const list = [...emails];
    const primaryDir = options.direction ?? this.defaultDirection(options.field);
    const secondaryDir = options.secondaryDirection ?? (options.secondaryField ? this.defaultDirection(options.secondaryField) : 'desc');

    return list.sort((a, b) => {
      const primaryDiff = this.compare(a, b, options.field, primaryDir);
      if (primaryDiff !== 0 || !options.secondaryField) {
        return primaryDiff;
      }
      return this.compare(a, b, options.secondaryField, secondaryDir);
    });
  }

  /**
   * Groups emails by a specific attribute (e.g. sender, domain, date period).
   *
   * @param emails - Array of email summaries.
   * @param groupBy - Field to group by ('fromDomain' | 'sender' | 'datePeriod').
   * @returns Map of group keys to email summary arrays.
   */
  public static group(
    emails: EmailSummary[],
    groupBy: 'fromDomain' | 'sender' | 'datePeriod'
  ): Map<string, EmailSummary[]> {
    const map = new Map<string, EmailSummary[]>();

    for (const email of emails) {
      let key = 'Other';

      if (groupBy === 'sender') {
        key = email.from || 'Unknown Sender';
      } else if (groupBy === 'fromDomain') {
        const match = email.from.match(/@([a-zA-Z0-9.-]+)/);
        key = match ? match[1].toLowerCase() : 'No Domain';
      } else if (groupBy === 'datePeriod') {
        const d = new Date(email.date);
        key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      }

      const existing = map.get(key) || [];
      existing.push(email);
      map.set(key, existing);
    }

    return map;
  }

  /**
   * Internal comparison function for two email objects.
   *
   * @param a - First email.
   * @param b - Second email.
   * @param field - Field to compare.
   * @param direction - Direction of ordering.
   * @returns Comparison result number (-1, 0, or 1).
   */
  private static compare(
    a: EmailSummary,
    b: EmailSummary,
    field: SortField,
    direction: SortDirection
  ): number {
    const multiplier = direction === 'asc' ? 1 : -1;

    switch (field) {
      case 'date': {
        const dateA = new Date(a.date).getTime();
        const dateB = new Date(b.date).getTime();
        return (dateA - dateB) * multiplier;
      }

      case 'size': {
        const sizeA = a.sizeEstimate ?? 0;
        const sizeB = b.sizeEstimate ?? 0;
        return (sizeA - sizeB) * multiplier;
      }

      case 'from': {
        return a.from.localeCompare(b.from, undefined, { sensitivity: 'base' }) * multiplier;
      }

      case 'subject': {
        return a.subject.localeCompare(b.subject, undefined, { sensitivity: 'base' }) * multiplier;
      }

      case 'unreadPriority': {
        const isUnreadA = a.labelIds?.includes('UNREAD') ? 1 : 0;
        const isUnreadB = b.labelIds?.includes('UNREAD') ? 1 : 0;
        return (isUnreadA - isUnreadB) * multiplier;
      }

      case 'importance': {
        const isImportantA = a.labelIds?.includes('IMPORTANT') ? 1 : 0;
        const isImportantB = b.labelIds?.includes('IMPORTANT') ? 1 : 0;
        return (isImportantA - isImportantB) * multiplier;
      }

      default:
        return 0;
    }
  }

  /**
   * Determines the intuitive default direction for a field.
   *
   * @param field - Sort field.
   * @returns Default direction ('asc' or 'desc').
   */
  private static defaultDirection(field: SortField): SortDirection {
    switch (field) {
      case 'date':
      case 'size':
      case 'unreadPriority':
      case 'importance':
        return 'desc';
      case 'from':
      case 'subject':
        return 'asc';
      default:
        return 'desc';
    }
  }
}
