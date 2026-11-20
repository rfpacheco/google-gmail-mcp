/**
 * Structured Gmail Query Builder.
 *
 * Provides a type-safe interface for constructing Gmail search query strings
 * supporting all native Gmail search operators (sender, recipient, subject,
 * date ranges, labels, attachments, size thresholds, and category classifications).
 *
 * @packageDocumentation
 */

/**
 * Filter parameters for building a Gmail search query.
 */
export interface GmailSearchCriteria {
  /**
   * Sender email address or domain (maps to `from:`).
   */
  from?: string;

  /**
   * Recipient email address or domain (maps to `to:`).
   */
  to?: string;

  /**
   * CC recipient email address or domain (maps to `cc:`).
   */
  cc?: string;

  /**
   * BCC recipient email address or domain (maps to `bcc:`).
   */
  bcc?: string;

  /**
   * Keywords or phrase in the subject line (maps to `subject:`).
   */
  subject?: string;

  /**
   * Free-text search terms matching any body content.
   */
  text?: string;

  /**
   * Exact phrase that must appear in body or subject (enclosed in quotes).
   */
  exactPhrase?: string;

  /**
   * Terms that must NOT appear in the email (maps to `-` negation).
   */
  excludeText?: string;

  /**
   * Whether the email must contain attachments (maps to `has:attachment`).
   */
  hasAttachment?: boolean;

  /**
   * Specific attachment filename or extension, e.g. "pdf" or "report.xlsx" (maps to `filename:`).
   */
  filename?: string;

  /**
   * Filter emails after this date (ISO string `YYYY-MM-DD` or `YYYY/MM/DD`).
   */
  afterDate?: string;

  /**
   * Filter emails before this date (ISO string `YYYY-MM-DD` or `YYYY/MM/DD`).
   */
  beforeDate?: string;

  /**
   * Relative age threshold, e.g. "7d", "1m", "1y" (maps to `newer_than:`).
   */
  newerThan?: string;

  /**
   * Relative age threshold, e.g. "30d", "6m", "2y" (maps to `older_than:`).
   */
  olderThan?: string;

  /**
   * Minimum email size in bytes or formatted string, e.g. "5M", "500K" (maps to `larger:`).
   */
  largerThan?: string | number;

  /**
   * Maximum email size in bytes or formatted string, e.g. "2M", "100K" (maps to `smaller:`).
   */
  smallerThan?: string | number;

  /**
   * Read status of the message (`true` for unread, `false` for read).
   */
  isUnread?: boolean;

  /**
   * Starred status of the message.
   */
  isStarred?: boolean;

  /**
   * Importance status according to Gmail priority engine.
   */
  isImportant?: boolean;

  /**
   * Gmail system categories.
   */
  category?: 'primary' | 'social' | 'promotions' | 'updates' | 'forums';

  /**
   * Specific label name required on the email (maps to `label:`).
   */
  label?: string;

  /**
   * Specific label name that must NOT be present on the email (maps to `-label:`).
   */
  excludeLabel?: string;

  /**
   * Custom raw query clause to append.
   */
  rawQuery?: string;
}

/**
 * Utility class for composing valid Gmail search query strings from structured options.
 */
export class GmailQueryBuilder {
  /**
   * Transforms structured search criteria into a standardized Gmail search query string.
   *
   * @param criteria - The structured search parameters.
   * @returns Formatted query string suitable for Gmail API `q` parameter.
   *
   * @example
   * ```typescript
   * const query = GmailQueryBuilder.build({
   *   from: "billing@service.com",
   *   hasAttachment: true,
   *   newerThan: "30d",
   *   isUnread: true
   * });
   * // Result: 'from:billing@service.com has:attachment newer_than:30d is:unread'
   * ```
   */
  public static build(criteria: GmailSearchCriteria): string {
    const parts: string[] = [];

    if (criteria.from) {
      parts.push(`from:${this.escapeValue(criteria.from)}`);
    }

    if (criteria.to) {
      parts.push(`to:${this.escapeValue(criteria.to)}`);
    }

    if (criteria.cc) {
      parts.push(`cc:${this.escapeValue(criteria.cc)}`);
    }

    if (criteria.bcc) {
      parts.push(`bcc:${this.escapeValue(criteria.bcc)}`);
    }

    if (criteria.subject) {
      parts.push(`subject:${this.escapeValue(criteria.subject)}`);
    }

    if (criteria.exactPhrase) {
      parts.push(`"${criteria.exactPhrase.replace(/"/g, '\\"')}"`);
    }

    if (criteria.text) {
      parts.push(criteria.text);
    }

    if (criteria.excludeText) {
      parts.push(`-${this.escapeValue(criteria.excludeText)}`);
    }

    if (criteria.hasAttachment) {
      parts.push('has:attachment');
    }

    if (criteria.filename) {
      parts.push(`filename:${this.escapeValue(criteria.filename)}`);
    }

    if (criteria.afterDate) {
      parts.push(`after:${this.formatDate(criteria.afterDate)}`);
    }

    if (criteria.beforeDate) {
      parts.push(`before:${this.formatDate(criteria.beforeDate)}`);
    }

    if (criteria.newerThan) {
      parts.push(`newer_than:${criteria.newerThan}`);
    }

    if (criteria.olderThan) {
      parts.push(`older_than:${criteria.olderThan}`);
    }

    if (criteria.largerThan !== undefined) {
      parts.push(`larger:${criteria.largerThan}`);
    }

    if (criteria.smallerThan !== undefined) {
      parts.push(`smaller:${criteria.smallerThan}`);
    }

    if (criteria.isUnread !== undefined) {
      parts.push(criteria.isUnread ? 'is:unread' : 'is:read');
    }

    if (criteria.isStarred !== undefined) {
      parts.push(criteria.isStarred ? 'is:starred' : '-is:starred');
    }

    if (criteria.isImportant !== undefined) {
      parts.push(criteria.isImportant ? 'is:important' : '-is:important');
    }

    if (criteria.category) {
      parts.push(`category:${criteria.category}`);
    }

    if (criteria.label) {
      parts.push(`label:${this.escapeValue(criteria.label)}`);
    }

    if (criteria.excludeLabel) {
      parts.push(`-label:${this.escapeValue(criteria.excludeLabel)}`);
    }

    if (criteria.rawQuery) {
      parts.push(criteria.rawQuery);
    }

    return parts.join(' ').trim();
  }

  /**
   * Helper to format dates into `YYYY/MM/DD` format accepted by Gmail.
   *
   * @param dateInput - ISO string or date formatted string.
   * @returns Date string formatted with slashes.
   */
  private static formatDate(dateInput: string): string {
    return dateInput.replace(/-/g, '/');
  }

  /**
   * Helper to escape or quote search terms containing spaces or special characters.
   *
   * @param val - Value to escape.
   * @returns Escaped value string.
   */
  private static escapeValue(val: string): string {
    if (val.includes(' ') && !val.startsWith('"') && !val.endsWith('"')) {
      return `"${val}"`;
    }
    return val;
  }
}
