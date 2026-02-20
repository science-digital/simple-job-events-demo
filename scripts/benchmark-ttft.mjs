#!/usr/bin/env node

/**
 * TTFT Benchmark Script
 *
 * Compares time-to-first-token between IVCAP (Job Events pipeline) and
 * Direct (LiteLLM proxy) chat modes by running N interleaved iterations
 * and collecting detailed latency metrics.
 *
 * Usage:
 *   node scripts/benchmark-ttft.mjs [options]
 *
 * Options:
 *   --iterations, -n   Number of iterations per mode (default: 10)
 *   --prompt            Test prompt text (default: built-in quick test)
 *   --env               Path to .env file (default: client/.env)
 *   --output, -o        Output JSON path (default: scripts/benchmark-results.json)
 *   --no-warmup         Skip warm-up job
 *   --mode              "direct", "ivcap", or "both" (default: both)
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(__dirname, '..')

// ─── CLI argument parsing ────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = argv.slice(2)
  const config = {
    iterations: 10,
    prompt: 'What are the three most important things to consider when designing an event-driven architecture?',
    envPath: resolve(PROJECT_ROOT, 'client/.env'),
    outputPath: resolve(PROJECT_ROOT, 'scripts/benchmark-results.json'),
    warmup: true,
    mode: 'both', // 'direct' | 'ivcap' | 'both'
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if ((arg === '--iterations' || arg === '-n') && args[i + 1]) {
      config.iterations = parseInt(args[++i], 10)
    } else if (arg === '--prompt' && args[i + 1]) {
      config.prompt = args[++i]
    } else if (arg === '--env' && args[i + 1]) {
      config.envPath = resolve(args[++i])
    } else if ((arg === '--output' || arg === '-o') && args[i + 1]) {
      config.outputPath = resolve(args[++i])
    } else if (arg === '--no-warmup') {
      config.warmup = false
    } else if (arg === '--mode' && args[i + 1]) {
      const m = args[++i]
      if (!['direct', 'ivcap', 'both'].includes(m)) {
        console.error(`Invalid --mode: ${m}. Must be direct, ivcap, or both.`)
        process.exit(1)
      }
      config.mode = m
    } else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: node scripts/benchmark-ttft.mjs [options]

Options:
  --iterations, -n   Iterations per mode (default: 10)
  --prompt           Test prompt (default: built-in)
  --env              Path to .env (default: client/.env)
  --output, -o       Output JSON path (default: scripts/benchmark-results.json)
  --no-warmup        Skip warm-up job
  --mode             direct | ivcap | both (default: both)`)
      process.exit(0)
    }
  }

  if (!Number.isFinite(config.iterations) || config.iterations < 1) {
    console.error('--iterations must be a positive integer')
    process.exit(1)
  }

  return config
}

// ─── .env loader ─────────────────────────────────────────────────────────────

function loadEnvFile(envPath) {
  let content
  try {
    content = readFileSync(envPath, 'utf-8')
  } catch {
    console.error(`Cannot read .env file: ${envPath}`)
    process.exit(1)
  }

  const vars = {}
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx < 0) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const value = trimmed.slice(eqIdx + 1).trim()
    vars[key] = value
  }
  return vars
}

// ─── JWT expiry check ────────────────────────────────────────────────────────

function checkTokenExpiry(token) {
  if (!token) {
    console.error('VITE_AUTH_TOKEN is not set. Provide it in your .env file.')
    process.exit(1)
  }

  try {
    const parts = token.split('.')
    if (parts.length !== 3) throw new Error('Not a JWT')
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString())
    const exp = payload.exp
    if (!exp) {
      console.warn('Warning: JWT has no exp claim; skipping expiry check.')
      return
    }

    const expiresAt = new Date(exp * 1000)
    const now = new Date()
    const remainingMs = expiresAt.getTime() - now.getTime()

    if (remainingMs <= 0) {
      console.error(`Auth token EXPIRED at ${expiresAt.toISOString()} (${Math.round(-remainingMs / 60000)} minutes ago).`)
      console.error('Refresh it with: ivcap context get access-token --refresh-token')
      process.exit(1)
    }

    const remainingMin = Math.round(remainingMs / 60000)
    if (remainingMin < 10) {
      console.warn(`Warning: Auth token expires in ${remainingMin} minutes. Consider refreshing.`)
    } else {
      console.log(`Auth token valid for ~${remainingMin} minutes.`)
    }
  } catch (err) {
    if (err.message === 'Not a JWT') {
      console.warn('Warning: VITE_AUTH_TOKEN does not look like a JWT; skipping expiry check.')
    }
  }
}

// ─── Config from env ─────────────────────────────────────────────────────────

let API_URL, AUTH_TOKEN, LITELLM_PROXY, SERVICE_URN, REQUEST_SCHEMA, CHAT_REQUEST_SCHEMA

function initConfig(envVars) {
  API_URL = envVars.VITE_API_URL || 'https://develop.ivcap.net'
  AUTH_TOKEN = envVars.VITE_AUTH_TOKEN || ''
  LITELLM_PROXY = envVars.VITE_LITELLM_PROXY || ''
  SERVICE_URN = envVars.VITE_SERVICE_URN || 'urn:ivcap:service:f82da254-5025-5d94-9186-e76fa45bb7cc'
  REQUEST_SCHEMA = 'urn:sd:schema.workflow-simulator.request.1'
  CHAT_REQUEST_SCHEMA = 'urn:sd:schema.workflow-simulator.chat.request.1'
}

function authHeaders() {
  return {
    'Content-Type': 'application/json',
    ...(AUTH_TOKEN && { Authorization: `Bearer ${AUTH_TOKEN}` }),
  }
}

// ─── Warm-up ─────────────────────────────────────────────────────────────────

async function warmUp() {
  console.log('\nSending warm-up job to prime the service container...')
  const startMs = performance.now()

  const res = await fetch(
    `${API_URL}/1/services2/${encodeURIComponent(SERVICE_URN)}/jobs`,
    {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ $schema: REQUEST_SCHEMA, mode: 'warm' }),
    },
  )

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Warm-up job creation failed: ${res.status} - ${text}`)
  }

  const data = await res.json()
  const jobId = data.id || data['job-id'] || data.job_id
  if (!jobId) throw new Error('Warm-up job response missing job ID')

  console.log(`  Warm-up job created: ${jobId}`)

  const terminal = new Set(['succeeded', 'success', 'complete', 'failed', 'error'])
  const maxPollMs = 120_000
  const pollInterval = 3_000

  while (performance.now() - startMs < maxPollMs) {
    await sleep(pollInterval)

    const jobRes = await fetch(
      `${API_URL}/1/services2/${encodeURIComponent(SERVICE_URN)}/jobs/${encodeURIComponent(jobId)}`,
      { headers: { ...(AUTH_TOKEN && { Authorization: `Bearer ${AUTH_TOKEN}` }) } },
    )
    const jobText = await jobRes.text()
    const job = jobText ? JSON.parse(jobText) : {}
    const status = String(job.status || '').toLowerCase()

    if (terminal.has(status)) {
      const elapsed = ((performance.now() - startMs) / 1000).toFixed(1)
      console.log(`  Warm-up complete (${status}) in ${elapsed}s`)
      return
    }
  }

  console.warn('  Warm-up timed out after 120s; proceeding anyway.')
}

// ─── Direct mode benchmark ──────────────────────────────────────────────────

async function benchmarkDirect(prompt) {
  const submitAt = performance.now()

  const res = await fetch(`${LITELLM_PROXY}/v1/chat/completions`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      model: 'gpt-5-mini',
      messages: [{ role: 'user', content: prompt }],
      stream: true,
    }),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Direct LiteLLM failed: ${res.status} - ${errText}`)
  }

  const responseHeadersMs = performance.now() - submitAt

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let firstTokenMs = null
  let tokenCount = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const parts = buffer.split('\n\n')
      buffer = parts.pop() || ''

      for (const block of parts) {
        for (const line of block.split('\n')) {
          if (!line.startsWith('data:')) continue
          const payload = line.slice(5).trim()
          if (payload === '[DONE]') continue
          try {
            const parsed = JSON.parse(payload)
            const content = parsed.choices?.[0]?.delta?.content
            if (content) {
              tokenCount++
              if (firstTokenMs === null) {
                firstTokenMs = performance.now() - submitAt
              }
            }
          } catch { /* skip unparseable */ }
        }
      }
    }
  } finally {
    reader.releaseLock()
  }

  // Process any remaining buffer
  if (buffer.trim()) {
    for (const line of buffer.split('\n')) {
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (payload === '[DONE]') continue
      try {
        const parsed = JSON.parse(payload)
        const content = parsed.choices?.[0]?.delta?.content
        if (content) {
          tokenCount++
          if (firstTokenMs === null) {
            firstTokenMs = performance.now() - submitAt
          }
        }
      } catch { /* skip */ }
    }
  }

  const totalMs = performance.now() - submitAt
  const streamDurationMs = firstTokenMs != null ? totalMs - firstTokenMs : null
  const tokensPerSecond = streamDurationMs && streamDurationMs > 0 && tokenCount > 1
    ? ((tokenCount - 1) / streamDurationMs) * 1000
    : null

  return {
    mode: 'direct',
    submitToFirstTokenMs: firstTokenMs,
    submitToCompleteMs: totalMs,
    submitToResponseHeadersMs: responseHeadersMs,
    tokenCount,
    tokensPerSecond,
    error: null,
  }
}

