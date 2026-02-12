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

## Practical interpretation

If `Submit -> Job Created` is high, investigate create-job API/network/auth path.  
If `Job Created -> Events Connected` is high, investigate events subscription/startup.  
If `First Event -> First Token` is high, investigate model TTFT and backend batching.  
If `Event Envelope -> Client` is high, investigate events transport or client-side connectivity.
If `ModelProxyTTFT` is high, investigate model/provider queueing, prompt size, and upstream routing.  
If `ServerBufferFlushDelay` is high, investigate batch interval/count thresholds.  
If `JobEventsPipelineDelay` is high, investigate event ingestion/stamping path in the JobEvents system.
