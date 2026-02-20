# Latency Metrics (Plain Language)

This document explains the chat latency metrics shown in the client, in simple terms.

## Why there are multiple metrics

"Latency" is not one thing. A user-visible delay is a sum of different steps:

- client-side request setup
- Jobs API network and scheduling
- model first-token generation
- JobEvents transport and delivery
- client rendering

Breaking latency into segments helps identify where delays are actually happening.

## Timestamp sources

Metrics in this demo use three timestamp sources:

- **Client clock**: local browser times (for example when submit is clicked and event callback fires).
- **Event envelope timestamp**: server-side timestamp from the IVCAP event envelope.
- **Backend marker timestamp**: explicit marker emitted by backend code right around `job_context.report.step`.

Some metrics compare timestamps from different clocks. Small skew is possible.

## Diagnostic phase markers

These backend marker timestamps are emitted as dedicated `chat:latency:*` events:

- `chat:latency:request-dispatch`
- `chat:latency:upstream-accepted`
- `chat:latency:first-upstream-delta`
- `chat:latency:first-batch`

They let the client split model/proxy delay from buffering and JobEvents pipeline delay.

## First-batch tuning (UX)

To improve perceived responsiveness, batching uses a two-phase strategy:

- **First batch**: aggressive flush (`100ms` or `3` chunks)
- **Later batches**: normal flush (`300ms` or `20` chunks)

This is designed to reduce time-to-first-token while keeping steady-state event volume manageable.

## High-level metrics

- **Submit -> Executing**  
  Time from user submit to when job status first appears as running/executing in the client.

- **Submit -> First Event**  
  Time from user submit until the first job event reaches the client callback.

- **Submit -> First Token**  
  Time from user submit until first token text is received by the client.

- **Submit -> Complete**  
  Time from submit until terminal job state.

## Request and connection metrics

- **Submit -> Job Created**  
  Client submit to create-job API response with job ID.

- **Job Created -> Events Subscribe**  
  Internal client delay between having a job ID and opening events subscription.

- **Job Created -> Events Connected**  
  Time from job ID to first successful events API connection/response.

## JobEvents transport metrics

These specifically target the JobEvents path:

- **Emit -> Event Envelope**  
  Backend marker timestamp to event envelope timestamp.  
  Roughly indicates delay from backend emission to platform event stamping.

- **Event Envelope -> Client**  
  Event envelope timestamp to client receive timestamp.  
  Includes network and events API delivery behavior.

- **Emit -> Client**  
  End-to-end JobEvents pipeline latency from backend emit marker to client callback.

## Model and stream transition metric

- **First Event -> First Token**  
  Time from first event arrival to first token event arrival.  
  This usually includes model first-token delay and batching effects.

## Targeted bottleneck metrics

- **ModelProxyTTFT**  
  `first_upstream_delta - request_dispatch`  
  Proxy for model/proxy first-token latency.

- **ServerBufferFlushDelay**  
  `first_batch_emit - first_upstream_delta`  
  Time spent accumulating/buffering before first token batch is emitted.
  This should improve when first-batch tuning is active.

- **JobEventsPipelineDelay**  
  `first_token_event_envelope - first_batch_emit`  
  Delay through JobEvents emission/stamping path before envelope timestamp appears.

## Likely bottleneck heuristic

The debug panel and diagnostic log include a single-run heuristic:

- choose the largest available targeted bottleneck delta among:
  - ModelProxyTTFT
  - ServerBufferFlushDelay
  - JobEventsPipelineDelay

This is a fast indicator, not a statistical conclusion. Validate across multiple runs.

## AI Diagnostic Log output

The chat debug panel emits a copyable log that includes:

- run metadata (`status`, `job_id`, connection state, token-event count)
- key timestamps (client, envelope, marker phases)
- latency breakdown values with source hints
- likely bottleneck summary fields
- recent event lines with sequence IDs and marker metadata when present

## What is included vs excluded

- **Included**:
  - client polling/subscription behavior
  - event batching in backend
  - Jobs API and events API transport
  - browser receive and parse timing

- **Not fully isolated by these metrics**:
  - exact provider-side queueing vs model compute split
  - absolute cross-machine clock sync accuracy

## Caveats

- **Clock skew**: comparing backend and client timestamps can introduce small errors.
- **Batching**: first token generation may happen before first token event is flushed.
- **Retries/backoff**: transient errors can increase connection-related metrics.
- **Polling artifacts**: executing status timing depends on client poll interval.

## Direct LiteLLM mode

The chat page includes a "Direct LiteLLM" mode that calls the LiteLLM proxy
directly from the browser, bypassing the IVCAP Jobs pipeline entirely. This
provides a baseline for isolating how much latency the IVCAP pipeline adds
versus the model/proxy itself.

### How it works

