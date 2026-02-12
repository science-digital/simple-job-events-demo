# Log Example Summary (High-Level)

This run completed successfully, but it shows a few clear latency issues.

- **Main issue: slow first model token**
  - The largest delay is before the first upstream token arrives (`model_proxy_ttft_ms` about 10s).
  - In simple terms: the model/proxy takes a long time to start generating output.

- **Secondary issue: JobEvents first-token pipeline delay**
  - After the app emits the first token batch, it takes about 2.1s to appear as a JobEvents server event (`jobevents_pipeline_delay_ms`).
  - In simple terms: first token events are slow to become visible in JobEvents.

- **Client/network after publish looks healthy**
  - `event_envelope_to_client_receive_ms` is only about 20ms.
  - In simple terms: once JobEvents has the event, the browser receives it quickly.

- **Some bursty delivery behavior appears**
  - A few events are received together (same `recv` time), suggesting occasional buffering/coalescing.
  - In simple terms: delivery is mostly smooth but sometimes arrives in small bursts.

- **Overall takeaway**
  - Biggest bottleneck is model/proxy startup.
  - Important secondary bottleneck is first-token handling inside the JobEvents path.
