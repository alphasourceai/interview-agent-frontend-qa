import React, { useEffect, useRef, useCallback, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import DailyIframe from '@daily-co/daily-js';
import {
  DailyAudioTrack,
  DailyProvider,
  DailyVideo,
  useDaily,
  useDailyEvent,
  useLocalSessionId,
  useParticipantIds,
} from '@daily-co/daily-react';

function joinUrl(base, path) {
  if (!base) return path;
  if (base.endsWith('/') && path.startsWith('/')) return base.slice(0, -1) + path;
  if (!base.endsWith('/') && !path.startsWith('/')) return base + '/' + path;
  return base + path;
}

const BK = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_BACKEND_URL)
  ? String(import.meta.env.VITE_BACKEND_URL).replace(/\/+$/, '')
  : '';
const SOFT_CLOSE_TEXT = 'We are approaching our time limit for this interview. Thank you for your time today. Our session will end momentarily.';
const SOFT_CLOSE_THRESHOLD_SECONDS = 10;
const SOFT_CLOSE_END_DELAY_MS = 7000;
const SOFT_CLOSE_MIN_PLAY_MS = 2500;
const STARTUP_REMOTE_TIMEOUT_MS = 12000;
const STARTUP_REPLICA_ACTIVITY_TIMEOUT_MS = 5000;

let __dailyCallObject = null;

