# Time to First Token Stats (TTFT) -- FIRST_BATCH_FLUSH_MAX_TOKENS = 1

Comparing time to first token between IVCAP and direct mode gives a high-level view of the latency added by the IVCAP pipeline.

- **Prompt:** "What are the three most important things to consider when designing an event-driven architecture?"
- **Iterations:** 10 per mode, interleaved (direct then ivcap each round)
- **Date:** 2026-02-19
- **Warm-up:** yes (one warm-up job before the benchmark to avoid cold-start skew)
- **Server config:** `FIRST_BATCH_FLUSH_MAX_TOKENS = 1` (flush the first batch after just 1 token in attempt to improve TTFT), `BATCH_FLUSH_MAX_TOKENS = 10`
- **Script:** [`scripts/benchmark-ttft.mjs`](../scripts/benchmark-ttft.mjs) -- standalone Node.js benchmark runner, run with `node scripts/benchmark-ttft.mjs -n 10 --mode both`

## Comparison

| Metric                      | Direct | IVCAP | Difference   |
| --------------------------- | ------ | ----- | ------------ |
| **Avg time to first token** | 7.7s   | 13.9s | +6.2s (+80%) |
| Median TTFT                 | 7.2s   | 13.8s | +6.5s        |
| Min TTFT                    | 5.7s   | 12.0s |              |
| Max TTFT                    | 12.5s  | 15.5s |              |
| Avg total response time     | 13.8s  | 70.0s | +56.2s       |
| Avg tokens/sec              | 83.0   | 0.9   |              |

### Where does the IVCAP overhead come from?

The IVCAP pipeline adds ~6.2s of overhead on average to the first token. Breaking it down:

| Stage                                         | Avg time  |
| --------------------------------------------- | --------- |
| Job creation (HTTP round-trip)                | 1.5s      |
| Events subscription connect                   | 0.6s      |
| Model proxy TTFT (server-side, same LLM call) | 10.5s     |
| Server buffer flush delay                     | 1.0s      |
| **Client-observed TTFT**                      | **13.9s** |

Most of the time (~10.5s) is the model itself thinking -- the same LLM call that takes ~7.7s via direct mode takes ~10.5s when measured server-side through the IVCAP proxy. The remaining pipeline overhead (job creation + event routing + buffer flush) adds ~3.4s.

Setting `FIRST_BATCH_FLUSH_MAX_TOKENS = 1` (flush the first batch after just 1 token) did not meaningfully improve TTFT compared to the baseline test (`MAX_TOKENS = 3`). The buffer flush delay averaged 1.0s, which is similar to the baseline. The bottleneck is the model proxy TTFT and job creation, not the batch flushing strategy.

The total response time (70s vs 47s in the baseline) is higher because flushing single tokens creates more job events, increasing per-event overhead across the full stream.

## Conclusion

With `FIRST_BATCH_FLUSH_MAX_TOKENS = 1`, the IVCAP pipeline adds roughly **6 seconds** to time-to-first-token compared to calling LiteLLM directly. This is essentially the same as the baseline (5.8s with `MAX_TOKENS = 3`), confirming the flush threshold is not the bottleneck for TTFT. The overhead is dominated by job creation (~1.5s), model proxy latency (~2.8s more than direct), and event delivery infrastructure (~1s buffer flush).

## Log

