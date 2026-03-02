import React, { useEffect, useRef, useCallback } from 'react';
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

function InterviewCviRoom({ conversationUrl, conversationId, interviewId, roleToken, onDone }) {
  const daily = useDaily();
  const localSessionId = useLocalSessionId();
  const remoteParticipantIds = useParticipantIds({ filter: 'remote' });
  const remoteSessionId = remoteParticipantIds[0] || null;
  const joinedRef = useRef(false);

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
          onDone();
        }
      } catch {}
    };

    pollStatus();
    timer = setInterval(pollStatus, 2500);

    return () => {
      active = false;
      if (timer) clearInterval(timer);
    };
  }, [interviewId, roleToken, onDone]);

  const finishInterview = useCallback(async () => {
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
      onDone();
    }
  }, [conversationId, onDone]);

  return (
    <div style={{ minHeight: '100vh', background: '#081225', color: '#fff', padding: 16 }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ position: 'relative', background: '#000', borderRadius: 16, overflow: 'hidden', minHeight: 520 }}>
          {remoteSessionId ? (
            <>
              <DailyVideo
                sessionId={remoteSessionId}
                type="video"
                autoPlay
                playsInline
                style={{ width: '100%', height: 520, objectFit: 'cover', display: 'block', background: '#000' }}
              />
              <DailyAudioTrack sessionId={remoteSessionId} type="audio" autoPlay />
            </>
          ) : (
            <div style={{ height: 520, display: 'grid', placeItems: 'center', color: 'rgba(255,255,255,0.8)' }}>
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
        </div>
        <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="btn lilac"
            title="If the interview has ended, click to finish."
            onClick={finishInterview}
          >
            Finish interview
          </button>
        </div>
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
    <DailyProvider callObject={callObject}>
      <InterviewCviRoom
        conversationUrl={conversationUrl}
        conversationId={conversationId}
        interviewId={interviewId}
        roleToken={roleToken}
        onDone={handleDone}
      />
    </DailyProvider>
  );
}
