# Gmail Sorting, Filtering & Hybrid MCP Architecture

On-demand technical reference for the 5-pillar Gmail organization engine and MCP integrations. For installation, OAuth 2.0 setup, and CLI usage, see [README.md](../README.md).

---

## 1. Hybrid Architecture

Gmail API search does not support SQL-style `ORDER BY`. This project layers a shared TypeScript core under two execution interfaces:

- **Pure core (`src/sorting-and-filtering/`)**: `GmailQueryBuilder` (`query-builder.ts`), `GmailFilterTemplates` (`filter-manager.ts`), `GmailSorter` (`sorter.ts`), and baseline `RECOMMENDED_LABEL_TAXONOMY` (`taxonomy.ts`).
- **Gmail API service (`src/services/`)**: `getAuthenticatedGmailClient` (`gmail-client.ts`, native loopback OAuth2) and `searchAndSortEmails`, `batchApplyTriage`, `syncTaxonomyLabels`, `createPersistentFilter` (`batch-triage-service.ts`).
- **Externalized config (`src/utils/config-loader.ts`)**: Reads `config/rules.local.json` and `config/purge.local.json`, falling back to `config/*.example.json`.
- **Interfaces**:
  1. **Headless CLI scripts (`src/scripts/`)** for deterministic bulk operations without LLM latency.
  2. **Hybrid MCP server (`src/mcp/hybrid-server.ts`)** exposing 8 coarse-grained tools over Stdio.

---

## 2. The 5 Pillars

1. **Dynamic Query Building (`query-builder.ts`)**: Compiles structured `GmailSearchCriteria` (`from`, `to`, `subject`, `afterDate`, `beforeDate`, `newerThan`, `olderThan`, `hasAttachment`, `largerThan`, `smallerThan`, `isUnread`, `category`, `label`, etc.) into native Gmail `q` syntax.
2. **Persistent Server-Side Filters (`filter-manager.ts`, `createPersistentFilter`)**: Registers incoming rules via `users.settings.filters.create` with Skip Inbox (`removeLabelIds: ['INBOX']`) enforced. Configured declaratively in `config/rules.*.json`.
3. **Two-Tier Label Taxonomy (`taxonomy.ts` + `config/rules.*.json`)**:
   - **Baseline (`RECOMMENDED_LABEL_TAXONOMY`)**: 7 core labels synced idempotently by `syncTaxonomyLabels()` — `Action/Today`, `Action/Waiting`, `Projects`, `Finance/Invoices`, `Newsletters`, `System/Alerts`, `Reference/Archive`.
   - **User-configured hierarchy (`config/rules.*.json`)**: Custom label renames (`labelRenameMap`), automated filter targets (`automatedRules`, e.g., `Dev/*`, `Finance/*`, `Jobs/*`, `Transport/*`, `Social`), and sender triage rules (`senderTriageMappings`).
4. **Client-Side Sorting (`sorter.ts`)**: `searchAndSortEmails()` fetches message metadata in chunks of 10 and sorts in-memory via `GmailSorter.sort()` by `date`, `size`, `from`, `subject`, `unreadPriority`, or `importance` (with optional secondary tie-breaker).
5. **Retroactive Batch Triage (`batch-triage-service.ts`)**: Gmail filters only apply to new mail. `batchApplyTriage()` applies/removes labels retroactively via `users.messages.batchModify` in atomic chunks of up to **1,000 IDs per request**.

---

## 3. MCP Server Reference

### Standalone Hybrid MCP Server (`npm run mcp-hybrid` / `npm run start`)

Implemented in `src/mcp/hybrid-server.ts` (`gmail-hybrid-mcp`, Stdio transport). Exposes 8 coarse-grained tools backed by `batch-triage-service.ts` and `gmail-client.ts`:

| Tool | Purpose | Key Inputs |
| :--- | :--- | :--- |
| `gmail_search_and_sort` | Search with native operators + client-side sort | `from`, `to`, `subject`, `text`, `hasAttachment`, `afterDate`, `beforeDate`, `isUnread`, `label`, `category`, `sortField`, `sortDirection`, `maxResults` (1–250) |
| `gmail_batch_triage` | Atomic bulk label add/archive/mark-read (auto-creates missing labels) | `messageIds`, `addLabelNames`, `archiveInbox`, `markAsRead` |
| `gmail_sync_taxonomy_labels` | Idempotently creates baseline taxonomy labels and returns `name -> id` map | *(none)* |
| `gmail_create_filter` | Creates a persistent server-side Gmail filter rule with Skip Inbox option | `from`, `subject`, `query`, `targetLabelName`, `archiveInbox` |
| `gmail_list_filters` | Lists all existing automated filter rules in Gmail settings | *(none)* |
| `gmail_delete_filter` | Deletes a server-side filter rule by unique filter ID | `filterId` |
| `gmail_inbox_summary` | Read-only breakdown of INBOX status and category metrics | *(none)* |
| `gmail_storage_audit` | Read-only scan for heavy emails exceeding a threshold (MB) | `thresholdMB` (1–50, default: 5), `maxResults` |

MCP client configuration example (local checkout):

```json
{
  "mcpServers": {
    "gmail-hybrid": {
      "command": "node",
      "args": ["dist/mcp/hybrid-server.js"],
      "cwd": "/path/to/google-gmail-mcp"
    }
  }
}
```

Or run via npx:

```json
{
  "mcpServers": {
    "gmail-hybrid": {
      "command": "npx",
      "args": ["-y", "google-gmail-mcp"]
    }
  }
}
```
