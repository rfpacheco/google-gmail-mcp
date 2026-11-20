# Gmail MCP Sorting & Filtering Architecture & Guide

This guide establishes a comprehensive, structured system for **connecting an AI agent to Google Gmail via MCP** and bringing rigorous **order to Gmail's sorting, filtering, and categorization methods**.

---

## 1. Executive Summary & Architecture

Gmail's architecture separates email retrieval, automated routing, and user organization into distinct layers. Unlike relational databases, the Gmail API does **not** provide SQL-style `ORDER BY` clauses (e.g. you cannot natively ask the API to order by sender or attachment size). Instead, order is achieved through a multi-tiered architecture:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Gmail Integration Layer                         │
│                    (@pouyanafisi/gmail-mcp / OAuth2)                   │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
    ┌───────────────────────────────┴──────────────────────────────┐
    ▼                                                              ▼
┌─────────────────────────────────────────┐  ┌─────────────────────────────────────────┐
│     Incoming Automation (Filters)       │  │       Retrieval & Search (Queries)      │
│  - users.settings.filters API           │  │  - Native search query grammar          │
│  - Server-side rule evaluation          │  │  - Boolean combinations (AND, OR, NOT) │
│  - Automatic routing & triage           │  │  - Categorization & status filters      │
└───────────────────┬─────────────────────┘  └─────────────────────┬───────────────────┘
                    │                                              │
                    ▼                                              ▼
┌─────────────────────────────────────────┐  ┌─────────────────────────────────────────┐
│       Label & Hierarchy Taxonomy        │  │     Client-Side Sorting Pipeline        │
│  - System states (INBOX, UNREAD)        │  │  - Date (asc/desc)                      │
│  - Smart categories (Updates, Promo)    │  │  - Message Size (largest first)         │
│  - Nested custom hierarchy              │  │  - Sender alphabetical (A-Z)            │
│  - Visibility management                │  │  - Multi-attribute tie breaking        │
└─────────────────────────────────────────┘  └─────────────────────────────────────────┘
```

---

## 2. The 5 Pillars of Gmail Sorting & Filtering

### Pillar 1: Dynamic Query Filtering (Search Operators)
Gmail search queries (`q` parameter in `search_emails`) evaluate against Google's search index.

| Dimension | Operator | Example | Explanation |
| :--- | :--- | :--- | :--- |
| **Sender/Receiver** | `from:` / `to:` / `cc:` | `from:billing@stripe.com` | Match exact address or domain (`@stripe.com`) |
| **Subject** | `subject:` | `subject:"invoice"` | Matches word or phrase in subject |
| **Date Windows** | `after:` / `before:` | `after:2026/01/01 before:2026/03/31` | Absolute date range (`YYYY/MM/DD`) |
| **Relative Age** | `newer_than:` / `older_than:` | `newer_than:7d older_than:30d` | Windows using `d` (days), `m` (months), `y` (years) |
| **Attachments** | `has:attachment`, `filename:` | `has:attachment filename:pdf` | Restrict to messages with specific attachment formats |
| **Size Thresholds** | `larger:` / `smaller:` | `larger:10M smaller:500K` | Filter by email payload size |
| **State Flags** | `is:unread`, `is:read`, `is:starred` | `is:unread is:starred` | Read/starred status |
| **Categories** | `category:` | `category:updates` | `primary`, `social`, `promotions`, `updates`, `forums` |
| **Labels** | `label:` / `-label:` | `label:INBOX -label:Newsletters` | Inclusion / exclusion of labels |

#### Boolean Logic & Precedence
- **AND**: Space between terms (e.g., `from:stripe.com has:attachment`).
- **OR**: Capitalized `OR` or `{}` (e.g., `from:alice OR from:bob` or `{from:alice from:bob}`).
- **NOT**: Leading `-` (e.g., `-label:Spam -category:promotions`).
- **Grouping**: Parentheses `()` (e.g., `from:github.com (subject:PR OR subject:Issue)`).

---

### Pillar 2: Persistent Automated Filters (`users.settings.filters`)
Filters execute server-side on incoming mail *before* reaching your inbox.

```typescript
interface GmailFilter {
  criteria: {
    from?: string;            // Sender match pattern
    to?: string;              // Recipient pattern
    subject?: string;         // Subject pattern
    query?: string;           // Free-form search query
    negatedQuery?: string;    // Negative search terms
    hasAttachment?: boolean;  // Must have attachment
    size?: number;            // Size threshold (bytes)
    sizeComparison?: 'larger' | 'smaller';
  };
  action: {
    addLabelIds?: string[];   // Labels to apply
    removeLabelIds?: string[];// Labels to remove (e.g. ['INBOX'] = Archive)
    forward?: string;         // Forwarding address
  };
}
```

#### Standard Filter Recipes:
1. **Auto-Archive Newsletters**:
   - `criteria`: `{ query: 'unsubscribe OR "opt-out"' }`
   - `action`: `{ addLabelIds: ['Label_Newsletters'], removeLabelIds: ['INBOX'] }`
2. **Financial Documents & Invoices**:
   - `criteria`: `{ query: 'invoice OR receipt OR billing OR factura', hasAttachment: true }`
   - `action`: `{ addLabelIds: ['Label_Invoices'] }`
3. **VIP Senders**:
   - `criteria`: `{ from: '@vipdomain.com' }`
   - `action`: `{ addLabelIds: ['IMPORTANT', 'STARRED'] }`
4. **Large Attachment Quarantine**:
   - `criteria`: `{ size: 10485760, sizeComparison: 'larger' }`
   - `action`: `{ addLabelIds: ['Label_HeavyAttachments'] }`

---

### Pillar 3: Label Taxonomy & Hierarchy

A clean inbox relies on a disciplined label structure:

```
[System Core]
├── INBOX          (Active incoming triage)
├── STARRED        (Flagged items)
├── IMPORTANT      (High priority algorithmic bucket)
└── SENT / DRAFT / TRASH / SPAM