// ─── IVCAP mode benchmark ───────────────────────────────────────────────────

const LATENCY_META_PREFIX = '__latency_meta__:'

function parseLatencyMeta(rawMessage) {
  const msg = (rawMessage || '').trim()
  if (!msg) return { message: '' }

  if (msg.startsWith(LATENCY_META_PREFIX)) {
    const jsonPart = msg.slice(LATENCY_META_PREFIX.length).trim()
    try {
      const parsed = JSON.parse(jsonPart)
      return { message: typeof parsed.label === 'string' ? parsed.label : '', latencyMeta: parsed }
    } catch {
      return { message: msg }
    }
  }

  return { message: rawMessage }
}

function isChatTokenEvent(stepId) {
  return stepId.startsWith('chat:token:') || stepId.startsWith('chat:tokens:')
}

function parseIvcapEnvelope(envelope) {
  const ivcapType = envelope.type
  const schema = (envelope.schema) || ''
  const timestamp = new Date(envelope.timestamp || Date.now())

  if (ivcapType === 'ivcap.job.event') {
    const inner = envelope.data
    if (!inner) return null
    const stepId = inner.name || 'unknown'
    const options = inner.options
    const rawMessage = options?.message || ''
    const finished = schema.includes('step.finish')
    const parsed = parseLatencyMeta(rawMessage)

    return {
      stepId,
      message: parsed.message || (finished ? 'completed' : 'started'),
      finished,
      timestamp,
      latencyMeta: parsed.latencyMeta,
    }
  }

  if (ivcapType === 'ivcap.job.status') {
    const inner = envelope.data
    const status = inner?.status || 'unknown'
    return { stepId: 'job:status', message: `Job status: ${status}`, finished: true, status }
  }

  if (ivcapType === 'ivcap.job.result') {
    return { stepId: 'job:result', message: 'Result available', finished: true }
  }

  // Flat fallback
  const stepId = envelope.step_id || envelope.stepId || 'unknown'
  const parsed = parseLatencyMeta(envelope.message || '')
  return { stepId, message: parsed.message, finished: !!envelope.finished, latencyMeta: parsed.latencyMeta }
}

