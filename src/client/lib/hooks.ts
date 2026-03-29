import {
  KIND_CALL_RING,
  KIND_CALL_UPDATE,
  KIND_CALL_VOICEMAIL,
  KIND_CONVERSATION_ASSIGNED,
  KIND_MESSAGE_NEW,
  KIND_PRESENCE_UPDATE,
} from '@shared/nostr-events'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  type ActiveCall,
  type Conversation,
  type ShiftStatus,
  answerCall as apiAnswerCall,
  hangupCall as apiHangupCall,
  reportCallSpam as apiReportSpam,
  getMyShiftStatus,
  listConversations,
} from './api'
import { useConfig } from './config'
import { useNostrSubscription } from './nostr/hooks'
import type { LlamenosEvent } from './nostr/types'
import { startRinging, stopRinging } from './notifications'
import { useActiveCalls } from './queries/calls'
import { queryKeys } from './queries/keys'
import { acceptCall as acceptWebRtcCall, hasIncomingCall } from './webrtc/manager'

/** All call-related Nostr event kinds */
const CALL_KINDS = [KIND_CALL_RING, KIND_CALL_UPDATE, KIND_CALL_VOICEMAIL, KIND_PRESENCE_UPDATE]

/** All conversation-related Nostr event kinds */
const CONVERSATION_KINDS = [KIND_MESSAGE_NEW, KIND_CONVERSATION_ASSIGNED]

/**
 * Hook to manage real-time call state via Nostr relay + React Query REST polling fallback.
 *
 * Real-time updates arrive via Nostr subscription and are written directly into
 * the React Query cache via `queryClient.setQueryData`. REST polling (every 30s,
 * configured in `useActiveCalls`) acts as a safety net for missed events or relay
 * downtime — no manual `setInterval` needed here.
 *
 * Call actions (answer, hangup, spam) are POST requests to REST endpoints.
 * The server is the sole authority for call state mutations.
 */
export function useCalls() {
  const queryClient = useQueryClient()
  const [currentCall, setCurrentCall] = useState<ActiveCall | null>(null)
  const { currentHubId } = useConfig()
  const currentCallRef = useRef(currentCall)
  currentCallRef.current = currentCall

  // React Query manages the canonical calls list (REST polling every 30s)
  const { data: calls = [] } = useActiveCalls()

  // Clear stale current-call tracking when hub switches
  useEffect(() => {
    setCurrentCall(null)
  }, [currentHubId])

  // Keep currentCall in sync if it disappears from the active list (e.g. after poll refresh)
  useEffect(() => {
    if (currentCall && !calls.some((c) => c.id === currentCall.id)) {
      setCurrentCall(null)
    }
  }, [calls, currentCall])

  // --- Nostr subscription for real-time call events ---
  // Push updates directly into the React Query cache so all consumers stay in sync.
  useNostrSubscription(currentHubId, CALL_KINDS, (_event, content: LlamenosEvent) => {
    switch (content.type) {
      case 'call:ring': {
        const call = content as LlamenosEvent & {
          callId: string
          callerLast4?: string
          startedAt: string
        }
        queryClient.setQueryData<ActiveCall[]>(queryKeys.calls.active(), (prev = []) => {
          if (prev.some((c) => c.id === call.callId)) return prev
          return [
            ...prev,
            {
              id: call.callId,
              callerNumber: '[redacted]',
              callerLast4: call.callerLast4,
              answeredBy: null,
              startedAt: call.startedAt,
              status: 'ringing' as const,
              hasTranscription: false,
              hasVoicemail: false,
            },
          ]
        })
        startRinging('Incoming Call!')
        break
      }
      case 'call:update': {
        const update = content as LlamenosEvent & {
          callId: string
          status: ActiveCall['status']
          answeredBy?: string
        }
        queryClient.setQueryData<ActiveCall[]>(queryKeys.calls.active(), (prev = []) => {
          if (update.status === 'completed') {
            return prev.filter((c) => c.id !== update.callId)
          }
          return prev.map((c) =>
            c.id === update.callId
              ? { ...c, status: update.status, answeredBy: update.answeredBy ?? c.answeredBy }
              : c
          )
        })
        if (update.status === 'in-progress' || update.status === 'completed') {
          stopRinging()
        }
        // Update current call tracking
        if (currentCallRef.current?.id === update.callId) {
          if (update.status === 'completed') {
            setCurrentCall(null)
          } else {
            setCurrentCall((prev) =>
              prev
                ? {
                    ...prev,
                    status: update.status,
                    answeredBy: update.answeredBy ?? prev.answeredBy,
                  }
                : prev
            )
          }
        }
        break
      }
      case 'voicemail:new': {
        const vm = content as LlamenosEvent & { callId: string }
        queryClient.setQueryData<ActiveCall[]>(queryKeys.calls.active(), (prev = []) =>
          prev.filter((c) => c.id !== vm.callId)
        )
        stopRinging()
        break
      }
    }
  })

  // --- Call actions via REST ---

  const answerCall = useCallback(
    async (callId: string) => {
      stopRinging()
      const call = calls.find((c) => c.id === callId)
      if (call) {
        setCurrentCall({ ...call, status: 'in-progress' })
      }
      try {
        // Capture browser call state once to avoid race with state machine transitions
        const isBrowserCall = hasIncomingCall()
        if (isBrowserCall) acceptWebRtcCall()
        await apiAnswerCall(callId, isBrowserCall ? 'browser' : 'phone')
      } catch {
        // Revert optimistic update on failure
        setCurrentCall(null)
      }
    },
    [calls]
  )

  const hangupCall = useCallback(async (callId: string) => {
    setCurrentCall(null)
    try {
      await apiHangupCall(callId)
    } catch {
      // Call may already be ended — safe to ignore
    }
  }, [])

  const reportSpam = useCallback(async (callId: string) => {
    setCurrentCall(null)
    try {
      await apiReportSpam(callId)
    } catch {
      // Report may fail if call already ended — safe to ignore
    }
  }, [])

  return {
    calls,
    currentCall,
    answerCall,
    hangupCall,
    reportSpam,
    ringingCalls: calls.filter((c) => c.status === 'ringing'),
    activeCalls: calls.filter((c) => c.status === 'in-progress'),
  }
}

