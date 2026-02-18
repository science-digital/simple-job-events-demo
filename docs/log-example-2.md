# IVCAP Chat Latency Diagnostic Log

## Run

status=success
job_id=urn:ivcap:job:d94455c0-252f-4c67-94a4-b155687dd197
events_connection_status=connected
token_events=30

## Timestamps

submitted_at=2026-02-18T00:02:59.981Z
job_created_at=2026-02-18T00:03:01.386Z
events_subscribe_started_at=2026-02-18T00:03:01.386Z
events_connected_at=2026-02-18T00:03:02.324Z
executing_at=2026-02-18T00:03:02.126Z
first_event_at=2026-02-18T00:03:02.323Z
first_token_server_emit_at=2026-02-18T00:03:18.240Z
request_dispatch_at=2026-02-18T00:03:00.694Z
upstream_accepted_at=2026-02-18T00:03:15.179Z
first_upstream_delta_at=2026-02-18T00:03:16.984Z
first_batch_emit_at=2026-02-18T00:03:18.240Z
first_token_server_event_at=2026-02-18T00:03:20.006Z
first_token_client_received_at=2026-02-18T00:03:19.979Z
finished_at=2026-02-18T00:04:00.995Z

## Latency Breakdown (ms)

submit_to_job_create_ms=1405 source=client
job_create_to_events_subscribe_ms=0 source=client
job_create_to_events_connected_ms=938 source=client
submit_to_first_event_ms=2342 source=client
submit_to_first_token_ms=19998 source=client
first_event_to_first_token_ms=17656 source=client
first_token_to_complete_ms=41016 source=client
server_step_emit_to_event_envelope_ms=1766 source=mixed
event_envelope_to_client_receive_ms=0 source=mixed
server_step_emit_to_client_receive_ms=1739 source=backend_marker
model_proxy_ttft_ms=16290 source=backend_marker
server_buffer_flush_delay_ms=1256 source=backend_marker
jobevents_pipeline_delay_ms=1766 source=mixed

## Recent Events (up to last 40)

