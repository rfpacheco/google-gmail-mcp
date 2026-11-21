# Security Policy

## Reporting Security Issues

We take the security of `google-gmail-mcp` seriously. Because this software interfaces with Google APIs and processes email metadata, we treat security vulnerabilities with high priority.

If you discover a security vulnerability or potential exposure:
1. **Do not disclose it publicly** on GitHub issues, discussions, or social media.
2. Please report it privately using **[GitHub Private Vulnerability Reporting](https://github.com/rfpacheco/google-gmail-mcp/security/advisories/new)** on this repository.

Please include:
- A description of the issue and potential impact.
- Steps to reproduce or a proof of concept.
- Details of your environment (Node.js version, OS).

We will acknowledge receipt within 48 hours and provide a remediation timeline.

---

## Security Architecture & Guarantees

`google-gmail-mcp` is designed with strict local-first security principles:

### 1. Local-Only OAuth2 Credentials & Tokens
- **Client Secrets:** Your Google Cloud OAuth2 Client ID and secret (`gcp-oauth.keys.json`) reside only on your local filesystem and are strictly gitignored.
- **Access & Refresh Tokens:** Authorization tokens are stored locally at `~/.gmail-mcp/credentials.json` with restricted filesystem permissions (`0o600` - read/write owner only).
- **No Third-Party Relays:** OAuth authentication uses a local loopback server (`http://127.0.0.1:<random-port>`). Tokens are exchanged directly between your local machine and Google OAuth endpoints (`oauth2.googleapis.com`).

### 2. Zero Telemetry & Privacy Guarantee
- The software contains **zero telemetry**, tracking, or analytics code.
- No email content, headers, subject lines, or message IDs are ever transmitted to any third-party server, cloud proxy, or external service.
- All filtering, sorting, and triage evaluations execute entirely on your machine.

### 3. Non-Destructive MCP Tool Surface
- The Model Context Protocol (MCP) server exposed to AI agents (`gmail-hybrid-mcp`) is intentionally designed to be **non-destructive**.
- **No Deletion Tools:** There are no tools in the MCP interface that delete (`users.messages.delete`) or trash (`users.messages.trash`) messages.
- AI agents can only search, inspect, summarize, apply/remove labels, and manage incoming filter rules. Permanent or trash purges are exclusively available through manual CLI scripts (`npm run purge -- --execute`) requiring explicit operator invocation.

### 4. Dependency & Code Safety
- The codebase maintains **0 production vulnerabilities** (`npm audit --omit=dev`).
- External dependencies are minimized to official Google APIs (`googleapis`), the standard MCP SDK (`@modelcontextprotocol/sdk`), and runtime schema validation (`zod`).