/**
 * Hook to fetch and periodically refresh the current user's shift status.
 */
export function useShiftStatus() {
  const [status, setStatus] = useState<ShiftStatus>({
    onShift: false,
    currentShift: null,
    nextShift: null,
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true

    function fetch() {
      getMyShiftStatus()
        .then((s) => {
          if (mounted) {
            setStatus(s)
            setLoading(false)
          }
        })
        .catch(() => {
          if (mounted) setLoading(false)
        })
    }

    fetch()
    const interval = setInterval(fetch, 60_000) // Refresh every 60s
    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [])

  return { ...status, loading }
}

/**
 * Hook to manage real-time conversation state via Nostr relay + REST polling.
 *
 * Nostr delivers real-time updates (new messages, assignments, closures).
 * REST polling (every 30s) provides the full conversation list as a fallback.
 */
export function useConversations() {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const { currentHubId } = useConfig()

  // --- Nostr subscription for conversation events ---
  useNostrSubscription(currentHubId, CONVERSATION_KINDS, (_event, content: LlamenosEvent) => {
    switch (content.type) {
      case 'conversation:new': {
        const { conversationId } = content as LlamenosEvent & { conversationId: string }
        // We don't have the full conversation object from the event —
        // trigger a re-fetch on the next poll cycle. For now, add a stub
        // that will be replaced by the poll.
        setConversations((prev) => {
          if (prev.some((c) => c.id === conversationId)) return prev
          // Return unchanged — the poll will pick up the full object
          return prev
        })
        break
      }
      case 'conversation:assigned': {
        const { conversationId, assignedTo } = content as LlamenosEvent & {
          conversationId: string
          assignedTo: string
        }
        setConversations((prev) =>
          prev.map((c) =>
            c.id === conversationId ? { ...c, assignedTo, status: 'active' as const } : c
          )
        )
        break
      }
      case 'conversation:closed': {
        const { conversationId } = content as LlamenosEvent & { conversationId: string }
        setConversations((prev) => prev.filter((c) => c.id !== conversationId))
        break
      }
      case 'message:new': {
        const { conversationId } = content as LlamenosEvent & { conversationId: string }
        setConversations((prev) =>
          prev.map((c) =>
            c.id === conversationId
              ? { ...c, lastMessageAt: new Date().toISOString(), messageCount: c.messageCount + 1 }
              : c
          )
        )
        break
      }
    }
  })

  // --- REST polling fallback (every 30s) ---
  useEffect(() => {
    let mounted = true
    const poll = () => {
      listConversations()
        .then(({ conversations: polled }) => {
          if (mounted) setConversations(polled)
        })
        .catch(() => {})
    }
    poll()
    const interval = setInterval(poll, 30_000)
    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [])

  const waitingConversations = conversations.filter((c) => c.status === 'waiting')
  const activeConversations = conversations.filter((c) => c.status === 'active')

  return {
    conversations,
    waitingConversations,
    activeConversations,
  }
}

/**
 * Hook for a call timer.
 */
export function useCallTimer(startedAt: string | null) {
  const [elapsed, setElapsed] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined)

  useEffect(() => {
    if (!startedAt) {
      setElapsed(0)
      return
    }

    const start = new Date(startedAt).getTime()
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000))
    tick()
    intervalRef.current = setInterval(tick, 1000)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [startedAt])

  const minutes = Math.floor(elapsed / 60)
  const seconds = elapsed % 60
  const formatted = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`

  return { elapsed, formatted }
}
