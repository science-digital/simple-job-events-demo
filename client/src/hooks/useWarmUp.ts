import { useCallback, useMemo, useRef, useState } from 'react'
import { createWarmJob, readJob, subscribeToJobEvents } from '@/lib/api'
import type { JobEvent } from '@/types/events'

export type WarmUpStatus = 'idle' | 'warming' | 'warm' | 'error'

export interface UseWarmUpReturn {
  /** Fire a warm-up job to prime the service container */
  warmUp: () => Promise<void>
  /** Current warm-up status */
  status: WarmUpStatus
  /** Job ID of the warm-up job (if any) */
  jobId: string | null
  /** Error message (if any) */
  error: string | null
  /** Events received from the warm-up job */
  events: JobEvent[]
  /** Timestamp when the warm-up was submitted */
  submittedAt: Date | null
  /** Timestamp when the job entered executing state */
  executingAt: Date | null
  /** Timestamp when the warm-up completed */
  finishedAt: Date | null
  /** Submit to executing delta in ms */
  submitToExecuteMs: number | null
  /** Submit to complete delta in ms */
  submitToCompleteMs: number | null
}

function diffMs(from: Date | null, to: Date | null): number | null {
  if (!from || !to) return null
  return Math.max(0, to.getTime() - from.getTime())
}

export function useWarmUp(): UseWarmUpReturn {
  const [status, setStatus] = useState<WarmUpStatus>('idle')
  const [jobId, setJobId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [events, setEvents] = useState<JobEvent[]>([])
  const [submittedAt, setSubmittedAt] = useState<Date | null>(null)
  const [executingAt, setExecutingAt] = useState<Date | null>(null)
  const [finishedAt, setFinishedAt] = useState<Date | null>(null)

  const abortRef = useRef<(() => void) | null>(null)
  const pollRef = useRef<number | null>(null)

  const cleanup = useCallback(() => {
    if (abortRef.current) {
      abortRef.current()
      abortRef.current = null
    }
    if (pollRef.current != null) {
      window.clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const warmUp = useCallback(async () => {
    cleanup()
    setStatus('warming')
    setError(null)
    setJobId(null)
    setEvents([])
    setSubmittedAt(new Date())
    setExecutingAt(null)
    setFinishedAt(null)

    try {
      const createdJobId = await createWarmJob()
      setJobId(createdJobId)

      abortRef.current = subscribeToJobEvents(
        createdJobId,
        (event) => {
          setEvents(prev => [...prev, event])
        },
        () => {
          // connected
        },
        (streamError) => {
          setError(streamError.message)
          setStatus('error')
        },
      )

      const terminalSuccess = new Set(['success', 'complete', 'succeeded'])
      const terminalError = new Set(['error', 'failed'])

      const pollOnce = async () => {
        const job = await readJob(createdJobId)
        const normalized = String(job.status || '').toLowerCase()

        if (normalized === 'running' || normalized === 'executing') {
          setExecutingAt(prev => prev ?? new Date())
        }

        if (terminalSuccess.has(normalized)) {
          cleanup()
          setFinishedAt(prev => prev ?? new Date())
          setStatus('warm')
          return
        }
        if (terminalError.has(normalized)) {
          cleanup()
          setFinishedAt(prev => prev ?? new Date())
          setStatus('error')
          setError(job.errorMessage || `Warm-up job ${normalized}`)
          return
        }
      }

      await pollOnce()
      pollRef.current = window.setInterval(() => {
        void pollOnce().catch(pollError => {
          const message = pollError instanceof Error ? pollError.message : String(pollError)
          setError(message)
          setStatus('error')
          cleanup()
        })
      }, 750)
    } catch (submitError) {
      cleanup()
      const message = submitError instanceof Error ? submitError.message : 'Unknown warm-up error'
      setError(message)
      setStatus('error')
    }
  }, [cleanup])

  const submitToExecuteMs = useMemo(() => diffMs(submittedAt, executingAt), [submittedAt, executingAt])
  const submitToCompleteMs = useMemo(() => diffMs(submittedAt, finishedAt), [submittedAt, finishedAt])

  return {
    warmUp,
    status,
    jobId,
    error,
    events,
    submittedAt,
    executingAt,
    finishedAt,
    submitToExecuteMs,
    submitToCompleteMs,
  }
}
