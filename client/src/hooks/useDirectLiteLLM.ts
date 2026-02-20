import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { UIMessage } from '@ai-sdk/react'
import { useChat } from '@ai-sdk/react'
import { generateId } from 'ai'
import type { ChatMessage } from '@/types/events'
import { streamDirectChat } from '@/lib/api'

type ChatRunStatus = 'idle' | 'submitting' | 'streaming' | 'success' | 'error'

export interface DirectLatencyBreakdown {
  submitToResponseHeadersMs: number | null
  submitToFirstTokenMs: number | null
  submitToCompleteMs: number | null
  firstTokenToCompleteMs: number | null
  tokenCount: number
  tokensPerSecond: number | null
}

export interface DirectSseChunk {
  receivedAt: Date
  content: string
  raw: string
}

export interface UseDirectLiteLLMReturn {
  messages: UIMessage[]
  submitPrompt: (prompt: string) => Promise<void>
  reset: () => void
  isBusy: boolean
  isStreaming: boolean
  status: ChatRunStatus
  error: string | null
  tokenCount: number
  submittedAt: Date | null
  responseHeadersAt: Date | null
  firstTokenAt: Date | null
  finishedAt: Date | null
  latencyBreakdown: DirectLatencyBreakdown
  sseChunks: DirectSseChunk[]
}

function diffMs(from: Date | null, to: Date | null): number | null {
  if (!from || !to) return null
  return Math.max(0, to.getTime() - from.getTime())
}

function getMessageText(message: UIMessage): string {
  return message.parts
    .filter(part => part.type === 'text')
    .map(part => part.text)
    .join('')
}

function asChatMessages(messages: UIMessage[]): ChatMessage[] {
  return messages
    .filter(message => message.role === 'system' || message.role === 'user' || message.role === 'assistant')
    .map(message => ({
      role: message.role,
      content: getMessageText(message),
    }))
    .filter(message => message.content.trim().length > 0)
}

function buildUserMessage(prompt: string): UIMessage {
  return {
    id: generateId(),
    role: 'user',
    parts: [{ type: 'text', text: prompt, state: 'done' }],
  }
}

function buildAssistantMessage(id: string): UIMessage {
  return {
    id,
    role: 'assistant',
    parts: [{ type: 'text', text: '', state: 'streaming' }],
  }
}