```
Browser  ──POST /v1/chat/completions (stream:true)──>  LiteLLM Proxy  ──>  Model
Browser  <──────────── OpenAI SSE stream ────────────  LiteLLM Proxy  <──  Model
```

1. User sends a message (or clicks an example prompt).
2. Client sends `POST {VITE_LITELLM_PROXY}/v1/chat/completions` with
   `stream: true` and `Authorization: Bearer {VITE_AUTH_TOKEN}`.
3. LiteLLM proxies the request to the upstream model provider.
4. The model streams back OpenAI-format SSE chunks:
   `data: {"choices":[{"delta":{"content":"Hello"}}]}`
5. Client reads the response body incrementally via `ReadableStream`,
   parses each SSE block, and feeds content deltas into the typewriter
   animation (same adaptive algorithm as IVCAP mode).
6. Stream ends with `data: [DONE]`.

In development, requests are routed through a Vite dev-server proxy
(`/litellm-direct -> VITE_LITELLM_PROXY`) to avoid CORS. In production,
the browser calls the proxy URL directly.

### Direct mode metrics

All timestamps are client-clock only (no server-side markers or envelope
timestamps needed).

- **Submit -> Response Headers**  
  Time from pressing Send until the HTTP response headers arrive from the proxy.
  This captures network round-trip and any proxy-level queuing before the SSE
  stream starts.

- **Submit -> First Token**  
  Time from pressing Send until the first SSE chunk with content is parsed.
  In direct mode this is effectively model TTFT plus browser-to-proxy network
  latency.

- **Submit -> Complete**  
  Total round-trip from pressing Send until the SSE stream ends (`data: [DONE]`).

- **First Token -> Complete**  
  Streaming duration: how long the model takes to produce the full response
  after the first token.

- **Tokens / Throughput**  
  Number of SSE chunks containing content, and tokens-per-second over the
  streaming window.

### Is "First Token" measuring the same thing in both modes?

Both modes record `firstTokenAt = new Date()` at the moment the client first
sees text content. So both answer the UX question: "how long does the user
wait before seeing the first word?" But the underlying triggers differ:

| | IVCAP mode | Direct mode |
|---|---|---|
| Trigger | First `chat:tokens:*` JobEvent with non-empty text | First OpenAI SSE chunk where `choices[0].delta.content` is truthy |
| Granularity | **Batched** group of tokens (server buffers ~100 ms or 3 chunks before flushing the first batch) | **Individual** SSE delta chunk from the model |
| Includes batching delay | Yes (first-batch buffer adds ~100 ms+) | No |
| Includes IVCAP pipeline | Yes (job creation, scheduling, container startup, JobEvents delivery) | No |

**Implication:** Direct "Submit -> First Token" is a tighter lower bound on
raw model TTFT. The IVCAP version adds batching delay and pipeline overhead
on top of the same model latency.

For the closest apples-to-apples comparison within IVCAP mode, use the
backend marker `ModelProxyTTFT` (`first_upstream_delta − request_dispatch`),
which measures the same thing the Direct path measures -- but from the
server container's perspective rather than the browser.

### Comparing IVCAP vs Direct

Run the **same prompt** through both modes and compare **Submit -> First Token**:

| Scenario | What it tells you |
|---|---|
| Direct TTFT ~1 s, IVCAP TTFT ~12 s | IVCAP pipeline adds ~11 s (scheduling, container startup, batching, event delivery) |
| Direct TTFT ~10 s, IVCAP TTFT ~14 s | Model itself is slow (~10 s); IVCAP only adds ~4 s overhead |
| Direct TTFT ~10 s, IVCAP TTFT ~12 s | Model is the bottleneck; IVCAP overhead is small |

The direct mode **Submit -> First Token** gives you the floor for what the
IVCAP path can theoretically achieve. Any delta above that is IVCAP pipeline
overhead.

### Direct mode diagnostic log

The debug panel diagnostic log in direct mode includes:

- run status and mode indicator
- token count
- key timestamps (submitted, response headers, first token, finished)
- latency breakdown with all values in milliseconds
- tokens-per-second throughput
- recent SSE chunk listing with receive timestamps

## Practical interpretation

If `Submit -> Job Created` is high, investigate create-job API/network/auth path.  
If `Job Created -> Events Connected` is high, investigate events subscription/startup.  
If `First Event -> First Token` is high, investigate model TTFT and backend batching.  
If `Event Envelope -> Client` is high, investigate events transport or client-side connectivity.
If `ModelProxyTTFT` is high, investigate model/provider queueing, prompt size, and upstream routing.  
If `ServerBufferFlushDelay` is high, investigate batch interval/count thresholds.  
If `JobEventsPipelineDelay` is high, investigate event ingestion/stamping path in the JobEvents system.
