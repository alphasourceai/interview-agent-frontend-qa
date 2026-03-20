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

let __dailyCallObject = null;

function InterviewCviRoom({ conversationUrl, conversationId, interviewId, roleToken, maxInterviewMinutes, onDone }) {
  const daily = useDaily();
  const localSessionId = useLocalSessionId();
  const remoteParticipantIds = useParticipantIds({ filter: 'remote' });
  const remoteSessionId = remoteParticipantIds[0] || null;
  const joinedRef = useRef(false);
  const endTriggeredRef = useRef(false);
  const closeEndTimerRef = useRef(null);
  const [secondsRemaining, setSecondsRemaining] = useState(null);
  const [isEnding, setIsEnding] = useState(false);

  useDailyEvent('left-meeting', onDone);

  useEffect(() => {
    if (!daily || !conversationUrl || joinedRef.current) return;
    joinedRef.current = true;
    daily.join({
      url: conversationUrl,
      userName: 'Candidate',
      startVideoOff: false,
      startAudioOff: false,
    }).catch(() => {
      joinedRef.current = false;
      toast.error('Could not join interview.');
      onDone();
    });
  }, [daily, conversationUrl, onDone]);

  useEffect(() => {
    return () => {
      if (closeEndTimerRef.current) {
        clearTimeout(closeEndTimerRef.current);
        closeEndTimerRef.current = null;
      }
    };
  }, []);

  const endInterview = useCallback(async (reason) => {
    if (endTriggeredRef.current) {
      return;
    }
    endTriggeredRef.current = true;
    setIsEnding(true);
    try {
      const resp = await fetch(joinUrl(BK, '/tavus/end-conversation'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_id: conversationId }),
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

  useEffect(() => {
    if (!conversationUrl || !Number.isInteger(maxInterviewMinutes) || maxInterviewMinutes <= 0) {
      setSecondsRemaining(null);
      return;
    }

    const totalSeconds = maxInterviewMinutes * 60;
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
  }, [conversationUrl, maxInterviewMinutes, endInterview]);

  const onAppMessage = useCallback((event) => {
    const data = event?.data ?? event?.message ?? event?.payload ?? event;
    const et = String(data?.event_type || '').toLowerCase();
    const role = String(data?.properties?.role || '').toLowerCase();
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

    const eventType = String(data?.eventType ?? data?.event_type ?? '').toLowerCase();
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
  }, [endInterview]);

  useDailyEvent('app-message', onAppMessage);

  useEffect(() => {
    if (!interviewId || !roleToken) return;

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
  }, [interviewId, roleToken, endInterview]);

  const showTimeWarning =
    !isEnding &&
    typeof secondsRemaining === 'number' &&
    secondsRemaining > 0 &&
    secondsRemaining <= 120;
  const warningMinutes = showTimeWarning ? Math.ceil(secondsRemaining / 60) : null;

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
        {showTimeWarning && (
          <div
            role="status"
            aria-live="polite"
            style={{
              position: 'absolute',
              left: 12,
              right: 12,
              top: 12,
              padding: '10px 12px',
              borderRadius: 12,
              background: 'rgba(127,29,29,0.92)',
              border: '1px solid rgba(248,113,113,0.85)',
              color: '#fee2e2',
              fontSize: 14,
              textAlign: 'center',
              zIndex: 5,
              pointerEvents: 'none',
            }}
          >
            {`This interview will end in ${warningMinutes} minute(s). Please finish your current response.`}
          </div>
        )}
      </div>
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
              onDone={handleDone}
            />
          </DailyProvider>
        </div>
      </div>
    </div>
  );
}