```bash
FIRST_BATCH_FLUSH_MAX_TOKENS = 1 # first batch: flush when 3 chunks accumulated
BATCH_FLUSH_MAX_TOKENS = 10      # normal batches: never flush


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
Auth token valid for ~239 minutes.

Sending warm-up job to prime the service container...
  Warm-up job created: urn:ivcap:job:615254f4-2058-46da-b6dd-d5f5b2475695
  Warm-up complete (succeeded) in 25.5s

════════════════════════════════════════════════════════════
Starting benchmark...

[1/10] Direct  : TTFT=7.43s  total=14.15s  tokens=547  tok/s=81.2
[1/10] IVCAP   : TTFT=12.70s  total=76.27s  tokens=59  jobCreate=1.54s
[2/10] Direct  : TTFT=7.02s  total=14.12s  tokens=492  tok/s=69.2
[2/10] IVCAP   : TTFT=15.52s  total=57.79s  tokens=37  jobCreate=1.45s
[3/10] Direct  : TTFT=12.48s  total=17.60s  tokens=500  tok/s=97.6
[3/10] IVCAP   : TTFT=15.32s  total=61.31s  tokens=40  jobCreate=1.53s
[4/10] Direct  : TTFT=8.84s  total=15.48s  tokens=522  tok/s=78.5
[4/10] IVCAP   : TTFT=13.10s  total=54.91s  tokens=35  jobCreate=1.44s
[5/10] Direct  : TTFT=8.11s  total=14.53s  tokens=466  tok/s=72.5
[5/10] IVCAP   : TTFT=14.37s  total=71.50s  tokens=51  jobCreate=1.45s
[6/10] Direct  : TTFT=5.74s  total=12.08s  tokens=505  tok/s=79.4
[6/10] IVCAP   : TTFT=14.77s  total=84.20s  tokens=63  jobCreate=1.48s
[7/10] Direct  : TTFT=6.88s  total=13.15s  tokens=553  tok/s=88.0
[7/10] IVCAP   : TTFT=13.70s  total=64.94s  tokens=47  jobCreate=1.45s
[8/10] Direct  : TTFT=7.52s  total=12.96s  tokens=426  tok/s=78.2
[8/10] IVCAP   : TTFT=13.80s  total=69.23s  tokens=51  jobCreate=1.53s
[9/10] Direct  : TTFT=6.41s  total=10.99s  tokens=429  tok/s=93.3
[9/10] IVCAP   : TTFT=12.03s  total=77.66s  tokens=61  jobCreate=1.45s
[10/10] Direct  : TTFT=6.87s  total=12.62s  tokens=529  tok/s=91.9
[10/10] IVCAP   : TTFT=13.71s  total=82.38s  tokens=62  jobCreate=1.46s

════════════════════════════════════════════════════════════
RESULTS SUMMARY
════════════════════════════════════════════════════════════

  Direct -- Time to First Token
  ────────────────────────────────────────────────────────────
  Mean:      7.73s    Min:    5.74s
  Median:    7.23s    Max:   12.48s
  P95:      12.48s    N:         10

  Direct -- Total Time
  ────────────────────────────────────────────────────────────
  Mean:     13.77s    Min:   10.99s
  Median:   13.64s    Max:   17.60s
  P95:      17.60s    N:         10

  Direct -- Time to Response Headers
  ────────────────────────────────────────────────────────────
  Mean:      7.73s    Min:    5.74s
  Median:    7.23s    Max:   12.48s
  P95:      12.48s    N:         10

  Direct -- Avg tokens/sec: 83.0

  IVCAP -- Time to First Token
  ────────────────────────────────────────────────────────────
  Mean:     13.90s    Min:   12.03s
  Median:   13.76s    Max:   15.52s
  P95:      15.52s    N:         10

  IVCAP -- Total Time
  ────────────────────────────────────────────────────────────
  Mean:     70.02s    Min:   54.91s
  Median:   70.37s    Max:   84.20s
  P95:      84.20s    N:         10

  IVCAP -- Submit to Job Created
  ────────────────────────────────────────────────────────────
  Mean:      1.48s    Min:    1.44s
  Median:    1.46s    Max:    1.54s
  P95:       1.54s    N:         10

  IVCAP -- Submit to First Event
  ────────────────────────────────────────────────────────────
  Mean:      2.09s    Min:    1.97s
  Median:    2.06s    Max:    2.28s
  P95:       2.28s    N:         10

  IVCAP -- Submit to Events Connected
  ────────────────────────────────────────────────────────────
  Mean:      2.09s    Min:    1.97s
  Median:    2.06s    Max:    2.28s
  P95:       2.28s    N:         10

  IVCAP -- Server-side Model Proxy TTFT
  ────────────────────────────────────────────────────────────
  Mean:     10.51s    Min:    8.89s
  Median:   10.32s    Max:   12.31s
  P95:      12.31s    N:         10

  IVCAP -- Server Buffer Flush Delay
  ────────────────────────────────────────────────────────────
  Mean:      1.03s    Min:    0.91s
  Median:    1.01s    Max:    1.17s
  P95:       1.17s    N:         10

  IVCAP -- Avg tokens/sec: 0.9

════════════════════════════════════════════════════════════
OVERHEAD ANALYSIS
════════════════════════════════════════════════════════════
  Direct avg TTFT:   7.73s
  IVCAP  avg TTFT:   13.90s
  Overhead:          6.17s (+80%)

Results written to: /Users/wil9cr/git/simple-job-events-demo/scripts/benchmark-results.json
```
