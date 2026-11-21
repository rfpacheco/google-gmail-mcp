/**
 * Integration Tests for Stdio Hybrid MCP Server.
 *
 * Spawns `dist/mcp/hybrid-server.js` as an isolated subprocess with dummy credentials,
 * verifying JSON-RPC 2.0 handshake, all 8 tools with 4 explicit boolean annotations,
 * and sanitized error handling across all tool calls without contacting live Gmail.
 *
 * @packageDocumentation
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';

interface JsonRpcMessage {
  jsonrpc: string;
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: Record<string, unknown>;
}

class JsonRpcClient {
  private child: ReturnType<typeof spawn>;
  private rl: readline.Interface;
  private messageId = 0;
  private pending = new Map<number | string, (msg: JsonRpcMessage) => void>();

  constructor() {
    const serverPath = path.resolve('dist/mcp/hybrid-server.js');
    this.child = spawn('node', [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        GMAIL_OAUTH_PATH: '/nonexistent-oauth-keys-test.json',
        GMAIL_CREDENTIALS_PATH: '/nonexistent-credentials-test.json',
      },
    });

    this.rl = readline.createInterface({
      input: this.child.stdout!,
      crlfDelay: Infinity,
    });

    this.rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const msg = JSON.parse(trimmed) as JsonRpcMessage;
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          const resolve = this.pending.get(msg.id)!;
          this.pending.delete(msg.id);
          resolve(msg);
        }
      } catch {
        // Ignore non-JSON lines (e.g. logs)
      }
    });
  }

  public request(method: string, params: Record<string, unknown> = {}): Promise<JsonRpcMessage> {
    const id = ++this.messageId;
    const req: JsonRpcMessage = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.child.stdin!.write(JSON.stringify(req) + '\n');
    });
  }

  public close(): void {
    try {
      this.rl.close();
      this.child.stdin!.end();
      this.child.kill();
    } catch {
      // Ignore cleanup errors
    }
  }
}

describe('Hybrid MCP Server Stdio JSON-RPC Integration', () => {
  let client: JsonRpcClient;

  it('should initialize and return server version 1.0.1', async () => {
    client = new JsonRpcClient();
    const resp = await client.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'unit-test-runner', version: '1.0.0' },
    });

    assert.ok(resp.result);
    const serverInfo = resp.result.serverInfo as { name: string; version: string };
    assert.equal(serverInfo.name, 'google-gmail-mcp');
    assert.equal(serverInfo.version, '1.0.1');
  });

  it('should list all 8 tools with all 4 explicit boolean annotations matching specification', async () => {
    const resp = await client.request('tools/list', {});
    assert.ok(resp.result);
    const tools = resp.result.tools as Array<{
      name: string;
      description: string;
      annotations?: {
        readOnlyHint: boolean;
        destructiveHint: boolean;
        idempotentHint: boolean;
        openWorldHint: boolean;
      };
    }>;

    assert.equal(tools.length, 8);

    const expectedAnnotations: Record<
      string,
      {
        readOnlyHint: boolean;
        destructiveHint: boolean;
        idempotentHint: boolean;
        openWorldHint: boolean;
      }
    > = {
      gmail_search_and_sort: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      gmail_inbox_summary: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      gmail_list_filters: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      gmail_storage_audit: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      gmail_sync_taxonomy_labels: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      gmail_batch_triage: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      gmail_create_filter: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      gmail_delete_filter: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    };

    for (const tool of tools) {
      const expected = expectedAnnotations[tool.name];
      assert.ok(expected, `Unexpected tool registered: ${tool.name}`);
      assert.ok(tool.annotations, `Tool ${tool.name} is missing annotations object`);
      assert.strictEqual(tool.annotations.readOnlyHint, expected.readOnlyHint, `${tool.name}.readOnlyHint mismatch`);
      assert.strictEqual(tool.annotations.destructiveHint, expected.destructiveHint, `${tool.name}.destructiveHint mismatch`);
      assert.strictEqual(tool.annotations.idempotentHint, expected.idempotentHint, `${tool.name}.idempotentHint mismatch`);
      assert.strictEqual(tool.annotations.openWorldHint, expected.openWorldHint, `${tool.name}.openWorldHint mismatch`);
    }
  });

  const toolCalls: Array<{ name: string; args: Record<string, unknown> }> = [
    { name: 'gmail_search_and_sort', args: { maxResults: 5 } },
    { name: 'gmail_batch_triage', args: { messageIds: ['msg-123'] } },
    { name: 'gmail_sync_taxonomy_labels', args: {} },
    { name: 'gmail_create_filter', args: { from: 'test@example.com' } },
    { name: 'gmail_list_filters', args: {} },
    { name: 'gmail_delete_filter', args: { filterId: 'filter-123' } },
    { name: 'gmail_inbox_summary', args: {} },
    { name: 'gmail_storage_audit', args: { minSizeMb: 10 } },
  ];

  for (const { name, args } of toolCalls) {
    it(`should sanitize errors for ${name} when unauthenticated without leaking paths or crashing`, async () => {
      const resp = await client.request('tools/call', {
        name,
        arguments: args,
      });

      assert.ok(resp.result, `Expected result object on ${name}`);
      const result = resp.result as {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };

      assert.strictEqual(result.isError, true, `Expected isError: true on unauthenticated ${name}`);
      assert.ok(result.content.length > 0);
      const text = result.content[0].text;
      assert.ok(
        text.includes('Error: Missing Google Cloud OAuth Client credentials') ||
          text.includes('Error: Gmail credentials are not authenticated'),
        `Unexpected error text on ${name}: ${text}`
      );
      assert.ok(!text.includes('/home/'), `Leaked absolute path in ${name}: ${text}`);
      assert.ok(!text.includes('C:\\'), `Leaked Windows path in ${name}: ${text}`);
      assert.ok(!text.includes('ya29.'), `Leaked OAuth token in ${name}`);
    });
  }

  it('teardown client cleanly', () => {
    if (client) {
      client.close();
    }
  });
});
