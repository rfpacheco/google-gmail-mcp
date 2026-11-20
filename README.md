# Gmail Automation & Hybrid MCP Suite

A high-performance TypeScript backend and Model Context Protocol (MCP) suite for automated Gmail management: deterministic client-side sorting, bulk inbox sweeps, structured label taxonomy, and persistent server-side filter creation with "Skip Inbox" enforcement.

---

## Features

- **Hybrid Architecture**: Decoupled shared core engine supporting both headless CLI automation and coarse-grained MCP tools for AI agents.
- **Client-Side Sorting**: Solves Gmail's lack of server-side `ORDER BY` by querying, chunk-fetching metadata, and sorting by date, size, sender, or importance.
- **Inbox Zero Sweeper**: Atomic batch modification (`batchModify` up to 1,000 items/call) to rapidly categorize and archive backlog emails.
- **Hierarchical Taxonomy**: Standard nested labels (`Dev/*`, `Finance/*`, `Jobs/*`, `Learning/*`, `Transport/*`, `Personal/*`, `Research/*`, `System/*`).
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
| `npm run audit` | Inspects account stats, custom labels, and active automated filter rules. |
| `npm run sync-labels` | Idempotently creates and synchronizes the baseline taxonomy labels. |
| `npm run inbox-zero` | Complete sweep to triage all incoming backlog to 0 messages in INBOX. |
| `npm run sweep` | Category-specific inbox sweeper (promotions, social, updates). |
| `npm run organize` | Restructures labels into clean nested hierarchies and updates filter rules. |
| `npm run reorder` | Checks INBOX, registers automated filters with Skip Inbox, and batch-triages remaining emails. |
| `npm run storage` | Scans and lists the heaviest emails (>10MB / >5MB) in the account. |
| `npm run purge` | Safely moves heavy duplicates and emails >5 years to Trash (with configurable whitelist and dry-run safety). |
| `npm run mcp-hybrid` | Starts the Model Context Protocol server over Stdio for AI agent integrations. |

---

## License

MIT
