/**
 * Gmail Filter Manager and Automation Templates.
 *
 * Provides definitions and helper utilities for creating and structuring
 * native Gmail automated filter rules (users.settings.filters).
 *
 * @packageDocumentation
 */

/**
 * Filter match criteria defining which incoming emails match the rule.
 */
export interface GmailFilterCriteria {
  /**
   * Sender email or domain to match (e.g., "newsletter@company.com" or "@alerts.service.com").
   */
  from?: string;

  /**
   * Recipient email address to match (e.g., "team+billing@mycompany.com").
   */
  to?: string;

  /**
   * Subject line pattern or keywords.
   */
  subject?: string;

  /**
   * Search query string matching the body or metadata (e.g., "has:attachment").
   */
  query?: string;

  /**
   * Query terms that must NOT be present in matching emails.
   */
  negatedQuery?: string;

  /**
   * Whether the incoming email must include attachments.
   */
  hasAttachment?: boolean;

  /**
   * Whether to exclude Google Chat messages from the filter.
   */
  excludeChats?: boolean;

  /**
   * Size threshold in bytes.
   */
  size?: number;

  /**
   * Size comparison operator relative to the size property.
   */
  sizeComparison?: 'smaller' | 'larger' | 'unspecified';
}

/**
 * Actions executed automatically by Gmail when an email matches the criteria.
 */
export interface GmailFilterAction {
  /**
   * Array of label IDs to apply to the matching email.
   */
  addLabelIds?: string[];

  /**
   * Array of label IDs to remove from the matching email (e.g. `['INBOX']` to archive, `['UNREAD']` to mark read).
   */
  removeLabelIds?: string[];

  /**
   * Forward matching emails to this destination address.
   */
  forward?: string;
}

/**
 * Full definition of a Gmail filter rule.
 */
export interface GmailFilterRule {
  /**
   * Unique filter ID assigned by Gmail API (present on existing filters).
   */
  id?: string;

  /**
   * Matching criteria for the filter.
   */
  criteria: GmailFilterCriteria;

  /**
   * Actions to trigger on matching emails.
   */
  action: GmailFilterAction;
}

/**
 * Template configuration for common email categorization recipes.
 */
export type FilterTemplateType =
  | 'autoArchiveNewsletters'
  | 'vipSenderPrioritization'
  | 'financialInvoicesAndReceipts'
  | 'largeAttachmentsQuarantine'
  | 'automatedSystemAlerts'
  | 'mailingListRouting';

/**
 * Helper class for creating and ordering Gmail automated filters.
 */
export class GmailFilterTemplates {
  /**
   * Generates a pre-configured filter rule based on industry-standard inbox triage patterns.
   *
   * @param template - The pattern name.
   * @param options - Customization parameters for the template.
   * @returns Configured filter rule ready for creation via Gmail API.
   *
   * @example
   * ```typescript
   * const invoiceFilter = GmailFilterTemplates.create('financialInvoicesAndReceipts', {
   *   invoiceLabelId: 'Label_Invoices',
   *   markImportant: true
   * });
   * ```
   */
  public static create(
    template: FilterTemplateType,
    options: {
      sender?: string;
      labelId?: string;
      archive?: boolean;
      markAsRead?: boolean;
      markImportant?: boolean;
      sizeInBytes?: number;
      subjectPattern?: string;
    }
  ): GmailFilterRule {
    const addLabelIds: string[] = [];
    const removeLabelIds: string[] = [];

    if (options.labelId) {
      addLabelIds.push(options.labelId);
    }

    if (options.archive) {
      removeLabelIds.push('INBOX');
    }

    if (options.markAsRead) {
      removeLabelIds.push('UNREAD');
    }

    if (options.markImportant) {
      addLabelIds.push('IMPORTANT');
    }

    switch (template) {
      case 'autoArchiveNewsletters':
        return {
          criteria: {
            query: 'unsubscribe OR "opt-out" OR "mailing list"',
            from: options.sender,
          },
          action: {
            addLabelIds,
            removeLabelIds: removeLabelIds.includes('INBOX') ? removeLabelIds : [...removeLabelIds, 'INBOX'],
          },
        };

      case 'vipSenderPrioritization':
        return {
          criteria: {
            from: options.sender,
          },
          action: {
            addLabelIds: addLabelIds.includes('IMPORTANT') ? addLabelIds : [...addLabelIds, 'IMPORTANT', 'STARRED'],
            removeLabelIds,
          },
        };

      case 'financialInvoicesAndReceipts':
        return {
          criteria: {
            query: 'invoice OR receipt OR billing OR factura OR payment',
            hasAttachment: true,
            from: options.sender,
          },
          action: {
            addLabelIds,
            removeLabelIds,
          },
        };

      case 'largeAttachmentsQuarantine':
        return {
          criteria: {
            size: options.sizeInBytes ?? 10 * 1024 * 1024, // 10MB default
            sizeComparison: 'larger',
          },
          action: {
            addLabelIds,
            removeLabelIds,
          },
        };

      case 'automatedSystemAlerts':
        return {
          criteria: {
            subject: options.subjectPattern ?? '[ALERT] OR [CRITICAL] OR [ERROR]',
          },
          action: {
            addLabelIds: addLabelIds.includes('IMPORTANT') ? addLabelIds : [...addLabelIds, 'IMPORTANT'],
            removeLabelIds,
          },
        };

      case 'mailingListRouting':
        return {
          criteria: {
            query: `list:${options.sender ?? '*'}`,
          },
          action: {
            addLabelIds,
            removeLabelIds,
          },
        };

      default:
        throw new Error(`Unsupported filter template: ${template}`);
    }
  }
}