function InterviewCviRoom({ conversationUrl, conversationId, interviewId, roleToken, maxInterviewMinutes, onDone, debugCvi }) {
  const daily = useDaily();
  const localSessionId = useLocalSessionId();
  const remoteParticipantIds = useParticipantIds({ filter: 'remote' });
  const remoteSessionId = remoteParticipantIds[0] || null;
  const joinedRef = useRef(false);
  const endTriggeredRef = useRef(false);
  const closeEndTimerRef = useRef(null);
  const softCloseEndTimerRef = useRef(null);
  const candidateSpeakingRef = useRef(false);
  const replicaSpeakingRef = useRef(false);
  const softCloseSentRef = useRef(false);
  const softClosePendingRef = useRef(false);
  const softCloseSentAtRef = useRef(0);
  const softCloseReplicaSpokeRef = useRef(false);
  const startupRemoteSeenRef = useRef(false);
  const startupReplicaSpeakingSeenRef = useRef(false);
  const startupReplicaUtteranceSeenRef = useRef(false);
  const startupRecoveryAttemptedRef = useRef(false);
  const startupRecoveryInFlightRef = useRef(false);
  const startupRemoteTimerRef = useRef(null);
  const startupReplicaTimerRef = useRef(null);
  const prevRemoteSessionIdRef = useRef(null);
  const [secondsRemaining, setSecondsRemaining] = useState(null);
  const [isEnding, setIsEnding] = useState(false);
  const [fallbackMaxInterviewMinutes, setFallbackMaxInterviewMinutes] = useState(null);
  const [meetingState, setMeetingState] = useState('');
  const [debugTick, setDebugTick] = useState(0);
  const [startupStatus, setStartupStatus] = useState('');
  const hasNavMaxInterviewMinutes = Number.isInteger(maxInterviewMinutes) && maxInterviewMinutes > 0;
  const effectiveMaxInterviewMinutes = hasNavMaxInterviewMinutes ? maxInterviewMinutes : fallbackMaxInterviewMinutes;

  const logDailyDiag = useCallback((name, payload) => {
    console.log(`[CVI] ${name}`, {
      conversationId,
      interviewId,
      ...payload,
    });
  }, [conversationId, interviewId]);

  const clearStartupWatchdogTimers = useCallback(() => {
    if (startupRemoteTimerRef.current) {
      clearTimeout(startupRemoteTimerRef.current);
      startupRemoteTimerRef.current = null;
    }
    if (startupReplicaTimerRef.current) {
      clearTimeout(startupReplicaTimerRef.current);
      startupReplicaTimerRef.current = null;
    }
  }, []);

  const handleStartupFailure = useCallback(async (reason, extra = {}) => {
    if (endTriggeredRef.current) return;
    if (startupReplicaSpeakingSeenRef.current || startupReplicaUtteranceSeenRef.current) return;

    clearStartupWatchdogTimers();
    logDailyDiag('startup-failure', {
      reason,
      recoveryAttempted: startupRecoveryAttemptedRef.current,
      ...extra,
    });

    if (!startupRecoveryAttemptedRef.current) {
      startupRecoveryAttemptedRef.current = true;
      setStartupStatus('Interviewer is reconnecting…');
      logDailyDiag('startup-recovery-attempt', { reason, ...extra });
      joinedRef.current = false;
      startupRecoveryInFlightRef.current = true;
      try {
        await daily?.leave?.().catch(() => {});
      } catch {}
      if (!daily || !conversationUrl || endTriggeredRef.current) {
        startupRecoveryInFlightRef.current = false;
        return;
      }
      startupRemoteSeenRef.current = false;
      startupReplicaSpeakingSeenRef.current = false;
      startupReplicaUtteranceSeenRef.current = false;
      setMeetingState('rejoining');
      joinedRef.current = true;
      startupRemoteTimerRef.current = setTimeout(() => {
        startupRemoteTimerRef.current = null;
        if (startupRemoteSeenRef.current || endTriggeredRef.current) return;
        void handleStartupFailure('no_remote_participant_after_recovery_timeout');
      }, STARTUP_REMOTE_TIMEOUT_MS);
      logDailyDiag('join-attempt', { source: 'startup-recovery', conversationUrl });
      daily.join({
        url: conversationUrl,
        userName: 'Candidate',
        startVideoOff: false,
        startAudioOff: false,
      }).catch((error) => {
        logDailyDiag('join-error', {
          source: 'startup-recovery',
          error: error?.message || String(error || 'join_failed'),
        });
        startupRecoveryInFlightRef.current = false;
        clearStartupWatchdogTimers();
        joinedRef.current = false;
        setStartupStatus('');
        toast.error('Interview did not start correctly. Please relaunch and try again.');
        onDone();
      });
      return;
    }

    setStartupStatus('');
    startupRecoveryInFlightRef.current = false;
    toast.error('Interview did not start correctly. Please relaunch and try again.');
    joinedRef.current = false;
    try {
      await daily?.leave?.().catch(() => {});
    } catch {}
    try { daily?.destroy?.() } catch {}
    onDone();
  }, [clearStartupWatchdogTimers, conversationUrl, daily, logDailyDiag, onDone]);

  useDailyEvent('left-meeting', useCallback((event) => {
    if (startupRecoveryInFlightRef.current) {
      logDailyDiag('left-meeting-suppressed-for-recovery', { event });
      return;
    }
    onDone();
  }, [onDone, logDailyDiag]));
  useDailyEvent('joining-meeting', useCallback((event) => {
    setMeetingState('joining-meeting');
    logDailyDiag('joining-meeting', { event });
  }, [logDailyDiag]));
  useDailyEvent('joined-meeting', useCallback((event) => {
    if (startupRecoveryInFlightRef.current) {
      startupRecoveryInFlightRef.current = false;
      setStartupStatus('');
      logDailyDiag('startup-recovery-complete', { event });
    }
    setMeetingState('joined-meeting');
    logDailyDiag('joined-meeting', { event });
  }, [logDailyDiag]));
  useDailyEvent('left-meeting', useCallback((event) => {
    setMeetingState('left-meeting');
    logDailyDiag('left-meeting', { event });
  }, [logDailyDiag]));
  useDailyEvent('meeting-state', useCallback((event) => {
    const nextState = String(event?.meetingState ?? event?.state ?? event?.action ?? '');
    if (nextState) setMeetingState(nextState);
    logDailyDiag('meeting-state', { meetingState: nextState || null, event });
  }, [logDailyDiag]));
  useDailyEvent('participant-joined', useCallback((event) => {
    logDailyDiag('participant-joined', {
      sessionId: event?.participant?.session_id ?? null,
      userName: event?.participant?.user_name ?? null,
      event,
    });
  }, [logDailyDiag]));
  useDailyEvent('participant-left', useCallback((event) => {
    logDailyDiag('participant-left', {
      sessionId: event?.participant?.session_id ?? null,
      userName: event?.participant?.user_name ?? null,
      event,
    });
  }, [logDailyDiag]));
  useDailyEvent('error', useCallback((event) => {
    logDailyDiag('error', { event });
  }, [logDailyDiag]));
  useDailyEvent('camera-error', useCallback((event) => {
    logDailyDiag('camera-error', { event });
  }, [logDailyDiag]));
  useDailyEvent('load-attempt-failed', useCallback((event) => {
    logDailyDiag('load-attempt-failed', { event });
  }, [logDailyDiag]));

  useEffect(() => {
    try {
      const currentState = daily?.meetingState?.();
      if (typeof currentState === 'string' && currentState) {
        setMeetingState(currentState);
      }
    } catch {}
  }, [daily]);

  useEffect(() => {
    if (!debugCvi) return undefined;
    const t = setInterval(() => {
      setDebugTick((v) => v + 1);
    }, 400);
    return () => clearInterval(t);
  }, [debugCvi]);

  useEffect(() => {
    if (!daily || !conversationUrl || joinedRef.current) return;
    joinedRef.current = true;
    startupRecoveryInFlightRef.current = false;
    startupRemoteSeenRef.current = false;
    startupReplicaSpeakingSeenRef.current = false;
    startupReplicaUtteranceSeenRef.current = false;
    setStartupStatus('');
    clearStartupWatchdogTimers();
    startupRemoteTimerRef.current = setTimeout(() => {
      startupRemoteTimerRef.current = null;
      if (startupRemoteSeenRef.current || endTriggeredRef.current) return;
      void handleStartupFailure('no_remote_participant_timeout');
    }, STARTUP_REMOTE_TIMEOUT_MS);
    setMeetingState('joining-meeting');
    logDailyDiag('join-attempt', { conversationUrl });
    daily.join({
      url: conversationUrl,
      userName: 'Candidate',
      startVideoOff: false,
      startAudioOff: false,
    }).catch((error) => {
      logDailyDiag('join-error', {
        error: error?.message || String(error || 'join_failed'),
      });
      clearStartupWatchdogTimers();
      joinedRef.current = false;
      toast.error('Could not join interview.');
      onDone();
    });
  }, [clearStartupWatchdogTimers, daily, conversationUrl, onDone, logDailyDiag, handleStartupFailure]);

  useEffect(() => {
    const prev = prevRemoteSessionIdRef.current;
    if (!prev && remoteSessionId) {
      startupRemoteSeenRef.current = true;
      if (startupRemoteTimerRef.current) {
        clearTimeout(startupRemoteTimerRef.current);
        startupRemoteTimerRef.current = null;
      }
      if (!startupReplicaSpeakingSeenRef.current && !startupReplicaUtteranceSeenRef.current) {
        if (startupReplicaTimerRef.current) {
          clearTimeout(startupReplicaTimerRef.current);
          startupReplicaTimerRef.current = null;
        }
        startupReplicaTimerRef.current = setTimeout(() => {
          startupReplicaTimerRef.current = null;
          if (endTriggeredRef.current) return;
          if (startupReplicaSpeakingSeenRef.current || startupReplicaUtteranceSeenRef.current) return;
          void handleStartupFailure('remote_connected_without_replica_activity_timeout', { remoteSessionId });
        }, STARTUP_REPLICA_ACTIVITY_TIMEOUT_MS);
      } else {
        setStartupStatus('');
      }
      logDailyDiag('remote-session-available', { remoteSessionId });
    } else if (prev && !remoteSessionId) {
      if (startupReplicaTimerRef.current) {
        clearTimeout(startupReplicaTimerRef.current);
        startupReplicaTimerRef.current = null;
      }
      logDailyDiag('remote-session-disappeared', { previousRemoteSessionId: prev });
    }
    prevRemoteSessionIdRef.current = remoteSessionId;
  }, [handleStartupFailure, remoteSessionId, logDailyDiag]);

  useEffect(() => {
    return () => {
      if (closeEndTimerRef.current) {
        clearTimeout(closeEndTimerRef.current);
        closeEndTimerRef.current = null;
      }
      if (softCloseEndTimerRef.current) {
        clearTimeout(softCloseEndTimerRef.current);
        softCloseEndTimerRef.current = null;
      }
      if (startupRemoteTimerRef.current) {
        clearTimeout(startupRemoteTimerRef.current);
        startupRemoteTimerRef.current = null;
      }
      if (startupReplicaTimerRef.current) {
        clearTimeout(startupReplicaTimerRef.current);
        startupReplicaTimerRef.current = null;
      }
    };
  }, []);

  const endInterview = useCallback(async (reason) => {
    if (endTriggeredRef.current) {
      return;
    }
    endTriggeredRef.current = true;
    setIsEnding(true);
    if (closeEndTimerRef.current) {
      clearTimeout(closeEndTimerRef.current);
      closeEndTimerRef.current = null;
    }
    if (softCloseEndTimerRef.current) {
      clearTimeout(softCloseEndTimerRef.current);
      softCloseEndTimerRef.current = null;
    }
    try {
      const resp = await fetch(joinUrl(BK, '/tavus/end-conversation'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_id: conversationId, interview_id: interviewId, role_token: roleToken }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const msg = data?.detail || data?.error || 'Failed to finish interview.';
        const rid = data?.request_id ? ` (request_id: ${data.request_id})` : '';
        toast.error(`${msg}${rid}`);
      }
    } catch (e) {
      toast.error(e?.message || 'Network error ending interview.');
    } finally {
      await daily?.leave?.().catch(() => {})
      try { daily?.destroy?.() } catch {}
      onDone();
    }
  }, [conversationId, daily, onDone]);

  const scheduleSoftCloseEnd = useCallback(() => {
    if (softCloseEndTimerRef.current || endTriggeredRef.current) return;
    softCloseEndTimerRef.current = setTimeout(() => {
      softCloseEndTimerRef.current = null;
      endInterview('time_limit_soft_close');
    }, SOFT_CLOSE_END_DELAY_MS);
  }, [endInterview]);

  const sendSoftClose = useCallback(() => {
    if (softCloseSentRef.current || endTriggeredRef.current) return;
    softCloseSentRef.current = true;
    softClosePendingRef.current = false;
    softCloseSentAtRef.current = Date.now();
    softCloseReplicaSpokeRef.current = false;
    try {
      daily?.sendAppMessage?.({
        event_type: 'conversation.echo',
        eventType: 'conversation.echo',
        properties: {
          text: SOFT_CLOSE_TEXT,
        },
      }, '*');
    } catch {}
    scheduleSoftCloseEnd();
  }, [daily, scheduleSoftCloseEnd]);

  useEffect(() => {
    if (!conversationUrl || !Number.isInteger(effectiveMaxInterviewMinutes) || effectiveMaxInterviewMinutes <= 0) {
      setSecondsRemaining(null);
      return;
    }

    const totalSeconds = effectiveMaxInterviewMinutes * 60;
    const startedAt = Date.now();
    let timer = null;

    const tick = () => {
      const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
      const nextRemaining = Math.max(0, totalSeconds - elapsedSeconds);
      setSecondsRemaining(nextRemaining);
      if (nextRemaining <= 0) {
        if (timer) {
          clearInterval(timer);
          timer = null;
        }
        endInterview('time_limit');
      }
    };

    tick();
    timer = setInterval(tick, 1000);

    return () => {
      if (timer) clearInterval(timer);
    };
  }, [conversationUrl, effectiveMaxInterviewMinutes, endInterview]);

  useEffect(() => {
    if (typeof secondsRemaining !== 'number') return;
    if (secondsRemaining > SOFT_CLOSE_THRESHOLD_SECONDS) return;
    if (endTriggeredRef.current || softCloseSentRef.current) return;
    if (candidateSpeakingRef.current) {
      softClosePendingRef.current = true;
      return;
    }
    sendSoftClose();
  }, [secondsRemaining, sendSoftClose]);

  const onAppMessage = useCallback((event) => {
    const data = event?.data ?? event?.message ?? event?.payload ?? event;
    const rawEventType = data?.eventType ?? data?.event_type ?? null;
    logDailyDiag('app-message', {
      eventType: rawEventType,
      role: data?.properties?.role ?? null,
      toolName: data?.name ?? data?.tool?.name ?? data?.tool_name ?? data?.function?.name ?? null,
      hasSpeech: typeof data?.properties?.speech === 'string' && data.properties.speech.length > 0,
      speechLength: typeof data?.properties?.speech === 'string' ? data.properties.speech.length : 0,
    });
    const eventType = String(data?.eventType ?? data?.event_type ?? '').toLowerCase();

    if (eventType === 'conversation.user.started_speaking') {
      candidateSpeakingRef.current = true;
    } else if (eventType === 'conversation.user.stopped_speaking') {
      candidateSpeakingRef.current = false;
      if (
        softClosePendingRef.current &&
        !softCloseSentRef.current &&
        !endTriggeredRef.current
      ) {
        sendSoftClose();
      }
    } else if (eventType === 'conversation.replica.started_speaking') {
      replicaSpeakingRef.current = true;
      startupReplicaSpeakingSeenRef.current = true;
      clearStartupWatchdogTimers();
      setStartupStatus('');
      if (softCloseSentRef.current) {
        softCloseReplicaSpokeRef.current = true;
      }
    } else if (eventType === 'conversation.replica.stopped_speaking') {
      replicaSpeakingRef.current = false;
      if (
        softCloseSentRef.current &&
        softCloseReplicaSpokeRef.current &&
        !endTriggeredRef.current
      ) {
        const elapsed = Date.now() - softCloseSentAtRef.current;
        if (elapsed >= SOFT_CLOSE_MIN_PLAY_MS) {
          if (softCloseEndTimerRef.current) {
            clearTimeout(softCloseEndTimerRef.current);
            softCloseEndTimerRef.current = null;
          }
          endInterview('time_limit_soft_close');
        }
      }
    }

    const et = String(data?.event_type || data?.eventType || '').toLowerCase();
    const role = String(data?.properties?.role || '').toLowerCase();
    if (et === 'conversation.utterance' && role === 'replica') {
      startupReplicaUtteranceSeenRef.current = true;
      clearStartupWatchdogTimers();
      setStartupStatus('');
    }
    const speech = String(data?.properties?.speech || '');
    const s = speech.toLowerCase();
    const hasWrapUp =
      s.includes('concludes the interview') ||
      s.includes('that concludes') ||
      s.includes('wrap up');
    const hasEnding =
      s.includes('ending the session') ||
      s.includes('end the session') ||
      s.includes('ending the interview') ||
      s.includes('end the interview');
    if (
      et === 'conversation.utterance' &&
      role === 'replica' &&
      hasWrapUp &&
      hasEnding
    ) {
      if (!closeEndTimerRef.current) {
        closeEndTimerRef.current = setTimeout(() => {
          closeEndTimerRef.current = null;
          endInterview('closing_utterance');
        }, 5500);
      }
      return;
    }
    if (eventType !== 'conversation.tool_call' && eventType !== 'conversation.toolcall') return;

    const toolName = String(
      data?.name ??
      data?.tool?.name ??
      data?.tool_name ??
      data?.tool?.function?.name ??
      data?.function?.name ??
      ''
    ).trim().toLowerCase();

    if (toolName === 'end_interview') {
      endInterview('tool_call');
    }
  }, [clearStartupWatchdogTimers, endInterview, sendSoftClose, logDailyDiag]);

  useDailyEvent('app-message', onAppMessage);

  useEffect(() => {
    if (!interviewId || !roleToken) return;
    if (!hasNavMaxInterviewMinutes) {
      setFallbackMaxInterviewMinutes(null);
    }

    let active = true;
    let timer = null;

    const pollStatus = async () => {
      try {
        const qs = new URLSearchParams({
          interview_id: String(interviewId),
          role_token: String(roleToken)
        });
        const resp = await fetch(joinUrl(BK, `/public/interview-status?${qs.toString()}`));
        const data = await resp.json().catch(() => ({}));
        if (!active) return;
        if (resp.ok && !hasNavMaxInterviewMinutes) {
          const raw = Number(data?.max_interview_minutes);
          const parsed = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : null;
          if (parsed !== null) {
            setFallbackMaxInterviewMinutes((prev) => (prev === parsed ? prev : parsed));
          }
        }
        const status = String(data?.status || '');
        if (resp.ok && (status === 'ending_requested' || status === 'Ended')) {
          active = false;
          if (timer) clearInterval(timer);
          endInterview('polling');
        }
      } catch {}
    };

    pollStatus();
    timer = setInterval(pollStatus, 2500);

    return () => {
      active = false;
      if (timer) clearInterval(timer);
    };
  }, [interviewId, roleToken, endInterview, hasNavMaxInterviewMinutes]);

  const showTimerPill =
    !isEnding &&
    Number.isInteger(effectiveMaxInterviewMinutes) &&
    effectiveMaxInterviewMinutes > 0 &&
    typeof secondsRemaining === 'number' &&
    secondsRemaining > 0;
  const timerMinutes = showTimerPill ? Math.floor(secondsRemaining / 60) : 0;
  const timerSeconds = showTimerPill ? secondsRemaining % 60 : 0;
  const timerLabel = showTimerPill
    ? `${String(timerMinutes).padStart(2, '0')}:${String(timerSeconds).padStart(2, '0')}`
    : '';

  return (
    <div className="tavus-stage" style={{ width: '100%' }}>
      <div
        className="tavus-slot"
        aria-label="Interview video area"
        style={{
          position: 'relative',
          width: 1200,
          height: 690,
          borderRadius: 16,
          border: '1px solid rgba(255,255,255,0.1)',
          background: 'rgba(0,0,0,0.85)',
          overflow: 'hidden',
          margin: '0 auto',
        }}
      >
        {remoteSessionId ? (
          <>
            <DailyVideo
              sessionId={remoteSessionId}
              type="video"
              autoPlay
              playsInline
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', background: '#000' }}
            />
            <DailyAudioTrack sessionId={remoteSessionId} type="audio" autoPlay />
          </>
        ) : (
          <div style={{ height: '100%', display: 'grid', placeItems: 'center', color: 'rgba(255,255,255,0.8)' }}>
            Connecting interview…
          </div>
        )}
        {localSessionId && (
          <div style={{ position: 'absolute', right: 16, bottom: 16, width: 180, height: 120, borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.15)', background: '#111827' }}>
            <DailyVideo
              sessionId={localSessionId}
              type="video"
              autoPlay
              playsInline
              muted
              mirror
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', background: '#111827' }}
            />
          </div>
        )}
        {showTimerPill && (
          <div
            aria-label="Time remaining"
            style={{
              position: 'absolute',
              right: 12,
              top: 12,
              padding: '6px 10px',
              borderRadius: 999,
              background: secondsRemaining <= 60
                ? 'rgba(127,29,29,0.9)'
                : secondsRemaining <= 120
                  ? 'rgba(120,53,15,0.9)'
                  : 'rgba(17,24,39,0.72)',
              border: secondsRemaining <= 60
                ? '1px solid rgba(248,113,113,0.85)'
                : secondsRemaining <= 120
                  ? '1px solid rgba(251,191,36,0.85)'
                  : '1px solid rgba(148,163,184,0.45)',
              color: secondsRemaining <= 60
                ? '#fee2e2'
                : secondsRemaining <= 120
                  ? '#fef3c7'
                  : 'rgba(255,255,255,0.92)',
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: '0.04em',
              zIndex: 5,
              pointerEvents: 'none',
            }}
          >
            {timerLabel}
          </div>
        )}
        {startupStatus && (
          <div
            aria-live="polite"
            style={{
              position: 'absolute',
              left: '50%',
              top: 14,
              transform: 'translateX(-50%)',
              padding: '6px 10px',
              borderRadius: 999,
              background: 'rgba(30,41,59,0.9)',
              border: '1px solid rgba(148,163,184,0.55)',
              color: 'rgba(255,255,255,0.95)',
              fontSize: 12,
              fontWeight: 600,
              zIndex: 6,
              pointerEvents: 'none',
            }}
          >
            {startupStatus}
          </div>
        )}
      </div>
      {debugCvi && (
        <div
          style={{
            position: 'absolute',
            left: 12,
            top: 12,
            zIndex: 6,
            background: 'rgba(17,24,39,0.82)',
            color: '#e5e7eb',
            border: '1px solid rgba(148,163,184,0.45)',
            borderRadius: 10,
            padding: '8px 10px',
            fontSize: 11,
            lineHeight: 1.4,
            maxWidth: 420,
            pointerEvents: 'none',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          }}
        >
          <div>conversationId: {conversationId || '—'}</div>
          <div>interviewId: {interviewId || '—'}</div>
          <div>joinedRef.current: {String(joinedRef.current)}</div>
          <div>remoteSessionId exists: {String(Boolean(remoteSessionId))}</div>
          <div>meetingState: {meetingState || '—'}</div>
          <div>candidateSpeakingRef.current: {String(candidateSpeakingRef.current)}</div>
          <div>replicaSpeakingRef.current: {String(replicaSpeakingRef.current)}</div>
          <div>startupRemoteSeenRef.current: {String(startupRemoteSeenRef.current)}</div>
          <div>startupReplicaSpeakingSeenRef.current: {String(startupReplicaSpeakingSeenRef.current)}</div>
          <div>startupReplicaUtteranceSeenRef.current: {String(startupReplicaUtteranceSeenRef.current)}</div>
          <div>startupRecoveryAttemptedRef.current: {String(startupRecoveryAttemptedRef.current)}</div>
          <div>startupRecoveryInFlightRef.current: {String(startupRecoveryInFlightRef.current)}</div>
          <div>startupStatus: {startupStatus || '—'}</div>
          <div style={{ opacity: 0.65 }}>debugTick: {debugTick}</div>
        </div>
      )}
      <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="button"
          className="btn lilac"
          title="If the interview has ended, click to finish."
          onClick={() => endInterview('manual')}
        >
          Finish interview
        </button>
      </div>
    </div>
  );
}

export default function InterviewCviPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const conversationUrl = String(location.state?.conversation_url || '');
  const conversationId = String(location.state?.conversation_id || '');
  const interviewId = String(location.state?.interview_id || '');
  const roleToken = String(location.state?.role_token || '');
  const maxInterviewMinutesRaw = Number(location.state?.max_interview_minutes);
  const maxInterviewMinutes = Number.isFinite(maxInterviewMinutesRaw) && maxInterviewMinutesRaw > 0
    ? Math.floor(maxInterviewMinutesRaw)
    : null;
  const debugCvi = (
    (typeof import.meta !== 'undefined' && Boolean(import.meta.env?.DEV)) ||
    new URLSearchParams(location.search || '').get('debugCvi') === '1'
  );
  const callObject = conversationUrl
    ? (__dailyCallObject || (__dailyCallObject = DailyIframe.createCallObject()))
    : null;

  const handleDone = useCallback(() => {
    navigate('/interview-complete', { replace: true });
  }, [navigate]);

  useEffect(() => {
    if (!conversationUrl) {
      navigate('/interview-access', { replace: true });
      return;
    }
    return () => {
      callObject.leave().catch(() => {}).finally(() => {
        try { callObject.destroy(); } catch {}
        __dailyCallObject = null;
      });
    };
  }, [conversationUrl, navigate, callObject]);

  if (!conversationUrl) return null;

  return (
    <div className="alpha-theme alpha-page interview-access-page">
      <div className="space-y-6">
        <header className="alpha-header" role="banner" aria-label="AlphaSource site header">
          <div className="inner">
            <div className="brand" aria-label="AlphaSource Home">
              <img src="/alpha-logo.png" alt="AlphaSource" />
            </div>
          </div>
        </header>

        <div className="alpha-hero fullbleed">
          <DailyProvider callObject={callObject}>
            <InterviewCviRoom
              conversationUrl={conversationUrl}
              conversationId={conversationId}
              interviewId={interviewId}
              roleToken={roleToken}
              maxInterviewMinutes={maxInterviewMinutes}
              debugCvi={debugCvi}
              onDone={handleDone}
            />
          </DailyProvider>
        </div>
      </div>
    </div>
  );
}
