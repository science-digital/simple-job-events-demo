import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EventStream } from '@/components/EventStream'
import { useChatJobEvents } from '@/hooks/useChatJobEvents'
import { useWarmUp } from '@/hooks/useWarmUp'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getMessageText(parts: { type: string; text?: string }[]): string {
  return parts
    .filter(part => part.type === 'text')
    .map(part => part.text ?? '')
    .join('')
}

// ---------------------------------------------------------------------------
// Example prompts for quick testing
// ---------------------------------------------------------------------------

const EXAMPLE_PROMPTS = [
  {
    label: 'AI Agent Architectures',
    text: 'Explain the core design patterns behind modern AI agent architectures. Cover: ReAct (reasoning + acting), tool-use and function calling, multi-agent orchestration, and memory/context management. For each pattern, describe how it works, when you would choose it, its limitations, and give a concrete example of a framework or system that implements it (e.g. LangGraph, CrewAI, AutoGen, etc.).',
  },
  {
    label: 'RAG vs Fine-tuning',
    text: 'Compare retrieval-augmented generation (RAG) and fine-tuning as strategies for customizing LLM behavior. When should you choose one over the other? What are the cost, latency, and accuracy trade-offs? Give a concrete example scenario for each.',
  },
  {
    label: 'Quick test',
    text: 'What are the three most important things to consider when designing an event-driven architecture?',
  },
]

// ---------------------------------------------------------------------------
// Timing helpers
// ---------------------------------------------------------------------------

function formatDelta(from: Date | null, to: Date | null): string | null {
  if (!from || !to) return null
  const ms = Math.max(0, to.getTime() - from.getTime())
  return `${(ms / 1000).toFixed(2)}s`
}

function formatMs(value: number | null): string | null {
  if (value == null) return null
  if (value > 0 && value < 1) return '<1ms'
  if (value < 1000) return `${Math.round(value)}ms`
  return `${(value / 1000).toFixed(2)}s`
}

function isoOrNA(date: Date | null): string {
  return date ? date.toISOString() : 'n/a'
}

type LatencySource = 'client' | 'mixed' | 'marker'

function sourceLabel(source: LatencySource): string {
  switch (source) {
    case 'client':
      return 'Browser time only'
    case 'mixed':
      return 'Server time + browser time'
    case 'marker':
      return 'Server app marker time'
    default:
      return 'Unknown'
  }
}

// ---------------------------------------------------------------------------
// Thinking dots animation (pure CSS via inline style tag)
// ---------------------------------------------------------------------------

const thinkingDotsStyle = `
@keyframes chat-bounce {
  0%, 80%, 100% { transform: scale(0); }
  40% { transform: scale(1); }
}
@keyframes chat-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}
`