1. [2026-02-18T00:03:35.664Z] recv=2026-02-18T00:03:35.688Z step=chat:tokens:13 finished=true seq=00010642 msg="completed"
2. [2026-02-18T00:03:36.275Z] recv=2026-02-18T00:03:36.383Z step=chat:tokens:14 finished=false seq=00010643 msg="; don’t rely on global ordering. - Design for eventual consistency: use sagas/compens"
3. [2026-02-18T00:03:36.819Z] recv=2026-02-18T00:03:37.038Z step=chat:tokens:14 finished=true seq=00010644 msg="completed"
4. [2026-02-18T00:03:37.366Z] recv=2026-02-18T00:03:37.604Z step=chat:tokens:15 finished=false seq=00010645 msg="ating actions or distributed transactions where necessary and acceptable. - Provide deduplication keys, idempotency"
5. [2026-02-18T00:03:38.007Z] recv=2026-02-18T00:03:38.022Z step=chat:tokens:15 finished=true seq=00010646 msg="completed"
6. [2026-02-18T00:03:38.602Z] recv=2026-02-18T00:03:38.571Z step=chat:tokens:16 finished=false seq=00010647 msg="tokens, and dead-letter handling for failures. 3) Operability: scalability, observability, replay"
7. [2026-02-18T00:03:39.114Z] recv=2026-02-18T00:03:39.080Z step=chat:tokens:16 finished=true seq=00010648 msg="completed"
8. [2026-02-18T00:03:39.637Z] recv=2026-02-18T00:03:39.612Z step=chat:tokens:17 finished=false seq=00010649 msg="& governance - Ensure the system can scale (partitioning, consumer parallelism, backpressure)"
9. [2026-02-18T00:03:40.254Z] recv=2026-02-18T00:03:40.214Z step=chat:tokens:17 finished=true seq=00010650 msg="completed"
10. [2026-02-18T00:03:40.976Z] recv=2026-02-18T00:03:41.031Z step=chat:tokens:18 finished=false seq=00010651 msg="and plan capacity/retention for event stores/brokers. - Build strong observability"
11. [2026-02-18T00:03:41.568Z] recv=2026-02-18T00:03:41.558Z step=chat:tokens:18 finished=true seq=00010652 msg="completed"
12. [2026-02-18T00:03:42.060Z] recv=2026-02-18T00:03:42.295Z step=chat:tokens:19 finished=false seq=00010653 msg=": metrics, structured logs,"
13. [2026-02-18T00:03:42.523Z] recv=2026-02-18T00:03:42.489Z step=chat:tokens:19 finished=true seq=00010654 msg="completed"
14. [2026-02-18T00:03:43.245Z] recv=2026-02-18T00:03:43.205Z step=chat:tokens:20 finished=false seq=00010655 msg="distributed tracing, and"
15. [2026-02-18T00:03:44.120Z] recv=2026-02-18T00:03:44.173Z step=chat:tokens:20 finished=true seq=00010656 msg="completed"
16. [2026-02-18T00:03:44.834Z] recv=2026-02-18T00:03:44.803Z step=chat:tokens:21 finished=false seq=00010657 msg="end-to"
17. [2026-02-18T00:03:45.502Z] recv=2026-02-18T00:03:45.465Z step=chat:tokens:21 finished=true seq=00010658 msg="completed"
18. [2026-02-18T00:03:46.181Z] recv=2026-02-18T00:03:46.150Z step=chat:tokens:22 finished=false seq=00010659 msg="-end monitoring of event flows and consumer lag. - Support replay and recovery (retention policy"
19. [2026-02-18T00:03:46.731Z] recv=2026-02-18T00:03:46.860Z step=chat:tokens:22 finished=true seq=00010660 msg="completed"
20. [2026-02-18T00:03:47.218Z] recv=2026-02-18T00:03:47.192Z step=chat:tokens:23 finished=false seq=00010661 msg=", tooling to rewind/replay, migration strategies) and safe schema evolution. - Operational controls: retries"
21. [2026-02-18T00:03:47.733Z] recv=2026-02-18T00:03:47.698Z step=chat:tokens:23 finished=true seq=00010662 msg="completed"
22. [2026-02-18T00:03:48.584Z] recv=2026-02-18T00:03:48.546Z step=chat:tokens:24 finished=false seq=00010663 msg="/backoff, dead-letter queues, alerting, security (authN"
23. [2026-02-18T00:03:49.441Z] recv=2026-02-18T00:03:49.515Z step=chat:tokens:24 finished=true seq=00010664 msg="completed"
24. [2026-02-18T00:03:50.123Z] recv=2026-02-18T00:03:50.089Z step=chat:tokens:25 finished=false seq=00010665 msg="/authZ), and governance (who can publish/consume/change schemas). Checklist questions to ask while designing"
25. [2026-02-18T00:03:50.720Z] recv=2026-02-18T00:03:51.187Z step=chat:tokens:25 finished=true seq=00010666 msg="completed"
26. [2026-02-18T00:03:51.414Z] recv=2026-02-18T00:03:51.390Z step=chat:tokens:26 finished=false seq=00010667 msg=": - Who owns each event and what does it mean? Is the schema stable/compatible? -"
27. [2026-02-18T00:03:52.059Z] recv=2026-02-18T00:03:52.056Z step=chat:tokens:26 finished=true seq=00010668 msg="completed"
28. [2026-02-18T00:03:52.540Z] recv=2026-02-18T00:03:52.793Z step=chat:tokens:27 finished=false seq=00010669 msg="What delivery and ordering guarantees are needed, and how will you make consumers idempotent? - How"
29. [2026-02-18T00:03:53.027Z] recv=2026-02-18T00:03:53.090Z step=chat:tokens:27 finished=true seq=00010670 msg="completed"
30. [2026-02-18T00:03:53.761Z] recv=2026-02-18T00:03:53.725Z step=chat:tokens:28 finished=false seq=00010671 msg="will you detect, debug, and recover from failures (replay, DLQs, tracing, alert"
31. [2026-02-18T00:03:54.443Z] recv=2026-02-18T00:03:54.410Z step=chat:tokens:28 finished=true seq=00010672 msg="completed"
32. [2026-02-18T00:03:54.989Z] recv=2026-02-18T00:03:54.954Z step=chat:tokens:29 finished=false seq=00010673 msg="ing)? Focusing on these three areas early will avoid the most common pitfalls ("
33. [2026-02-18T00:03:55.542Z] recv=2026-02-18T00:03:55.502Z step=chat:tokens:29 finished=true seq=00010674 msg="completed"
34. [2026-02-18T00:03:56.061Z] recv=2026-02-18T00:03:56.022Z step=chat:tokens:30 finished=false seq=00010675 msg="schema breakage, incorrect state due to duplicates/ordering, and painful ops when problems happen)."
35. [2026-02-18T00:03:56.720Z] recv=2026-02-18T00:03:56.789Z step=chat:tokens:30 finished=true seq=00010676 msg="completed"
36. [2026-02-18T00:03:57.437Z] recv=2026-02-18T00:03:57.440Z step=chat:response finished=true seq=00010677 msg="Completed streaming 518 chunks"
37. [2026-02-18T00:03:58.115Z] recv=2026-02-18T00:03:58.074Z step=chat:complete finished=false seq=00010678 msg="Chat response finalized"
38. [2026-02-18T00:03:58.720Z] recv=2026-02-18T00:03:58.685Z step=chat:complete finished=true seq=00010679 msg="completed"
39. [2026-02-18T00:03:59.986Z] recv=2026-02-18T00:03:59.953Z step=job:result finished=true seq=00010680 msg="Result: urn:ivcap:aspect:58318131-19f5-41ba-9b2e-adfa9f27f99f"
40. [2026-02-18T00:04:00.040Z] recv=2026-02-18T00:04:00.012Z step=job:status finished=true seq=00010681 msg="Job status: succeeded"