export function useDirectLiteLLM(): UseDirectLiteLLMReturn {
  const { messages, setMessages } = useChat()
  const [status, setStatus] = useState<ChatRunStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [tokenCount, setTokenCount] = useState(0)
  const [submittedAt, setSubmittedAt] = useState<Date | null>(null)
  const [responseHeadersAt, setResponseHeadersAt] = useState<Date | null>(null)
  const [firstTokenAt, setFirstTokenAt] = useState<Date | null>(null)
  const [finishedAt, setFinishedAt] = useState<Date | null>(null)
  const [sseChunks, setSseChunks] = useState<DirectSseChunk[]>([])

  const assistantIdRef = useRef<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const firstTokenRecordedRef = useRef(false)

  // -- Adaptive typewriter animation (same algorithm as useChatJobEvents) -----
  const MIN_TICK_MS = 8
  const MAX_TICK_MS = 40
  const QUEUE_FAST_THRESHOLD = 50
  const BURST_THRESHOLD = 200
  const BURST_CHARS = 5

  const typewriterQueueRef = useRef('')
  const typewriterTimerRef = useRef<number | null>(null)

  const appendAssistantChunk = useCallback((chunk: string) => {
    const assistantId = assistantIdRef.current
    if (!assistantId) return

    setMessages(prev =>
      prev.map(message => {
        if (message.id !== assistantId) return message
        const firstTextPart = message.parts.find(part => part.type === 'text')
        const existing = firstTextPart && firstTextPart.type === 'text' ? firstTextPart.text : ''
        return {
          ...message,
          parts: [{ type: 'text', text: `${existing}${chunk}`, state: 'streaming' }],
        }
      }),
    )
  }, [setMessages])

  const stopTypewriter = useCallback(() => {
    if (typewriterTimerRef.current != null) {
      window.clearTimeout(typewriterTimerRef.current)
      typewriterTimerRef.current = null
    }
  }, [])

  const flushTypewriter = useCallback(() => {
    stopTypewriter()
    const remaining = typewriterQueueRef.current
    typewriterQueueRef.current = ''
    if (remaining) {
      appendAssistantChunk(remaining)
    }
  }, [appendAssistantChunk, stopTypewriter])

  const startTypewriter = useCallback(() => {
    if (typewriterTimerRef.current != null) return

    const scheduleNextTick = () => {
      const queue = typewriterQueueRef.current
      if (!queue) {
        typewriterTimerRef.current = null
        return
      }

      const ratio = Math.min(queue.length / QUEUE_FAST_THRESHOLD, 1)
      const tickMs = MAX_TICK_MS - ratio * (MAX_TICK_MS - MIN_TICK_MS)
      const charsToEmit = queue.length > BURST_THRESHOLD
        ? Math.min(BURST_CHARS, queue.length)
        : 1

      typewriterTimerRef.current = window.setTimeout(() => {
        const current = typewriterQueueRef.current
        if (!current) {
          typewriterTimerRef.current = null
          return
        }
        const emitCount = Math.min(charsToEmit, current.length)
        typewriterQueueRef.current = current.slice(emitCount)
        appendAssistantChunk(current.slice(0, emitCount))
        scheduleNextTick()
      }, tickMs)
    }

    scheduleNextTick()
  }, [appendAssistantChunk])

  const enqueueTypewriterText = useCallback((text: string) => {
    typewriterQueueRef.current += text
    startTypewriter()
  }, [startTypewriter])

  useEffect(() => {
    return () => stopTypewriter()
  }, [stopTypewriter])

  // -- cleanup & finalize -----------------------------------------------------
  const cleanup = useCallback(() => {
    stopTypewriter()
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
  }, [stopTypewriter])

  const finalizeAssistant = useCallback(() => {
    const assistantId = assistantIdRef.current
    if (!assistantId) return

    flushTypewriter()

    setMessages(prev =>
      prev.map(message => {
        if (message.id !== assistantId) return message
        return {
          ...message,
          parts: message.parts.map(part =>
            part.type === 'text'
              ? { ...part, state: 'done' }
              : part,
          ),
        }
      }),
    )
  }, [flushTypewriter, setMessages])

  // -- OpenAI SSE stream reader -----------------------------------------------

  const readOpenAiSseStream = useCallback(async (
    response: Response,
    onContent: (content: string, raw: string) => void,
    signal: AbortSignal,
  ) => {
    const reader = response.body?.getReader()
    if (!reader) {
      const text = await response.text()
      for (const block of text.split('\n\n')) {
        const dataLine = block.split('\n').find(l => l.startsWith('data:'))
        if (!dataLine) continue
        const payload = dataLine.slice(5).trim()
        if (payload === '[DONE]') return
        try {
          const parsed = JSON.parse(payload)
          const content = parsed.choices?.[0]?.delta?.content
          if (content) onContent(content, payload)
        } catch { /* skip unparseable */ }
      }
      return
    }

    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (!signal.aborted) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        const parts = buffer.split('\n\n')
        buffer = parts.pop() || ''

        for (const block of parts) {
          for (const line of block.split('\n')) {
            if (!line.startsWith('data:')) continue
            const payload = line.slice(5).trim()
            if (payload === '[DONE]') return
            try {
              const parsed = JSON.parse(payload)
              const content = parsed.choices?.[0]?.delta?.content
              if (content) onContent(content, payload)
            } catch { /* skip unparseable */ }
          }
        }
      }

      if (buffer.trim()) {
        for (const line of buffer.split('\n')) {
          if (!line.startsWith('data:')) continue
          const payload = line.slice(5).trim()
          if (payload === '[DONE]') return
          try {
            const parsed = JSON.parse(payload)
            const content = parsed.choices?.[0]?.delta?.content
            if (content) onContent(content, payload)
          } catch { /* skip unparseable */ }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }, [])

  // -- submitPrompt -----------------------------------------------------------

  const submitPrompt = useCallback(async (prompt: string) => {
    const trimmed = prompt.trim()
    if (!trimmed) return

    cleanup()
    setStatus('submitting')
    setError(null)
    setTokenCount(0)
    setSseChunks([])
    const now = new Date()
    setSubmittedAt(now)
    setResponseHeadersAt(null)
    setFirstTokenAt(null)
    setFinishedAt(null)
    firstTokenRecordedRef.current = false

    const userMessage = buildUserMessage(trimmed)
    const assistantId = generateId()
    assistantIdRef.current = assistantId
    const assistantMessage = buildAssistantMessage(assistantId)

    const history = [...messages, userMessage]
    const chatMessages = asChatMessages(history)
    setMessages(history.concat(assistantMessage))

    const abortController = new AbortController()
    abortRef.current = abortController

    try {
      const response = await streamDirectChat(chatMessages, {
        signal: abortController.signal,
      })
      setResponseHeadersAt(new Date())
      setStatus('streaming')

      await readOpenAiSseStream(
        response,
        (content, raw) => {
          const receivedAt = new Date()

          if (!firstTokenRecordedRef.current) {
            firstTokenRecordedRef.current = true
            setFirstTokenAt(receivedAt)
          }

          setTokenCount(prev => prev + 1)
          setSseChunks(prev => [...prev, { receivedAt, content, raw }])
          enqueueTypewriterText(content)
        },
        abortController.signal,
      )

      finalizeAssistant()
      setFinishedAt(new Date())
      setStatus('success')
    } catch (err) {
      if (abortController.signal.aborted) return
      cleanup()
      finalizeAssistant()
      const message = err instanceof Error ? err.message : 'Unknown direct chat error'
      setError(message)
      setStatus('error')
    }
  }, [enqueueTypewriterText, cleanup, finalizeAssistant, messages, setMessages, readOpenAiSseStream])

  // -- reset ------------------------------------------------------------------

  const reset = useCallback(() => {
    cleanup()
    typewriterQueueRef.current = ''
    assistantIdRef.current = null
    firstTokenRecordedRef.current = false
    setMessages([])
    setStatus('idle')
    setError(null)
    setTokenCount(0)
    setSseChunks([])
    setSubmittedAt(null)
    setResponseHeadersAt(null)
    setFirstTokenAt(null)
    setFinishedAt(null)
  }, [cleanup, setMessages])

  // -- derived state ----------------------------------------------------------

  const isBusy = useMemo(() => status === 'submitting' || status === 'streaming', [status])
  const isStreaming = useMemo(() => isBusy && tokenCount > 0, [isBusy, tokenCount])

  const latencyBreakdown = useMemo<DirectLatencyBreakdown>(() => {
    const firstTokenToCompleteMs = diffMs(firstTokenAt, finishedAt)
    const streamDurationSec = firstTokenToCompleteMs != null ? firstTokenToCompleteMs / 1000 : null

    return {
      submitToResponseHeadersMs: diffMs(submittedAt, responseHeadersAt),
      submitToFirstTokenMs: diffMs(submittedAt, firstTokenAt),
      submitToCompleteMs: diffMs(submittedAt, finishedAt),
      firstTokenToCompleteMs,
      tokenCount,
      tokensPerSecond: streamDurationSec && streamDurationSec > 0 && tokenCount > 1
        ? (tokenCount - 1) / streamDurationSec
        : null,
    }
  }, [submittedAt, responseHeadersAt, firstTokenAt, finishedAt, tokenCount])

  return {
    messages,
    submitPrompt,
    reset,
    isBusy,
    isStreaming,
    status,
    error,
    tokenCount,
    submittedAt,
    responseHeadersAt,
    firstTokenAt,
    finishedAt,
    latencyBreakdown,
    sseChunks,
  }
}
