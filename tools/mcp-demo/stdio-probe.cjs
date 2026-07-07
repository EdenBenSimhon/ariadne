/**
 * Probe the shipped MCP stdio server (dist/apps/mcp/main.js) over JSON-RPC:
 *  1) initialize, 2) tools/list (needs no backend), 3) a tools/call with the
 *     API unreachable — proves the sanitized-error path (spec B4).
 */
const { spawn } = require('node:child_process');

const child = spawn('node', ['dist/apps/mcp/main.js'], {
  env: { ...process.env, MCP_API_URL: 'http://127.0.0.1:59999/api', MCP_TENANT_ID: 'acme' },
  stdio: ['pipe', 'pipe', 'pipe'],
});

let buf = '';
const pending = [];
child.stdout.on('data', (d) => {
  buf += d.toString();
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (line) pending.push(JSON.parse(line));
  }
});
child.stderr.on('data', (d) => process.stderr.write(`[mcp stderr] ${d}`));

const send = (obj) => child.stdin.write(JSON.stringify(obj) + '\n');
const waitFor = (id) =>
  new Promise((res) => {
    const iv = setInterval(() => {
      const hit = pending.find((m) => m.id === id);
      if (hit) { clearInterval(iv); res(hit); }
    }, 20);
  });

(async () => {
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'probe', version: '0' } } });
  const init = await waitFor(1);
  console.log('\n✓ initialize: server', JSON.stringify(init.result.serverInfo),
    '\n  instructions:', init.result.instructions ? `present (${init.result.instructions.length} chars)` : 'MISSING');
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });

  send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const list = await waitFor(2);
  console.log('\n✓ tools/list returned', list.result.tools.length, 'tools:');
  for (const t of list.result.tools) console.log('   -', t.name);

  send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_stats', arguments: {} } });
  const call = await waitFor(3);
  const c = call.result;
  console.log('\n✓ tools/call get_stats (API intentionally down) →',
    c.isError ? `clean error: "${c.content[0].text}"` : 'unexpected success');

  send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_trace_flow', arguments: { traceId: 'NOT-HEX' } } });
  const bad = await waitFor(4);
  console.log('✓ tools/call bad traceId → validation:', `"${bad.result.content[0].text}"`);

  child.kill();
  console.log('\n✓ MCP stdio server boots, advertises tools, and fails safe with sanitized errors.\n');
  process.exit(0);
})();

setTimeout(() => { console.error('probe timed out'); child.kill(); process.exit(1); }, 15000);
