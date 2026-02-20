# Time to First Token Stats (TTFT)

Comparing time to first token between IVCAP and direct mode gives a high-level view of the latency added by the IVCAP pipeline.

- **Prompt:** "What are the three most important things to consider when designing an event-driven architecture?"
- **Iterations:** 10 per mode, interleaved (direct then ivcap each round)
- **Date:** 2026-02-19
- **Warm-up:** yes (one warm-up job before the benchmark to avoid cold-start skew)
- **Server config:** `FIRST_BATCH_FLUSH_MAX_TOKENS = 3` (flush the first batch after 3 tokens), `BATCH_FLUSH_MAX_TOKENS = 20`
- **Script:** [`scripts/benchmark-ttft.mjs`](../scripts/benchmark-ttft.mjs) -- standalone Node.js benchmark runner, run with `node scripts/benchmark-ttft.mjs -n 10 --mode both`

## Comparison

| Metric                      | Direct | IVCAP | Difference   |
| --------------------------- | ------ | ----- | ------------ |
| **Avg time to first token** | 8.5s   | 14.3s | +5.8s (+68%) |
| Median TTFT                 | 8.1s   | 14.5s | +6.4s        |
| Min TTFT                    | 5.6s   | 12.7s |              |
| Max TTFT                    | 12.4s  | 16.2s |              |
| Avg total response time     | 16.3s  | 47.3s | +31.0s       |
| Avg tokens/sec              | 70.9   | 0.8   |              |

### Where does the IVCAP overhead come from?

The IVCAP pipeline adds ~5.8s of overhead on average to the first token. Breaking it down:

| Stage                                         | Avg time  |
| --------------------------------------------- | --------- |
| Job creation (HTTP round-trip)                | 1.5s      |
| Events subscription connect                   | 0.6s      |
| Model proxy TTFT (server-side, same LLM call) | 10.9s     |
| Server buffer flush delay                     | 1.1s      |
| **Client-observed TTFT**                      | **14.3s** |

Most of the time (~10.9s) is the model itself thinking -- the same LLM call that takes ~8.5s via direct mode takes ~10.9s when measured server-side through the IVCAP proxy. The remaining pipeline overhead (job creation + event routing + buffer flush) adds ~3.2s.

The large difference in tokens/sec (70.9 vs 0.8) is because IVCAP batches tokens into job events rather than streaming them individually -- the LLM is still generating at the same speed, but the client sees fewer, larger chunks.

## Conclusion

The IVCAP Job Events pipeline adds roughly **5-6 seconds** to time-to-first-token compared to calling LiteLLM directly. About 60% of that overhead comes from the model proxy path being slightly slower, and 40% from the job creation and event delivery infrastructure (~3s). Total response time is ~3x longer due to event batching rather than true per-token streaming.

## Log