function ThinkingIndicator({ statusMessage }: { statusMessage?: string | null }) {
  return (
    <div className="space-y-1.5 py-1">
      <div className="flex items-center gap-1">
        <style>{thinkingDotsStyle}</style>
        {[0, 1, 2].map(i => (
          <span
            key={i}
            className="inline-block h-2 w-2 rounded-full bg-muted-foreground/60"
            style={{
              animation: 'chat-bounce 1.4s infinite ease-in-out both',
              animationDelay: `${i * 0.16}s`,
            }}
          />
        ))}
      </div>
      {statusMessage && (
        <p className="text-[11px] leading-tight text-muted-foreground/70">
          {statusMessage}
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Timing pill (compact label + value)
// ---------------------------------------------------------------------------

function TimingPill({
  label,
  value,
  source,
}: {
  label: string
  value: string | null
  source?: LatencySource
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-muted-foreground/60">{label}:</span>
      <span className="font-mono font-medium tabular-nums">
        {value ?? 'Waiting...'}
      </span>
      {source && (
        <Badge variant="outline" className="h-4 px-1 text-[9px] leading-none">
          {source === 'client' ? 'C' : source === 'mixed' ? 'M' : 'B'}
        </Badge>
      )}
    </span>
  )
}

function SourceLegend() {
  return (
    <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground/70">
      <span className="font-medium">Metric source:</span>
      <span className="inline-flex items-center gap-1">
        <Badge variant="outline" className="h-4 px-1 text-[9px] leading-none">C</Badge>
        <span>{sourceLabel('client')}</span>
      </span>
      <span className="inline-flex items-center gap-1">
        <Badge variant="outline" className="h-4 px-1 text-[9px] leading-none">M</Badge>
        <span>{sourceLabel('mixed')}</span>
      </span>
      <span className="inline-flex items-center gap-1">
        <Badge variant="outline" className="h-4 px-1 text-[9px] leading-none">B</Badge>
        <span>{sourceLabel('marker')}</span>
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Chat page
// ---------------------------------------------------------------------------

export function ChatPage() {
  const [prompt, setPrompt] = useState('')
  const [debugOpen, setDebugOpen] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const {
    messages,
    submitPrompt,
    reset,
    isBusy,
    isStreaming,
    status,
    jobId,
    error,
    tokenEvents,
    eventsConnectionStatus,
    events,
    statusMessage,
    submittedAt,
    executingAt,
    firstEventAt,
    firstTokenAt,
    finishedAt,
    jobCreatedAt,
    eventsSubscribeStartedAt,
    eventsConnectedAt,
    firstTokenServerEventAt,
    firstTokenServerEmitAt,
    requestDispatchAt,
    upstreamAcceptedAt,
    firstUpstreamDeltaAt,
    firstBatchEmitAt,
    latencyBreakdown,
  } = useChatJobEvents()

  const warmUp = useWarmUp()

  const canSubmit = prompt.trim().length > 0 && !isBusy
  const showThinking = isBusy && !isStreaming

  const orderedMessages = useMemo(
    () => messages.filter(m => m.role === 'user' || m.role === 'assistant'),
    [messages],
  )
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle')

  const diagnosticLog = useMemo(() => {
    const recentEvents = events.slice(-40)
    const recentEventLines = recentEvents.map((event, index) => {
      const seq = event.seqId ? ` seq=${event.seqId}` : ''
      const meta = event.latencyMeta ? ` meta=${JSON.stringify(event.latencyMeta)}` : ''
      const msg = (event.message || '').replace(/\s+/g, ' ').trim()
      return `${index + 1}. [${event.timestamp.toISOString()}] recv=${event.receivedAt.toISOString()} step=${event.step_id} finished=${event.finished}${seq} msg="${msg}"${meta}`
    })

    return [
      '# IVCAP Chat Latency Diagnostic Log',
      '',
      '## Run',
      `status=${status}`,
      `job_id=${jobId ?? 'n/a'}`,
      `events_connection_status=${eventsConnectionStatus}`,
      `token_events=${tokenEvents}`,
      '',
      '## Timestamps',
      `submitted_at=${isoOrNA(submittedAt)}`,
      `job_created_at=${isoOrNA(jobCreatedAt)}`,
      `events_subscribe_started_at=${isoOrNA(eventsSubscribeStartedAt)}`,
      `events_connected_at=${isoOrNA(eventsConnectedAt)}`,
      `executing_at=${isoOrNA(executingAt)}`,
      `first_event_at=${isoOrNA(firstEventAt)}`,
      `first_token_server_emit_at=${isoOrNA(firstTokenServerEmitAt)}`,
      `request_dispatch_at=${isoOrNA(requestDispatchAt)}`,
      `upstream_accepted_at=${isoOrNA(upstreamAcceptedAt)}`,
      `first_upstream_delta_at=${isoOrNA(firstUpstreamDeltaAt)}`,
      `first_batch_emit_at=${isoOrNA(firstBatchEmitAt)}`,
      `first_token_server_event_at=${isoOrNA(firstTokenServerEventAt)}`,
      `first_token_client_received_at=${isoOrNA(firstTokenAt)}`,
      `finished_at=${isoOrNA(finishedAt)}`,
      '',
      '## Latency Breakdown (ms)',
      `submit_to_job_create_ms=${latencyBreakdown.submitToJobCreateMs ?? 'n/a'} source=client`,
      `job_create_to_events_subscribe_ms=${latencyBreakdown.jobCreateToEventsSubscribeMs ?? 'n/a'} source=client`,
      `job_create_to_events_connected_ms=${latencyBreakdown.jobCreateToEventsConnectedMs ?? 'n/a'} source=client`,
      `submit_to_first_event_ms=${latencyBreakdown.submitToFirstEventMs ?? 'n/a'} source=client`,
      `submit_to_first_token_ms=${latencyBreakdown.submitToFirstTokenMs ?? 'n/a'} source=client`,
      `first_event_to_first_token_ms=${latencyBreakdown.firstEventToFirstTokenMs ?? 'n/a'} source=client`,
      `first_token_to_complete_ms=${latencyBreakdown.firstTokenToCompleteMs ?? 'n/a'} source=client`,
      `server_step_emit_to_event_envelope_ms=${latencyBreakdown.serverStepEmitToEventEnvelopeMs ?? 'n/a'} source=mixed`,
      `event_envelope_to_client_receive_ms=${latencyBreakdown.eventEnvelopeToClientReceiveMs ?? 'n/a'} source=mixed`,
      `server_step_emit_to_client_receive_ms=${latencyBreakdown.serverStepEmitToClientReceiveMs ?? 'n/a'} source=backend_marker`,
      `model_proxy_ttft_ms=${latencyBreakdown.modelProxyTtftMs ?? 'n/a'} source=backend_marker`,
      `server_buffer_flush_delay_ms=${latencyBreakdown.serverBufferFlushDelayMs ?? 'n/a'} source=backend_marker`,
      `jobevents_pipeline_delay_ms=${latencyBreakdown.jobEventsPipelineDelayMs ?? 'n/a'} source=mixed`,
      '',
      '## Recent Events (up to last 40)',
      ...(recentEventLines.length ? recentEventLines : ['n/a']),
    ].join('\n')
  }, [
    events,
    status,
    jobId,
    eventsConnectionStatus,
    tokenEvents,
    submittedAt,
    jobCreatedAt,
    eventsSubscribeStartedAt,
    eventsConnectedAt,
    executingAt,
    firstEventAt,
    firstTokenServerEmitAt,
    requestDispatchAt,
    upstreamAcceptedAt,
    firstUpstreamDeltaAt,
    firstBatchEmitAt,
    firstTokenServerEventAt,
    firstTokenAt,
    finishedAt,
    latencyBreakdown,
  ])

  const handleCopyDiagnosticLog = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(diagnosticLog)
      setCopyStatus('copied')
      window.setTimeout(() => setCopyStatus('idle'), 1800)
    } catch {
      setCopyStatus('error')
      window.setTimeout(() => setCopyStatus('idle'), 2400)
    }
  }, [diagnosticLog])

  // ---- Auto-scroll to bottom on new content ----
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [orderedMessages, isStreaming, showThinking])

  // ---- Auto-resize textarea ----
  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    // Cap at ~4 lines (roughly 6rem)
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`
  }, [])

  useEffect(() => {
    resizeTextarea()
  }, [prompt, resizeTextarea])

  // ---- Submit handler ----
  const handleSubmit = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault()
    const value = prompt.trim()
    if (!value || isBusy) return
    setPrompt('')
    await submitPrompt(value)
  }

  // ---- Keyboard: Enter to send, Shift+Enter for newline ----
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void handleSubmit()
    }
  }

  // ---- Status badge variant ----
  const statusBadgeVariant = (() => {
    switch (status) {
      case 'streaming':
        return 'default' as const
      case 'success':
        return 'secondary' as const
      case 'error':
        return 'destructive' as const
      default:
        return 'outline' as const
    }
  })()

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* ----------------------------------------------------------------- */}
      {/* Header                                                            */}
      {/* ----------------------------------------------------------------- */}
      <header className="flex shrink-0 items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold tracking-tight">IVCAP Chat</h1>
          <Badge variant={statusBadgeVariant} className="text-xs">
            {status.toUpperCase()}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {/* Warm-up button and status */}
          {warmUp.status === 'idle' && (
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => void warmUp.warmUp()}
            >
              Warm Up
            </Button>
          )}
          {warmUp.status === 'warming' && (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Warming...
              {warmUp.submitToExecuteMs != null && (
                <span className="font-mono tabular-nums">{formatMs(warmUp.submitToExecuteMs)}</span>
              )}
            </span>
          )}
          {warmUp.status === 'warm' && (
            <span className="inline-flex items-center gap-1.5 text-xs">
              <Badge variant="secondary" className="text-[10px]">WARM</Badge>
              {warmUp.submitToCompleteMs != null && (
                <span className="font-mono tabular-nums text-muted-foreground">
                  {formatMs(warmUp.submitToCompleteMs)}
                </span>
              )}
            </span>
          )}
          {warmUp.status === 'error' && (
            <span className="inline-flex items-center gap-1.5 text-xs">
              <Badge variant="destructive" className="text-[10px]">WARM ERR</Badge>
              <Button
                variant="outline"
                size="sm"
                className="h-6 px-2 text-[10px]"
                onClick={() => void warmUp.warmUp()}
              >
                Retry
              </Button>
            </span>
          )}

          <Button
            variant="ghost"
            size="sm"
            className="text-xs"
            onClick={() => setDebugOpen(prev => !prev)}
          >
            {debugOpen ? 'Hide Debug' : 'Debug'}
          </Button>
          <Button variant="ghost" size="sm" onClick={reset} disabled={isBusy && !messages.length}>
            Reset
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link to="/">Workflow Demo</Link>
          </Button>
        </div>
      </header>

      {/* ----------------------------------------------------------------- */}
      {/* Messages area                                                     */}
      {/* ----------------------------------------------------------------- */}
      <div className="flex min-h-0 flex-1">
        {/* Main chat column */}
        <div className="flex flex-1 flex-col">
          <div className="flex-1 overflow-y-auto px-4 py-6">
            <div className="mx-auto max-w-2xl space-y-4">
              {orderedMessages.length === 0 && !isBusy && (
                <div className="flex flex-col items-center justify-center gap-3 py-16 text-center text-muted-foreground">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-10 w-10 opacity-30"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z"
                    />
                  </svg>
                  <p className="text-sm">Send a message to start a conversation.</p>
                  <p className="text-xs opacity-60">
                    Each message creates an IVCAP job; tokens stream back via Job Events.
                  </p>
                  <div className="mt-4 flex flex-wrap justify-center gap-2">
                    {EXAMPLE_PROMPTS.map(example => (
                      <button
                        key={example.label}
                        type="button"
                        className="rounded-lg border bg-background px-3 py-2 text-left text-xs text-foreground shadow-sm transition-colors hover:bg-muted/60"
                        onClick={() => void submitPrompt(example.text)}
                      >
                        {example.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {orderedMessages.map((message, idx) => {
                const isUser = message.role === 'user'
                const text = getMessageText(message.parts)
                const isLastAssistant =
                  !isUser && idx === orderedMessages.length - 1

                return (
                  <div
                    key={message.id}
                    className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`relative max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                        isUser
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted/60'
                      }`}
                    >
                      {/* Message text */}
                      <div className="whitespace-pre-wrap">
                        {text}
                        {/* Blinking cursor while streaming */}
                        {isLastAssistant && isStreaming && (
                          <span
                            className="ml-0.5 inline-block h-[1.1em] w-[2px] translate-y-[2px] bg-current"
                            style={{ animation: 'chat-blink 1s step-end infinite' }}
                          />
                        )}
                      </div>

                      {/* Thinking indicator: show on the last assistant bubble if no tokens yet */}
                      {isLastAssistant && showThinking && !text && (
                        <ThinkingIndicator statusMessage={statusMessage} />
                      )}
                    </div>
                  </div>
                )
              })}

              {/* Error banner */}
              {error && (
                <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  {error}
                </div>
              )}

              {/* Scroll anchor */}
              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* --------------------------------------------------------------- */}
          {/* Input bar                                                        */}
          {/* --------------------------------------------------------------- */}
          <div className="shrink-0 border-t bg-background px-4 py-3">
            {/* Timing metrics bar -- visible when a job has been submitted */}
            {status !== 'idle' && submittedAt && (
              <>
                <div className="mx-auto mb-1.5 flex max-w-2xl flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                  <TimingPill label="Executing" value={formatDelta(submittedAt, executingAt)} source="client" />
                  <TimingPill label="First event" value={formatDelta(submittedAt, firstEventAt)} source="client" />
                  <TimingPill label="First token" value={formatDelta(submittedAt, firstTokenAt)} source="client" />
                  <TimingPill label="Complete" value={formatDelta(submittedAt, finishedAt)} source="client" />
                </div>
                <div className="mx-auto mb-2.5 flex max-w-2xl flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground/85">
                  <TimingPill label="Create job" value={formatMs(latencyBreakdown.submitToJobCreateMs)} source="client" />
                  <TimingPill label="Connect events" value={formatMs(latencyBreakdown.jobCreateToEventsConnectedMs)} source="client" />
                  <TimingPill label="Events platform->client" value={formatMs(latencyBreakdown.eventEnvelopeToClientReceiveMs)} source="mixed" />
                  <TimingPill label="Emit->client" value={formatMs(latencyBreakdown.serverStepEmitToClientReceiveMs)} source="marker" />
                </div>
                <div className="mx-auto mb-2.5 max-w-2xl">
                  <SourceLegend />
                </div>
              </>
            )}
            <form
              className="mx-auto flex max-w-2xl items-end gap-2"
              onSubmit={handleSubmit}
            >
              <textarea
                ref={textareaRef}
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={isBusy ? 'Waiting for response...' : 'Send a message...'}
                disabled={isBusy}
                rows={1}
                className="flex-1 resize-none rounded-xl border bg-muted/30 px-4 py-2.5 text-sm shadow-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              />
              <Button
                type="submit"
                size="sm"
                disabled={!canSubmit}
                className="mb-px rounded-xl px-4"
              >
                {isBusy ? (
                  /* Simple spinner */
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                ) : (
                  /* Arrow-up send icon */
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-4 w-4"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path
                      fillRule="evenodd"
                      d="M10 17a.75.75 0 0 1-.75-.75V5.612L5.29 9.77a.75.75 0 0 1-1.08-1.04l5.25-5.5a.75.75 0 0 1 1.08 0l5.25 5.5a.75.75 0 1 1-1.08 1.04l-3.96-4.158V16.25A.75.75 0 0 1 10 17Z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
              </Button>
            </form>
            <p className="mx-auto mt-1.5 max-w-2xl text-center text-[11px] text-muted-foreground/50">
              Messages are routed via IVCAP Job Events. Latency depends on job scheduling + event delivery.
            </p>
          </div>
        </div>

        {/* --------------------------------------------------------------- */}
        {/* Collapsible debug panel (right side)                             */}
        {/* --------------------------------------------------------------- */}
        {debugOpen && (
          <aside className="flex min-h-0 w-[54rem] shrink-0 flex-col overflow-y-auto border-l">
            {/* Diagnostics */}
            <div className="shrink-0 border-b px-4 py-3">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Job Diagnostics
              </h2>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Status</span>
                  <Badge variant={statusBadgeVariant} className="text-[10px]">
                    {status.toUpperCase()}
                  </Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Job ID</span>
                  <span className="max-w-[180px] truncate font-mono text-[10px]">
                    {jobId || '--'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Token Events</span>
                  <span className="font-mono">{tokenEvents}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Events Stream</span>
                  <span>{eventsConnectionStatus}</span>
                </div>
                <div className="pt-2">
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Latency Breakdown
                  </div>
                  <SourceLegend />
                  <div className="space-y-1 font-mono text-[10px]">
                    <div className="mt-1 flex justify-between">
                      <span title="How long from pressing Send until we get a job ID back.">Submit to job created (C)</span>
                      <span>{formatMs(latencyBreakdown.submitToJobCreateMs) ?? '--'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span title="How long between getting a job ID and starting event listening.">Job created to subscribe (C)</span>
                      <span>{formatMs(latencyBreakdown.jobCreateToEventsSubscribeMs) ?? '--'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span title="How long from job creation to a successful events connection.">Job created to events connected (C)</span>
                      <span>{formatMs(latencyBreakdown.jobCreateToEventsConnectedMs) ?? '--'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span title="How long from Send until any first event arrives.">Submit to first event (C)</span>
                      <span>{formatMs(latencyBreakdown.submitToFirstEventMs) ?? '--'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span title="How long from Send until first answer text arrives.">Submit to first token (C)</span>
                      <span>{formatMs(latencyBreakdown.submitToFirstTokenMs) ?? '--'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span title="Gap between first event and first answer text. Usually model startup + buffering.">First event to first token (C)</span>
                      <span>{formatMs(latencyBreakdown.firstEventToFirstTokenMs) ?? '--'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span title="How long from app saying 'I emitted this' to JobEvents stamping the event on server side.">App emit to JobEvents stamp (M)</span>
                      <span>{formatMs(latencyBreakdown.serverStepEmitToEventEnvelopeMs) ?? '--'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span title="How long from JobEvents server timestamp to browser receive time.">JobEvents stamp to browser (M)</span>
                      <span>{formatMs(latencyBreakdown.eventEnvelopeToClientReceiveMs) ?? '--'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span title="End-to-end from app emit marker to browser receive time.">App emit to browser (B)</span>
                      <span>{formatMs(latencyBreakdown.serverStepEmitToClientReceiveMs) ?? '--'}</span>
                    </div>
                    <div className="mt-1 flex justify-between">
                      <span title="Approximate model startup time until first upstream token appears.">Model/proxy first-token time (B)</span>
                      <span>{formatMs(latencyBreakdown.modelProxyTtftMs) ?? '--'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span title="How long text waits in buffer before first token batch is emitted.">Server first-batch buffering delay (B)</span>
                      <span>{formatMs(latencyBreakdown.serverBufferFlushDelayMs) ?? '--'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span title="How long first emitted batch takes to appear in JobEvents as a stamped event.">JobEvents pipeline delay (M)</span>
                      <span>{formatMs(latencyBreakdown.jobEventsPipelineDelayMs) ?? '--'}</span>
                    </div>
                  </div>
                </div>
                <div className="pt-2">
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Raw Timestamps
                  </div>
                  <div className="space-y-1 font-mono text-[10px]">
                    <div className="flex justify-between"><span title="Browser time when you pressed Send.">Submitted at</span><span>{submittedAt?.toISOString() ?? '--'}</span></div>
                    <div className="flex justify-between"><span title="Browser time when job ID came back.">Job created at</span><span>{jobCreatedAt?.toISOString() ?? '--'}</span></div>
                    <div className="flex justify-between"><span title="Browser time when event listening started.">Events subscribe started at</span><span>{eventsSubscribeStartedAt?.toISOString() ?? '--'}</span></div>
                    <div className="flex justify-between"><span title="Browser time when events connection first succeeded.">Events connected at</span><span>{eventsConnectedAt?.toISOString() ?? '--'}</span></div>
                    <div className="flex justify-between"><span title="Server app time when first token batch was emitted.">First token server emit at</span><span>{firstTokenServerEmitAt?.toISOString() ?? '--'}</span></div>
                    <div className="flex justify-between"><span title="Server app time when upstream request was sent to the model proxy.">Request dispatch at</span><span>{requestDispatchAt?.toISOString() ?? '--'}</span></div>
                    <div className="flex justify-between"><span title="Server app time when upstream request was accepted.">Upstream accepted at</span><span>{upstreamAcceptedAt?.toISOString() ?? '--'}</span></div>
                    <div className="flex justify-between"><span title="Server app time when first upstream token arrived.">First upstream delta at</span><span>{firstUpstreamDeltaAt?.toISOString() ?? '--'}</span></div>
                    <div className="flex justify-between"><span title="Server app time when first batch was emitted into JobEvents.">First batch emit at</span><span>{firstBatchEmitAt?.toISOString() ?? '--'}</span></div>
                    <div className="flex justify-between"><span title="JobEvents server timestamp on the first token event.">First token event server timestamp</span><span>{firstTokenServerEventAt?.toISOString() ?? '--'}</span></div>
                    <div className="flex justify-between"><span title="Browser time when first token event reached the page.">First token received at</span><span>{firstTokenAt?.toISOString() ?? '--'}</span></div>
                  </div>
                </div>
              </div>
            </div>

            {/* Raw events */}
            <div className="min-h-0 flex-1 px-4 py-3">
              <div className="mb-3 rounded-md border bg-muted/20 p-2">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    AI Diagnostic Log
                  </h3>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-6 px-2 text-[10px]"
                    onClick={() => void handleCopyDiagnosticLog()}
                  >
                    {copyStatus === 'copied' ? 'Copied' : copyStatus === 'error' ? 'Copy failed' : 'Copy'}
                  </Button>
                </div>
                <p className="mb-2 text-[10px] text-muted-foreground/80">
                  Paste this into an AI chat to analyze bottlenecks for this run.
                </p>
                <textarea
                  readOnly
                  value={diagnosticLog}
                  className="h-28 w-full resize-none rounded border bg-background px-2 py-1 font-mono text-[10px] text-foreground"
                />
              </div>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Raw Job Events
              </h2>
              <div className="min-h-0">
                <EventStream
                  events={events}
                  eventsConnectionStatus={eventsConnectionStatus}
                  className="max-h-none"
                />
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}
