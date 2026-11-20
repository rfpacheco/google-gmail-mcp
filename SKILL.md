---
name: google-gmail-mcp
description: Use when the user asks to audit, sort, triage, clean up, organize labels, reclaim storage, or create automated server-side filters in Gmail via the google-gmail-mcp hybrid MCP server.
---

# Gmail Automation & Inbox Triage Playbook (`google-gmail-mcp`)

This skill teaches AI agents (Claude Code, Cursor, Copilot, Agensi, and autonomous coding assistants) how and when to orchestrate the 8 coarse-grained tools provided by the `google-gmail-mcp` Stdio server.

---

## 1. Prerequisites & Environment Verification

Before calling Gmail tools, verify that the server is connected and authorized:

- **Server Executable**: `npx -y google-gmail-mcp`
- **One-Time OAuth Setup**: If an MCP tool returns an authentication error, advise the user to run:
  ```bash
  npx -y google-gmail-mcp auth
  ```
- **Optional Environment Variables**:
  - `GMAIL_OAUTH_PATH`: Custom path to `gcp-oauth.keys.json`.
  - `GMAIL_CREDENTIALS_PATH`: Custom path to user tokens (`credentials.json`).

---

## 2. Tool Reference (8 Coarse-Grained Tools)

| Tool Name | Type | Key Parameters | Description |
| :--- | :---: | :--- | :--- |
| `gmail_inbox_summary` | Read | *(none)* | Total inbox count, unread count, and breakdown by smart categories (primary, updates, promotions, social, forums). |
| `gmail_list_filters` | Read | *(none)* | Lists all active server-side Google filter rules (ID, match criteria, and actions). |
| `gmail_search_and_sort` | Read | `from`, `to`, `subject`, `text`, `hasAttachment`, `afterDate`, `beforeDate`, `isUnread`, `label`, `category`, `sortField`, `sortDirection`, `maxResults` | Queries messages and sorts them client-side by `date`, `size`, `from`, `subject`, `unreadPriority`, or `importance`. |
| `gmail_sync_taxonomy_labels` | Setup | *(none)* | Ensures baseline taxonomy labels (`Action/*`, `Finance/Invoices`, `Newsletters`, `System/Alerts`, `Reference/Archive`) exist. |
| `gmail_batch_triage` | Mutate | `messageIds`, `addLabelNames`, `archiveInbox`, `markAsRead` | Atomic bulk label modification and archiving in high-throughput batches (up to 1,000 IDs per operation). |
| `gmail_create_filter` | Mutate | `from`, `subject`, `query`, `targetLabelName`, `archiveInbox` | Registers a persistent incoming filter rule in Gmail settings with Skip Inbox enforcement. |
| `gmail_delete_filter` | Mutate | `filterId` | Deletes a server-side filter rule by unique filter ID. |
| `gmail_storage_audit` | Read | `minSizeMb` (default: 5), `maxResults` (default: 25) | Scans for heavy messages exceeding size threshold, returning metadata sorted largest to smallest. |

---

## 3. Standard Agent Playbooks

### Playbook A: Inbox & Filter Health Audit (Read-Only)
**When**: The user asks *"Check my inbox status"*, *"What emails are sitting in my inbox?"*, or *"Show me my existing filters"*.

1. Call `gmail_inbox_summary` to inspect current volume and category distribution.
2. Call `gmail_list_filters` to audit active server-side rules.
3. Report a clear, structured summary to the user:
   - Whether the inbox is at True Inbox Zero (0 messages) or has lingering backlog.
   - Total active automated filter rules and categories covered.

### Playbook B: Deterministic Search & Multi-Attribute Sort
**When**: The user asks *"Find the largest emails from GitHub"*, *"List recent invoices"*, or *"Find unread emails from last week"*.

1. Formulate precise query parameters:
   - For attachments: `hasAttachment: true`
   - For date bounds: `afterDate: "YYYY-MM-DD"`, `beforeDate: "YYYY-MM-DD"`
   - For sorting: `sortField: "size" | "date" | "from" | "subject"`, `sortDirection: "desc" | "asc"`
2. Call `gmail_search_and_sort`.
3. Present the top results with sender, subject, date, and size estimate.

### Playbook C: Baseline Label Hierarchy Initialization
**When**: The user is setting up a new mailbox or wants to ensure standard label taxonomy exists.

1. Call `gmail_sync_taxonomy_labels`.
2. The tool idempotently verifies or creates parent and child labels:
   - `Action/Today`, `Action/Waiting`
   - `Finance/Invoices`
   - `Newsletters`
   - `System/Alerts`
   - `Reference/Archive`
3. Confirm the label map returned by the server.

### Playbook D: Safe Bulk Triage & Inbox Zero Sweep
**When**: The user asks to *"Clean my inbox"*, *"Triage all newsletter promotions"*, or *"Reach Inbox Zero"*.

1. **Step 1 (Preview)**: Call `gmail_search_and_sort` with `label: "INBOX"` and the target category or sender.
2. **Step 2 (Plan Confirmation)**: Present the matched count, representative sample (senders, subjects), and intended action:
   - Apply target label (e.g. `Newsletters`, `Finance/Invoices`, `Dev/GitHub`).
   - Remove `INBOX` label (`archiveInbox: true`).
3. **Step 3 (Execute)**: Upon user confirmation, collect the `messageIds` and call `gmail_batch_triage`.
4. **Step 4 (Verify)**: Call `gmail_inbox_summary` to confirm the remaining inbox count.

### Playbook E: Persistent Server-Side Rule Creation
**When**: The user asks to *"Always auto-archive emails from X"*, *"Route newsletters to label Y and skip inbox"*, or *"Stop notifications from service Z"*.

1. **Check Existing Rules**: Always call `gmail_list_filters` first to verify that an equivalent rule does not already exist.
2. **Confirm Match Pattern**: State the sender domain or query pattern clearly to the user.
3. **Create Filter**: Call `gmail_create_filter`:
   - Set `archiveInbox: true` so matching emails bypass the inbox.
   - Set `targetLabelName` to the desired taxonomy label.
4. If replacing an outdated or redundant filter, delete the old rule using `gmail_delete_filter` with its `filterId`.

### Playbook F: Storage Reclamation Audit (Read-Only)
**When**: The user asks *"Why is my Gmail storage full?"*, or *"Find emails taking up space"*.

1. Call `gmail_storage_audit` with `minSizeMb: 10` (or `minSizeMb: 5`).
2. Review the top heavy items returned.
3. Group and present the heavy threads to the user (sender, size in MB, date, subject).
4. **Safety Rule**: `google-gmail-mcp` tools never delete messages permanently. Advise the user to inspect candidates or use the local `npm run purge` CLI engine with its protection whitelist.

---

## 4. Safety Guardrails & Operational Constraints

1. **Preview Before Mutation**:
   - Always run read-only queries (`gmail_inbox_summary`, `gmail_search_and_sort`, `gmail_list_filters`) before modifying labels or archiving.
   - Always report the candidate count and sample subjects to the user before calling `gmail_batch_triage`.
2. **Idempotent Filter Creation**:
   - Always inspect `gmail_list_filters` before creating a new filter to prevent duplicate rules in Google settings.
3. **No Destructive Message Deletion via MCP**:
   - The MCP tool surface is strictly non-destructive. Trashing or permanent deletion is reserved for the local CLI engine (`npm run purge`) where user whitelist configs are enforced.
4. **Respect User Confirmation on Broad Rules**:
   - When creating server-side filters with `archiveInbox: true`, ensure the match criteria are specific (e.g. `@domain.com` or specific sender) rather than overly broad keywords that could accidentally archive critical personal emails.
