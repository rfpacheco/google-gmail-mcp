# Project Instructions (`google-gmail-mcp`)

TypeScript (ESM / NodeNext) Gmail automation suite and standalone Hybrid MCP server built on `googleapis` and `@modelcontextprotocol/sdk`.

## Repository Map

- `src/sorting-and-filtering/` — Pure logic (no Gmail I/O): `query-builder.ts`, `filter-manager.ts`, `sorter.ts`, `taxonomy.ts`, barrel `index.ts`.
- `src/services/` — Gmail API layer: `gmail-client.ts` (native loopback OAuth2 client), `batch-triage-service.ts` (chunked metadata fetch, 1,000-msg `batchModify`, filter creation, label sync).
- `src/utils/config-loader.ts` — Loads `config/*.local.json` with fallback to `config/*.example.json`.
- `src/mcp/hybrid-server.ts` — Standalone Stdio MCP server (`gmail-hybrid-mcp`, 8 coarse-grained tools).
- `src/scripts/` — 10 CLI entrypoints executed via `tsx`.
- `config/` — `rules.example.json` & `purge.example.json` templates (local overrides are gitignored).
- `docs/gmail-architecture.md` — On-demand reference for the 5-pillar architecture, taxonomy tiers, and MCP tools. Read only when working on architecture, filters, or MCP tools.

## Validation & Commands

- **Typecheck (no build output)**: `npx tsc --noEmit`
- **Full build**: `npm run build` (emits to `dist/`)
- **Tests / linter**: None configured yet. Always run `npx tsc --noEmit` after TypeScript changes.

### Live Gmail Scripts — Safety Boundaries

All CLI scripts authenticate against the user's real Gmail account (`~/.gmail-mcp/credentials.json`). **Never run mutating scripts unless explicitly requested.**

| Safety | Commands | Notes |
| :--- | :--- | :--- |
| **Read-only / Dry-run** | `npm run audit`, `npm run purge` | `purge` defaults to `--dry-run`; only trashes with `-- --execute`. |
| **Mostly read-only** | `npm run storage` | Scans >10MB / >5MB emails; calls `syncTaxonomyLabels()` which can create missing baseline labels. |
| **Mutates Gmail** | `sync-labels`, `triage`, `sweep`, `organize`, `reorder`, `inbox-zero`, `purge -- --execute` | Creates/renames labels, registers filters, archives, or trashes real emails. |
| **Interactive / Server** | `npm run auth`, `npm run mcp-hybrid`, `npm run start` | `mcp-hybrid` / `start` runs `src/mcp/hybrid-server.ts` over Stdio. |

## Non-Obvious Conventions & Pitfalls

1. **ESM `.js` extensions required**: `package.json` uses `"type": "module"` and `tsconfig.json` uses `"module": "NodeNext"`. Every relative import in `src/**/*.ts` **must** end with `.js` (e.g., `../services/gmail-client.js`).
2. **Strict TypeScript + TSDoc**: `strict: true` is enforced. Match existing TSDoc comments (`@packageDocumentation`, `@param`, `@returns`) on exported modules and functions.
3. **Standalone MCP Server**:
   - `src/mcp/hybrid-server.ts` (`npm run mcp-hybrid` or `npm run start`) exposes 8 coarse-grained tools (`gmail_search_and_sort`, `gmail_batch_triage`, `gmail_sync_taxonomy_labels`, `gmail_create_filter`, `gmail_list_filters`, `gmail_delete_filter`, `gmail_inbox_summary`, `gmail_storage_audit`).
4. **Two-tier label taxonomy**:
   - Baseline labels live in `RECOMMENDED_LABEL_TAXONOMY` (`src/sorting-and-filtering/taxonomy.ts`, 7 labels synced by `syncTaxonomyLabels()`).
   - User-specific renames, server-side filters, and sender triage mappings live in `config/rules.local.json` (falling back to `config/rules.example.json`).
5. **OAuth credential locations**: Client secrets at `./gcp-oauth.keys.json` (or `~/.gmail-mcp/gcp-oauth.keys.json`); tokens at `~/.gmail-mcp/credentials.json`.

## Do Not Read, Edit, or Commit

- **Secrets & personal config**: `gcp-oauth.keys.json`, `config/*.local.json`, `~/.gmail-mcp/credentials.json`.
- **Generated / noisy / unrelated files**: `package-lock.json`, `dist/`, `node_modules/`, `GITHUB_REPOS_AUDIT.md`, `.agentsroom/`, `.agents/`, `.claude/`, `.mcp.json`.
