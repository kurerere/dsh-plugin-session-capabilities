import assert from 'node:assert/strict'
import { test } from 'node:test'
import { countMcpInvocations, collectSnapshot } from '../src/host/collect.ts'
import { McpLogTracker } from '../src/host/mcp-log.ts'

const call = name => ({ type: 'tool/call', data: { name } })

test('counts MCP calls by longest matching server namespace, ignoring other events', () => {
  const counts = countMcpInvocations([
    call('mcp__search__query'), call('mcp__search__query'),
    call('mcp__search__team__lookup'), call('mcp__bridge__read'),
    call('skill'), call('mcp__search__'), call(null),
    { type: 'tool/result', data: { name: 'mcp__search__query' } },
    { type: 'tool/call' },
  ], ['search', 'search__team', 'bridge', 'unused'])
  assert.deepEqual([...counts], [['search__team', 1], ['search', 2], ['bridge', 1], ['unused', 0]])
})

test('snapshots retain usage for disconnected servers and isolate sessions', async () => {
  const ctx = {
    registry: { values: () => [{ name: 'mcp-client', fibers: [
      { uid: 1, state: 3, config: { serverName: 'offline' }, ctx: {} },
    ] }] },
    get: name => ({
      sessionQuery: { observeSession: async id => ({
        header: {}, events: id === 'used' ? [call('mcp__offline__old'), call('mcp__bridge__read')] : [],
        [Symbol.dispose]() {},
      }) },
      tools: { schemas: () => [{ name: 'mcp__bridge__read' }] },
    })[name],
  }
  for (const id of ['used', 'unused']) {
    const snapshot = await collectSnapshot(ctx, id, 0, new McpLogTracker(), new AbortController().signal)
    assert.deepEqual(snapshot.mcpServers.map(s => [s.serverName, s.invocations]),
      [['offline', id === 'used' ? 1 : 0], ['bridge', id === 'used' ? 1 : 0]])
  }
})