async function pollJobStatus(jobId) {
  const url = `${API_URL}/1/services2/${encodeURIComponent(SERVICE_URN)}/jobs/${encodeURIComponent(jobId)}`
  const res = await fetch(url, {
    headers: { ...(AUTH_TOKEN && { Authorization: `Bearer ${AUTH_TOKEN}` }) },
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Job read failed: ${res.status} - ${text}`)
  const data = text ? JSON.parse(text) : {}
  return String(data.status || 'unknown').toLowerCase()
}

async function benchmarkIvcap(prompt) {
  const submitAt = performance.now()

  // 1. Create chat job
  const jobRes = await fetch(
    `${API_URL}/1/services2/${encodeURIComponent(SERVICE_URN)}/jobs`,
    {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        $schema: CHAT_REQUEST_SCHEMA,
        messages: [{ role: 'user', content: prompt }],
      }),
    },
  )

  if (!jobRes.ok) {
    const errText = await jobRes.text()
    throw new Error(`IVCAP job creation failed: ${jobRes.status} - ${errText}`)
  }

  const jobData = await jobRes.json()
  const jobId = jobData.id || jobData['job-id'] || jobData.job_id
  if (!jobId) throw new Error('IVCAP job response missing job ID')

  const jobCreatedMs = performance.now() - submitAt

  // 2. Long-poll events via SSE + parallel job status polling
  const eventsBase = `${API_URL}/1/services2/${encodeURIComponent(SERVICE_URN)}/jobs/${encodeURIComponent(jobId)}/events`

  let lastSeqId = null
  let firstEventMs = null
  let eventsConnectedMs = null
  let firstTokenMs = null
  let tokenCount = 0
  let sawTerminal = false

  // Server-side latency markers
  let requestDispatchMs = null
  let firstUpstreamDeltaMs = null
  let firstBatchEmitMs = null

  const maxPollMs = 180_000
  const TERMINAL_STATUSES = new Set(['succeeded', 'success', 'complete', 'failed', 'error'])

  // Start a background job-status poller (like the React app does every 750ms)
  const statusPollInterval = setInterval(async () => {
    try {
      const status = await pollJobStatus(jobId)
      if (TERMINAL_STATUSES.has(status)) {
        sawTerminal = true
      }
    } catch { /* non-fatal; event stream is primary */ }
  }, 1500)

  try {
    while (!sawTerminal && (performance.now() - submitAt) < maxPollMs) {
      const url = new URL(eventsBase)
      url.searchParams.set('max-messages', '100')
      url.searchParams.set('max-wait-time', '20')

      const reqHeaders = {
        Accept: 'text/event-stream',
        ...(AUTH_TOKEN && { Authorization: `Bearer ${AUTH_TOKEN}` }),
      }
      if (lastSeqId) reqHeaders['Last-Event-ID'] = lastSeqId

      let evtRes
      try {
        evtRes = await fetch(url.toString(), {
          headers: reqHeaders,
          signal: AbortSignal.timeout(35_000),
        })
      } catch (err) {
        if (err.name === 'TimeoutError' || err.name === 'AbortError') continue
        throw err
      }

      if (evtRes.status === 204) {
        if (eventsConnectedMs === null) eventsConnectedMs = performance.now() - submitAt
        continue
      }

      if (!evtRes.ok) {
        const text = await evtRes.text()
        throw new Error(`Events fetch failed: ${evtRes.status} - ${text}`)
      }

      if (eventsConnectedMs === null) eventsConnectedMs = performance.now() - submitAt

      const reader = evtRes.body?.getReader()
      if (!reader) {
        const text = await evtRes.text()
        processEventText(text)
        continue
      }

      const decoder = new TextDecoder()
      let buffer = ''

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const blocks = buffer.split('\n\n')
          buffer = blocks.pop() || ''

          for (const block of blocks) {
            processEventBlock(block)
          }
        }

        if (buffer.trim()) {
          processEventBlock(buffer)
        }
      } catch (streamErr) {
        // Stream may be terminated between long-poll cycles; not fatal
        if (buffer.trim()) {
          processEventBlock(buffer)
        }
      } finally {
        try { reader.releaseLock() } catch { /* already released */ }
      }
    }
  } finally {
    clearInterval(statusPollInterval)
  }

  function processEventText(text) {
    for (const block of text.split('\n\n')) {
      processEventBlock(block)
    }
  }

  function processEventBlock(block) {
    if (!block.trim()) return

    const dataLines = []
    for (const line of block.split('\n')) {
      if (line.startsWith('id:')) {
        const sseId = line.slice(3).trim()
        if (sseId) lastSeqId = sseId
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart())
      }
    }

    if (dataLines.length === 0) return
    const joined = dataLines.join('\n')

    let parsed
    try {
      parsed = JSON.parse(joined)
    } catch {
      return
    }

    const seqId = parsed.SeqID
    if (seqId) lastSeqId = seqId

    const now = performance.now()

    if (firstEventMs === null) {
      firstEventMs = now - submitAt
    }

    const event = parseIvcapEnvelope(parsed)
    if (!event) return

    // Detect terminal job status from event stream
    if (event.stepId === 'job:status' && event.status) {
      const s = String(event.status).toLowerCase()
      if (TERMINAL_STATUSES.has(s)) {
        sawTerminal = true
      }
    }

    // Server-side latency markers
    if (event.stepId === 'chat:latency:request-dispatch' && requestDispatchMs === null) {
      const ts = Number(event.latencyMeta?.server_emit_ts_ms)
      if (Number.isFinite(ts) && ts > 0) requestDispatchMs = ts
    }
    if (event.stepId === 'chat:latency:first-upstream-delta' && firstUpstreamDeltaMs === null) {
      const ts = Number(event.latencyMeta?.server_emit_ts_ms)
      if (Number.isFinite(ts) && ts > 0) firstUpstreamDeltaMs = ts
    }
    if (event.stepId === 'chat:latency:first-batch' && firstBatchEmitMs === null) {
      const ts = Number(event.latencyMeta?.server_emit_ts_ms)
      if (Number.isFinite(ts) && ts > 0) firstBatchEmitMs = ts
    }

    // Chat token detection
    if (isChatTokenEvent(event.stepId) && !event.finished) {
      const rawMsg = event.message
      if (rawMsg) {
        tokenCount++
        if (firstTokenMs === null) {
          firstTokenMs = now - submitAt
        }
      }
    }
  }

  const totalMs = performance.now() - submitAt
  const streamDurationMs = firstTokenMs != null ? totalMs - firstTokenMs : null
  const tokensPerSecond = streamDurationMs && streamDurationMs > 0 && tokenCount > 1
    ? ((tokenCount - 1) / streamDurationMs) * 1000
    : null

  // Server-side derived metrics (these are absolute epoch ms; compute deltas)
  let modelProxyTtftMs = null
  if (requestDispatchMs != null && firstUpstreamDeltaMs != null) {
    modelProxyTtftMs = firstUpstreamDeltaMs - requestDispatchMs
  }
  let serverBufferFlushDelayMs = null
  if (firstUpstreamDeltaMs != null && firstBatchEmitMs != null) {
    serverBufferFlushDelayMs = firstBatchEmitMs - firstUpstreamDeltaMs
  }

  return {
    mode: 'ivcap',
    jobId,
    submitToFirstTokenMs: firstTokenMs,
    submitToCompleteMs: totalMs,
    submitToJobCreatedMs: jobCreatedMs,
    submitToFirstEventMs: firstEventMs,
    submitToEventsConnectedMs: eventsConnectedMs,
    tokenCount,
    tokensPerSecond,
    modelProxyTtftMs,
    serverBufferFlushDelayMs,
    error: null,
  }
}

// ─── Statistics ──────────────────────────────────────────────────────────────

function computeStats(values) {
  const valid = values.filter(v => v != null && Number.isFinite(v))
  if (valid.length === 0) return { count: 0, mean: null, median: null, min: null, max: null, p95: null }

  const sorted = [...valid].sort((a, b) => a - b)
  const sum = sorted.reduce((a, b) => a + b, 0)
  const mean = sum / sorted.length
  const mid = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
  const p95Idx = Math.min(Math.ceil(sorted.length * 0.95) - 1, sorted.length - 1)

  return {
    count: sorted.length,
    mean: Math.round(mean),
    median: Math.round(median),
    min: Math.round(sorted[0]),
    max: Math.round(sorted[sorted.length - 1]),
    p95: Math.round(sorted[p95Idx]),
  }
}

function fmtMs(ms) {
  if (ms == null) return '-'
  return `${(ms / 1000).toFixed(2)}s`
}

function printSummaryTable(label, results, metricKey) {
  const values = results.map(r => r[metricKey])
  const stats = computeStats(values)

  console.log(`\n  ${label}`)
  console.log(`  ${'─'.repeat(60)}`)
  if (stats.count === 0) {
    console.log('  No data')
    return stats
  }
  console.log(`  Mean:   ${fmtMs(stats.mean).padStart(8)}    Min: ${fmtMs(stats.min).padStart(8)}`)
  console.log(`  Median: ${fmtMs(stats.median).padStart(8)}    Max: ${fmtMs(stats.max).padStart(8)}`)
  console.log(`  P95:    ${fmtMs(stats.p95).padStart(8)}    N:   ${String(stats.count).padStart(8)}`)
  return stats
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const config = parseArgs(process.argv)

  console.log('TTFT Benchmark')
  console.log('═'.repeat(60))
  console.log(`  Iterations:  ${config.iterations} per mode`)
  console.log(`  Mode:        ${config.mode}`)
  console.log(`  Warm-up:     ${config.warmup ? 'yes' : 'skip'}`)
  console.log(`  Prompt:      "${config.prompt.slice(0, 60)}${config.prompt.length > 60 ? '...' : ''}"`)
  console.log(`  Env file:    ${config.envPath}`)
  console.log(`  Output:      ${config.outputPath}`)

  // Load environment
  const envVars = loadEnvFile(config.envPath)
  initConfig(envVars)

  console.log(`\n  API URL:     ${API_URL}`)
  console.log(`  LiteLLM:     ${LITELLM_PROXY || '(not set)'}`)
  console.log(`  Service:     ${SERVICE_URN}`)

  // Validate configuration
  if ((config.mode === 'direct' || config.mode === 'both') && !LITELLM_PROXY) {
    console.error('\nError: VITE_LITELLM_PROXY must be set for direct mode.')
    process.exit(1)
  }

  checkTokenExpiry(AUTH_TOKEN)

  // Warm-up
  if (config.warmup && (config.mode === 'ivcap' || config.mode === 'both')) {
    try {
      await warmUp()
    } catch (err) {
      console.warn(`  Warm-up failed: ${err.message}`)
      console.warn('  Proceeding with benchmark anyway.')
    }
  }

  // Run benchmark
  const directResults = []
  const ivcapResults = []
  const runDirect = config.mode === 'direct' || config.mode === 'both'
  const runIvcap = config.mode === 'ivcap' || config.mode === 'both'

  console.log('\n' + '═'.repeat(60))
  console.log('Starting benchmark...\n')

  for (let i = 0; i < config.iterations; i++) {
    const iterLabel = `[${i + 1}/${config.iterations}]`

    // Interleave: direct first, then ivcap on each iteration
    if (runDirect) {
      try {
        const result = await benchmarkDirect(config.prompt)
        directResults.push(result)
        console.log(
          `${iterLabel} Direct  : TTFT=${fmtMs(result.submitToFirstTokenMs)}  total=${fmtMs(result.submitToCompleteMs)}  tokens=${result.tokenCount}  tok/s=${result.tokensPerSecond ? result.tokensPerSecond.toFixed(1) : '-'}`,
        )
      } catch (err) {
        console.error(`${iterLabel} Direct  : ERROR - ${err.message}`)
        directResults.push({ mode: 'direct', error: err.message, submitToFirstTokenMs: null, submitToCompleteMs: null, tokenCount: 0, tokensPerSecond: null })
      }
    }

    if (runIvcap) {
      try {
        const result = await benchmarkIvcap(config.prompt)
        ivcapResults.push(result)
        console.log(
          `${iterLabel} IVCAP   : TTFT=${fmtMs(result.submitToFirstTokenMs)}  total=${fmtMs(result.submitToCompleteMs)}  tokens=${result.tokenCount}  jobCreate=${fmtMs(result.submitToJobCreatedMs)}`,
        )
      } catch (err) {
        console.error(`${iterLabel} IVCAP   : ERROR - ${err.message}`)
        ivcapResults.push({ mode: 'ivcap', error: err.message, submitToFirstTokenMs: null, submitToCompleteMs: null, tokenCount: 0, tokensPerSecond: null })
      }
    }

    // Brief pause between iterations to avoid hammering
    if (i < config.iterations - 1) {
      await sleep(1000)
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────

  console.log('\n' + '═'.repeat(60))
  console.log('RESULTS SUMMARY')
  console.log('═'.repeat(60))

  const summaryStats = {}

  if (runDirect && directResults.length > 0) {
    summaryStats.direct = {
      ttft: printSummaryTable('Direct -- Time to First Token', directResults, 'submitToFirstTokenMs'),
      total: printSummaryTable('Direct -- Total Time', directResults, 'submitToCompleteMs'),
      headers: printSummaryTable('Direct -- Time to Response Headers', directResults, 'submitToResponseHeadersMs'),
    }

    const avgTps = directResults
      .map(r => r.tokensPerSecond)
      .filter(v => v != null)
    if (avgTps.length > 0) {
      const mean = avgTps.reduce((a, b) => a + b, 0) / avgTps.length
      console.log(`\n  Direct -- Avg tokens/sec: ${mean.toFixed(1)}`)
    }
  }

  if (runIvcap && ivcapResults.length > 0) {
    summaryStats.ivcap = {
      ttft: printSummaryTable('IVCAP -- Time to First Token', ivcapResults, 'submitToFirstTokenMs'),
      total: printSummaryTable('IVCAP -- Total Time', ivcapResults, 'submitToCompleteMs'),
      jobCreate: printSummaryTable('IVCAP -- Submit to Job Created', ivcapResults, 'submitToJobCreatedMs'),
      firstEvent: printSummaryTable('IVCAP -- Submit to First Event', ivcapResults, 'submitToFirstEventMs'),
      eventsConnected: printSummaryTable('IVCAP -- Submit to Events Connected', ivcapResults, 'submitToEventsConnectedMs'),
    }

    const hasServerMetrics = ivcapResults.some(r => r.modelProxyTtftMs != null)
    if (hasServerMetrics) {
      summaryStats.ivcap.modelProxyTtft = printSummaryTable('IVCAP -- Server-side Model Proxy TTFT', ivcapResults, 'modelProxyTtftMs')
      summaryStats.ivcap.serverBufferFlush = printSummaryTable('IVCAP -- Server Buffer Flush Delay', ivcapResults, 'serverBufferFlushDelayMs')
    }

    const avgTps = ivcapResults
      .map(r => r.tokensPerSecond)
      .filter(v => v != null)
    if (avgTps.length > 0) {
      const mean = avgTps.reduce((a, b) => a + b, 0) / avgTps.length
      console.log(`\n  IVCAP -- Avg tokens/sec: ${mean.toFixed(1)}`)
    }
  }

  // Overhead comparison
  if (runDirect && runIvcap) {
    const directTtfts = directResults.map(r => r.submitToFirstTokenMs).filter(v => v != null)
    const ivcapTtfts = ivcapResults.map(r => r.submitToFirstTokenMs).filter(v => v != null)

    if (directTtfts.length > 0 && ivcapTtfts.length > 0) {
      const directAvg = directTtfts.reduce((a, b) => a + b, 0) / directTtfts.length
      const ivcapAvg = ivcapTtfts.reduce((a, b) => a + b, 0) / ivcapTtfts.length
      const overhead = ivcapAvg - directAvg
      const pct = ((overhead / directAvg) * 100).toFixed(0)

      console.log('\n' + '═'.repeat(60))
      console.log('OVERHEAD ANALYSIS')
      console.log('═'.repeat(60))
      console.log(`  Direct avg TTFT:   ${fmtMs(directAvg)}`)
      console.log(`  IVCAP  avg TTFT:   ${fmtMs(ivcapAvg)}`)
      console.log(`  Overhead:          ${fmtMs(overhead)} (${overhead > 0 ? '+' : ''}${pct}%)`)
    }
  }

  // Write JSON output
  const output = {
    timestamp: new Date().toISOString(),
    config: {
      iterations: config.iterations,
      prompt: config.prompt,
      mode: config.mode,
      warmup: config.warmup,
      apiUrl: API_URL,
      litellmProxy: LITELLM_PROXY,
      serviceUrn: SERVICE_URN,
    },
    results: {
      direct: directResults,
      ivcap: ivcapResults,
    },
    summary: summaryStats,
  }

  writeFileSync(config.outputPath, JSON.stringify(output, null, 2))
  console.log(`\nResults written to: ${config.outputPath}`)
}

main().catch(err => {
  console.error(`\nFatal error: ${err.message}`)
  if (err.cause) console.error('Cause:', err.cause)
  process.exit(1)
})