[Smart Categories]
├── Primary
├── Updates        (Transactional emails, receipts, confirmations)
├── Promotions     (Marketing, discounts)
└── Social         (Networks, communities)

[Custom Nested Hierarchy]
├── Action/
│   ├── Today      (Must answer/act today)
│   └── Waiting    (Waiting on external response)
├── Projects/
│   ├── Alpha
│   └── Beta
├── Finance/
│   └── Invoices
├── Newsletters/
└── System/
    └── Alerts
```

---

### Pillar 4: Deterministic Client-Side Sorting Engine

Because Gmail API search results only return messages chronologically (newest first), the project includes `GmailSorter` (`src/sorting-and-filtering/sorter.ts`) to sort email datasets across multiple dimensions:

1. **Sort by Size**: Identifies storage hogs (`field: 'size', direction: 'desc'`).
2. **Sort by Sender**: Group communications alphabetically (`field: 'from', direction: 'asc'`).
3. **Sort by Unread Priority**: Surfacing unread messages first while preserving chronological ordering (`field: 'unreadPriority', secondaryField: 'date'`).
4. **Sort by Date**: Oldest first (`direction: 'asc'`) or newest first (`direction: 'desc'`).

---

### Pillar 5: Retroactive Batch Triage

Native Gmail filters **only apply to incoming messages**. To organize an existing messy inbox:
1. Search messages matching a pattern using `search_emails({ query: 'from:newsletters@...' })`.
2. Collect the resulting `messageIds`.
3. Call `batch_modify_emails({ messageIds, addLabelIds: ['Label_Newsletters'], removeLabelIds: ['INBOX'] })`.

---

## 3. MCP Server Operations Reference

The `@pouyanafisi/gmail-mcp` server exposes **19 structured tools**:

### Email Operations
- `search_emails`: Search messages using Gmail query syntax (`query`, `maxResults`).
- `read_email`: Read complete MIME content, headers, and attachment references (`messageId`).
- `count_emails`: Get exact email count for a label (`labelId` or `labelName`).
- `send_email`: Send emails with plain text, HTML, and file attachments.
- `draft_email`: Create drafts with attachments.
- `modify_email`: Add or remove labels from an email (`messageId`, `addLabelIds`, `removeLabelIds`).
- `delete_email`: Permanently delete an email (`messageId`).
- `download_attachment`: Download attachment by ID to local filesystem.
- `batch_modify_emails`: Modify labels on up to 100 emails simultaneously.
- `batch_delete_emails`: Delete multiple emails in bulk.

### Label Management
- `list_email_labels`: List all system and user labels.
- `create_label`: Create a label with name and visibility rules.
- `update_label`: Rename label or adjust visibility.
- `delete_label`: Delete a custom user label.
- `get_or_create_label`: Idempotently get or create a label by name.

### Filter Management
- `create_filter`: Create custom filter with criteria and actions.
- `list_filters`: List all active Gmail filter rules.
- `get_filter`: Inspect specific filter details by ID.
- `delete_filter`: Remove a filter rule by ID.
- `create_filter_from_template`: Create rule from pre-built templates (`fromSender`, `withSubject`, `withAttachments`, `largeEmails`, `containingText`, `mailingList`).

---

## 4. How to Connect Gmail via OAuth 2.0

### Step 1: Obtain Google Cloud OAuth Credentials
1. Open the [Google Cloud Console](https://console.cloud.google.com/).
2. Create or select a project.
3. Enable the **Gmail API** in **APIs & Services > Library**.
4. Configure the **OAuth Consent Screen** (User Type: External, add `gmail.modify` and `gmail.settings.basic` scopes, and add your email as a Test User).
5. Go to **APIs & Services > Credentials > Create Credentials > OAuth client ID**.
6. Select **Desktop app** (or **Web application** with redirect URI `http://localhost:3000/oauth2callback`).
7. Download the credentials JSON and save it as:
   - `./gcp-oauth.keys.json` (in the project root), OR
   - `~/.gmail-mcp/gcp-oauth.keys.json`.

### Step 2: Run the Authorization Script
Run the interactive CLI command:
```bash
npm run auth
```
This opens your browser to sign into your Google account and saves the refresh tokens to `~/.gmail-mcp/credentials.json`.

### Step 3: Audit and Verify
Inspect your live account filters and labels:
```bash
npm run audit
```

### Step 4: Connecting to MCP Clients
Add the server to your MCP configuration (e.g. AgentsRoom, Claude Desktop, Cursor):
```json
{
  "mcpServers": {
    "gmail": {
      "command": "npx",
      "args": ["-y", "@pouyanafisi/gmail-mcp"]
    }
  }
}
```

---

## 5. TypeScript Toolkit Reference

The following modules are built in `src/sorting-and-filtering/`:
- `query-builder.ts`: Type-safe builder for Gmail search queries.
- `filter-manager.ts`: Definitions and templates for Gmail filter rules.
- `sorter.ts`: Client-side multi-attribute sorting engine.
- `taxonomy.ts`: Label hierarchy and classification constants.
