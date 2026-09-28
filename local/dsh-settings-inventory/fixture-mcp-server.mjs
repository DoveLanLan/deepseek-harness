#!/usr/bin/env node
/**
 * Minimal MCP server over stdio for verifying the MCP inventory page: answers
 * `initialize` and `tools/list` with two tools, then idles. Development-only.
 */
import { createInterface } from 'node:readline'

const tools = [
  { name: 'echo', description: 'Echo the input back.', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } },
  { name: 'now', description: 'Return the current time.', inputSchema: { type: 'object', properties: {} } },
]

const lines = createInterface({ input: process.stdin })
lines.on('line', (line) => {
  if (line.trim() === '') return
  let message
  try { message = JSON.parse(line) } catch { return }
  if (message.id === undefined) return
  const reply = (result) => {
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n`)
  }
  switch (message.method) {
    case 'initialize':
      reply({
        protocolVersion: message.params?.protocolVersion ?? '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'inventory-fixture', version: '1.0.0' },
        instructions: 'Fixture server used to verify the MCP inventory page.',
      })
      break
    case 'tools/list':
      reply({ tools })
      break
    case 'ping':
      reply({})
      break
    default:
      process.stdout.write(`${JSON.stringify({
        jsonrpc: '2.0', id: message.id,
        error: { code: -32601, message: `method not found: ${String(message.method)}` },
      })}\n`)
  }
})
