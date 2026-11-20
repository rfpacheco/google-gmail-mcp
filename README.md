# Gmail Automation & Hybrid MCP Suite

A high-performance TypeScript backend and Model Context Protocol (MCP) suite for automated Gmail management: deterministic client-side sorting, bulk inbox sweeps, structured label taxonomy, and persistent server-side filter creation with "Skip Inbox" enforcement.

---

## Features

- **Hybrid Architecture**: Decoupled shared core engine supporting both headless CLI automation and coarse-grained MCP tools for AI agents.
- **Client-Side Sorting**: Solves Gmail's lack of server-side `ORDER BY` by querying, chunk-fetching metadata, and sorting by date, size, sender, or importance.
- **Inbox Zero Sweeper**: Atomic batch modification (`batchModify` up to 1,000 items/call) to rapidly categorize and archive backlog emails.
- **Hierarchical Taxonomy**: Baseline taxonomy (`Action/*`, `Projects`, `Finance/Invoices`, `Newsletters`, `System/Alerts`, `Reference/Archive`) plus configurable nested hierarchies (`Dev/*`, `Finance/*`, `Jobs/*`, `Learning/*`, `Transport/*`, `Social`).
- **Persistent Server-Side Filters**: Auto-creates incoming Gmail filter rules (`users.settings.filters`) with Skip Inbox enforced.
- **Storage Reclamation**: Deep scans for heavy messages (>10MB / >5MB) with strict whitelist protection policies.

---

## Quick Start

### 1. Installation

```bash
npm install
```

### 2. Google Cloud OAuth Setup

1. Enable the **Gmail API** in [Google Cloud Console](https://console.cloud.google.com/).
2. Configure your OAuth Consent Screen and add your email under **Test Users**.
3. Create an **OAuth 2.0 Client ID** (Application type: `Desktop app`) and download the JSON.
4. Save the credential file in the project root as `gcp-oauth.keys.json` (see `gcp-oauth.keys.example.json`).

### 3. Authenticate

Run the interactive authorization CLI:

```bash
npm run auth
```

Tokens are securely persisted at `~/.gmail-mcp/credentials.json`.

### 4. Configuration

The repository uses externalized JSON configuration files in `config/` so you can customize label restructuring, filter rules, and storage whitelist protection without modifying source code:

- **Filter & Taxonomy Rules**: Copy `config/rules.example.json` to `config/rules.local.json` to configure custom label renames, server-side filter rules, and sender triage mappings.
- **Storage Purge Whitelist**: Copy `config/purge.example.json` to `config/purge.local.json` to configure protected sender/subject patterns (emails that must never be deleted) and candidate query parameters.
- `config/*.local.json` files are gitignored and never committed.

---

## Available Commands

| Command | Description |
| :--- | :--- |
| `npm run build` | Compiles TypeScript (`src/`) to `dist/`. |
| `npm run auth` | Interactive Google OAuth 2.0 authorization flow. |
| `npm run audit` | Inspects account stats, custom labels, and active automated filter rules. |
| `npm run sync-labels` | Idempotently creates and synchronizes the baseline taxonomy labels. |
| `npm run triage` | Sample batch triage sweep (moves promotions older than 7d to `Newsletters`). |
| `npm run inbox-zero` | Complete sweep to triage all incoming backlog to 0 messages in INBOX. |
| `npm run sweep` | Category-specific inbox sweeper (promotions, social, updates). |
| `npm run organize` | Restructures labels into clean nested hierarchies and updates filter rules. |
| `npm run reorder` | Checks INBOX, registers automated filters with Skip Inbox, and batch-triages remaining emails. |
| `npm run storage` | Scans and lists the heaviest emails (>10MB / >5MB) in the account. |
| `npm run purge` | Safe dry-run storage purge with configurable whitelist (pass `-- --execute` to move candidates to Trash). |
| `npm run mcp-hybrid` | Starts this repo's Hybrid MCP server (`src/mcp/hybrid-server.ts`) over Stdio. |
| `npm run start` | Starts the upstream `@pouyanafisi/gmail-mcp` server. |

---

## MCP Client Configuration

Connect `google-gmail-mcp` to AI agents (Claude Code, Cursor, GitHub Copilot) via Stdio:

### Claude Code
Add to your Claude Code configuration:
```json
{
  "mcpServers": {
    "gmail": {
      "command": "npx",
      "args": ["-y", "google-gmail-mcp"]
    }
  }
}
```

### Cursor
Add to `.cursor/mcp.json` or Cursor Settings > MCP:
```json
{
  "mcpServers": {
    "google-gmail": {
      "command": "npx",
      "args": ["-y", "google-gmail-mcp"]
    }
  }
}
```

### GitHub Copilot
Add to your agent configuration:
```json
{
  "mcpServers": {
    "gmail-automation": {
      "command": "npx",
      "args": ["-y", "google-gmail-mcp"]
    }
  }
}
```

### Environment Variables
Configure custom paths when running in containerized or non-standard environments:
- `GMAIL_OAUTH_PATH`: Custom file path to Google Cloud `gcp-oauth.keys.json` (defaults to `./gcp-oauth.keys.json` or `~/.gmail-mcp/gcp-oauth.keys.json`).
- `GMAIL_CREDENTIALS_PATH`: Custom file path to `credentials.json` user tokens (defaults to `~/.gmail-mcp/credentials.json`).

---

## Coarse-Grained MCP Tools

The Hybrid MCP server exposes 8 high-level tools backed by the core engine:

1. `gmail_search_and_sort`: Search with native operators and client-side sorting (date, size, sender, importance).
2. `gmail_batch_triage`: Bulk label modification, archive, and mark-as-read in high-throughput chunks.
3. `gmail_sync_taxonomy_labels`: Idempotent creation of standard taxonomy labels.
4. `gmail_create_filter`: Create persistent incoming server-side filter rules with Skip Inbox.
5. `gmail_list_filters`: Read-only listing of all active server-side filter rules and criteria.
6. `gmail_delete_filter`: Delete a server-side filter rule by filter ID.
7. `gmail_inbox_summary`: Read-only inbox overview with total count, unread count, and smart category breakdown.
8. `gmail_storage_audit`: Read-only scan for heavy messages exceeding a size threshold (in MB) sorted by size.

---

## Documentation

- [Architecture & MCP Reference](docs/gmail-architecture.md) — 5-pillar sorting/filtering architecture, two-tier label taxonomy, and MCP tool schemas.
- [AGENTS.md](AGENTS.md) — Concise coding-agent instructions and safety boundaries.

---

## License

MIT
