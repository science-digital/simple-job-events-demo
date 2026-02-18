# Latency Summary — Log Example 2

**Job:** `urn:ivcap:job:d94455c0-252f-4c67-94a4-b155687dd197`
**Status:** Success | **Total time:** ~61 seconds | **Token batches:** 30

## Where the time goes

| Phase | Time | Plain-English explanation |
|---|---|---|
| Job setup | ~1.4 s | Server accepts the request and creates the job. |
| Event-stream connection | ~0.9 s | Opens the real-time channel between client and server. |
| AI model thinking (TTFT) | ~16.3 s | Upstream model "thinks" before producing the first word. |
| Server buffering | ~1.3 s | Server batches tokens before flushing them to the event pipeline. |
| Event pipeline transit | ~1.8 s | Token travels through the job-events pipeline to the client. |
| Token streaming | ~41 s | All 30 token batches stream back to the client. |

## Key takeaways

1. **The AI model is the bottleneck.** ~16 s of "thinking time" before the first word appears — this is the model's own latency, not the platform's.
2. **Platform overhead is small.** Job creation, event-stream setup, and pipeline transit together add only ~4 s.
3. **Once streaming starts, delivery is near-instant.** Server-emit to client-receive is under 2 ms for most events.
4. **The ~41 s streaming phase** is just the model generating a long response — nothing the platform can speed up.

**Bottom line:** the system adds roughly **3–4 seconds** of its own overhead; everything else is the AI model thinking and producing its answer.