```bash
FIRST_BATCH_FLUSH_MAX_TOKENS = 3 # first batch: flush when 3 chunks accumulated
BATCH_FLUSH_MAX_TOKENS = 0       # normal batches: never flush


simple-job-events-demo % node scripts/benchmark-ttft.mjs \
  -n 10 \
  --mode both \
  --env client/.env \
  -o scripts/benchmark-results.json
TTFT Benchmark
════════════════════════════════════════════════════════════
  Iterations:  10 per mode
  Mode:        both
  Warm-up:     yes
  Prompt:      "What are the three most important things to consider when de..."
  Env file:    /Users/wil9cr/git/simple-job-events-demo/client/.env
  Output:      /Users/wil9cr/git/simple-job-events-demo/scripts/benchmark-results.json

  API URL:     https://develop.ivcap.net
  LiteLLM:     https://mindweaver.develop.ivcap.io/litellm
  Service:     urn:ivcap:service:f82da254-5025-5d94-9186-e76fa45bb7cc
Auth token valid for ~275 minutes.

Sending warm-up job to prime the service container...
  Warm-up job created: urn:ivcap:job:e46e0e39-1b78-4123-992b-e77fe9ef549f
  Warm-up complete (succeeded) in 5.1s

════════════════════════════════════════════════════════════
Starting benchmark...

[1/10] Direct  : TTFT=9.75s  total=18.48s  tokens=594  tok/s=67.9
[1/10] IVCAP   : TTFT=12.73s  total=46.13s  tokens=30  jobCreate=1.44s
[2/10] Direct  : TTFT=11.12s  total=20.31s  tokens=586  tok/s=63.7
[2/10] IVCAP   : TTFT=13.09s  total=53.12s  tokens=36  jobCreate=1.45s
[3/10] Direct  : TTFT=8.85s  total=17.24s  tokens=675  tok/s=80.3
[3/10] IVCAP   : TTFT=13.16s  total=51.23s  tokens=34  jobCreate=1.54s
[4/10] Direct  : TTFT=7.65s  total=14.57s  tokens=491  tok/s=70.8
[4/10] IVCAP   : TTFT=14.03s  total=44.30s  tokens=26  jobCreate=1.44s
[5/10] Direct  : TTFT=5.58s  total=10.65s  tokens=428  tok/s=84.2
[5/10] IVCAP   : TTFT=15.52s  total=40.30s  tokens=21  jobCreate=1.44s
[6/10] Direct  : TTFT=7.47s  total=18.70s  tokens=686  tok/s=61.0
[6/10] IVCAP   : TTFT=15.08s  total=44.51s  tokens=25  jobCreate=1.52s
[7/10] Direct  : TTFT=8.18s  total=14.26s  tokens=438  tok/s=71.9
[7/10] IVCAP   : TTFT=15.55s  total=47.37s  tokens=28  jobCreate=1.47s
[8/10] Direct  : TTFT=8.00s  total=15.65s  tokens=590  tok/s=77.0
[8/10] IVCAP   : TTFT=13.16s  total=39.46s  tokens=23  jobCreate=1.56s
[9/10] Direct  : TTFT=12.39s  total=21.08s  tokens=531  tok/s=61.0
[9/10] IVCAP   : TTFT=14.94s  total=55.33s  tokens=35  jobCreate=1.49s
[10/10] Direct  : TTFT=6.25s  total=11.91s  tokens=406  tok/s=71.5
[10/10] IVCAP   : TTFT=16.17s  total=51.60s  tokens=31  jobCreate=1.53s

════════════════════════════════════════════════════════════
RESULTS SUMMARY
════════════════════════════════════════════════════════════

  Direct -- Time to First Token
  ────────────────────────────────────────────────────────────
  Mean:      8.53s    Min:    5.58s
  Median:    8.09s    Max:   12.39s
  P95:      12.39s    N:         10

  Direct -- Total Time
  ────────────────────────────────────────────────────────────
  Mean:     16.29s    Min:   10.65s
  Median:   16.45s    Max:   21.08s
  P95:      21.08s    N:         10

  Direct -- Time to Response Headers
  ────────────────────────────────────────────────────────────
  Mean:      8.52s    Min:    5.58s
  Median:    8.09s    Max:   12.39s
  P95:      12.39s    N:         10

  Direct -- Avg tokens/sec: 70.9

  IVCAP -- Time to First Token
  ────────────────────────────────────────────────────────────
  Mean:     14.34s    Min:   12.73s
  Median:   14.48s    Max:   16.17s
  P95:      16.17s    N:         10

  IVCAP -- Total Time
  ────────────────────────────────────────────────────────────
  Mean:     47.33s    Min:   39.45s
  Median:   46.75s    Max:   55.33s
  P95:      55.33s    N:         10

  IVCAP -- Submit to Job Created
  ────────────────────────────────────────────────────────────
  Mean:      1.49s    Min:    1.44s
  Median:    1.48s    Max:    1.56s
  P95:       1.56s    N:         10

  IVCAP -- Submit to First Event
  ────────────────────────────────────────────────────────────
  Mean:      2.12s    Min:    2.00s
  Median:    2.08s    Max:    2.36s
  P95:       2.36s    N:         10

  IVCAP -- Submit to Events Connected
  ────────────────────────────────────────────────────────────
  Mean:      2.12s    Min:    2.00s
  Median:    2.08s    Max:    2.36s
  P95:       2.36s    N:         10

  IVCAP -- Server-side Model Proxy TTFT
  ────────────────────────────────────────────────────────────
  Mean:     10.91s    Min:    8.91s
  Median:   11.14s    Max:   12.45s
  P95:      12.45s    N:         10

  IVCAP -- Server Buffer Flush Delay
  ────────────────────────────────────────────────────────────
  Mean:      1.07s    Min:    0.93s
  Median:    0.99s    Max:    1.50s
  P95:       1.50s    N:         10

  IVCAP -- Avg tokens/sec: 0.8

════════════════════════════════════════════════════════════
OVERHEAD ANALYSIS
════════════════════════════════════════════════════════════
  Direct avg TTFT:   8.52s
  IVCAP  avg TTFT:   14.34s
  Overhead:          5.82s (+68%)

Results written to: /Users/wil9cr/git/simple-job-events-demo/scripts/benchmark-results.json
```
