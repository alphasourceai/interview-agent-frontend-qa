// src/pages/InterviewAccessPage.jsx
// One-page intake → OTP → Start Interview (embedded tall)
// Uses VITE_BACKEND_URL for API calls

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import InterviewAccessForm from '../components/InterviewAccessForm';
import '../styles/agentTheme.css';

function joinUrl(base, path) {
  if (!base) return path;
  if (base.endsWith('/') && path.startsWith('/')) return base.slice(0, -1) + path;
  if (!base.endsWith('/') && !path.startsWith('/')) return base + '/' + path;
  return base + path;
}

const BK = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_BACKEND_URL)
  ? String(import.meta.env.VITE_BACKEND_URL).replace(/\/+$/, '')
  : '';

function isEmailContact(s) {
  const v = String(s || '').trim();
  return v.includes('@') && v.includes('.');
}

function extractPhoneDigits(s) {
  const raw = String(s || '').replace(/\D/g, '');
  if (raw.length === 10) return raw;
  if (raw.length === 11 && raw.startsWith('1')) return raw.slice(1);
  return null;
}

function formatPhone(d10) {
  const s = String(d10 || '');
  if (s.length !== 10) return s;
  return `(${s.slice(0, 3)}) ${s.slice(3, 6)}-${s.slice(6)}`;
}

function OtpInline({ email, candidateId, roleId, onVerified, onError, onInactive }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [isVerified, setIsVerified] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (!/^\d{6}$/.test(code)) {
      setErr('Enter the 6-digit code.');
      return;
    }
    setBusy(true);
    try {
      const body = { email: String(email).trim().toLowerCase(), code: code.trim() };
      if (candidateId) body.candidate_id = candidateId;
      if (roleId) body.role_id = roleId;

      const resp = await fetch(joinUrl(BK, '/api/candidate/verify-otp'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await resp.json();
      if (!resp.ok) {
        if (data?.code === 'interview_limit_reached') {
          setIsVerified(false);
          onInactive?.({
            title: 'Interview Unavailable',
            detail: 'This interview is currently unavailable.',
            secondary: 'Please contact the employer if you have questions or need help continuing.',
            hint: data?.hint || ''
          });
          return;
        }
        if (data?.code === 'CLIENT_INACTIVE') {
          onInactive?.({
            detail: data?.detail || 'Interviewing service is inactive.',
            hint: data?.hint || ''
          });
          return;
        }
        const m = data?.error || 'Verification failed.';
        setErr(m);
        onError?.(m);
        return;
      }
      setIsVerified(true);
      onVerified?.({
        candidate_id: data?.candidate_id || candidateId,
        role_id: data?.role_id || roleId,
        email: data?.email || email,
      });
    } catch {
      setErr('Network error verifying code.');
      onError?.('Network error verifying code.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="alpha-step2">
      <h3 className="text-base font-semibold mb-3">Step 2 — Verify & Start</h3>

      <div className="mb-3">
        <label className="alpha-label">6-digit code</label>
        <input
          type="text"
          inputMode="numeric"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          className="alpha-input w-full tracking-widest"
          placeholder="••••••"
          required
          disabled={isVerified}
        />
      </div>

      {err && <p className="text-red-300 text-sm mb-2">{err}</p>}

      {!isVerified && (
        <button type="submit" disabled={busy} className="btn-lg">
          {busy ? 'Verifying…' : 'Verify'}
        </button>
      )}
    </form>
  );
}

export default function InterviewAccessPage() {
  const pingEmbedSize = () => {
    if (typeof window !== 'undefined' && window.__EMBED__ && typeof window.__EMBED__.updateSize === 'function') {
      window.__EMBED__.updateSize();
    }
  };

  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const root = document.getElementById('root');
    const appShell = root && root.firstElementChild ? root.firstElementChild : null;

    const prevDocOverflowY = document.documentElement.style.overflowY;
    const prevBodyOverflowY = document.body.style.overflowY;
    const prevBodyHeight = document.body.style.height;

    const prevShellOverflow = appShell ? appShell.style.overflow : '';
    const prevShellHeight = appShell ? appShell.style.height : '';
    const prevShellMinHeight = appShell ? appShell.style.minHeight : '';

    try {
      document.body.classList.add('alpha-has-header');
      document.documentElement.style.overflowY = 'auto';
      document.body.style.overflowY = 'auto';
      document.body.style.height = 'auto';
      if (appShell) {
        appShell.style.overflow = 'auto';
        appShell.style.height = 'auto';
        appShell.style.minHeight = '100vh';
      }
    } catch {}

    return () => {
      try {
        document.body.classList.remove('alpha-has-header');
        document.documentElement.style.overflowY = prevDocOverflowY || '';
        document.body.style.overflowY = prevBodyOverflowY || '';
        document.body.style.height = prevBodyHeight || '';
        if (appShell) {
          appShell.style.overflow = prevShellOverflow || '';
          appShell.style.height = prevShellHeight || '';
          appShell.style.minHeight = prevShellMinHeight || '';
        }
      } catch {}
    };
  }, []);

  const params = useParams();
  const paramToken = params?.role_token || params?.token || params?.role || params?.id || '';
  const [roleToken, setRoleToken] = useState(paramToken || '');

  useEffect(() => {
    try {
      const embedded = window.top !== window;
      const url = new URL(window.location.href);
      const camDebug = url.searchParams.get('camdebug') === '1';
      console.debug('[interview-debug] embedded:', embedded, 'origin:', window.location.origin, 'referrer:', document.referrer, 'camdebug:', camDebug);

      const hasMD = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
      console.debug('[interview-debug] mediaDevices.getUserMedia available:', hasMD);

      if (navigator.permissions && navigator.permissions.query) {
        ['camera', 'microphone'].forEach((name) => {
          navigator.permissions.query({ name })
            .then((status) => console.debug('[interview-debug] permission', name, status.state))
            .catch((err) => console.warn('[interview-debug] permission query failed for', name, err?.name || err));
        });
      } else {
        console.warn('[interview-debug] Permissions API not available');
      }

      if (camDebug && hasMD) {
        (async () => {
          try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            console.debug('[interview-debug] getUserMedia success. tracks:', stream.getTracks().map(t => t.kind));
            stream.getTracks().forEach(t => t.stop());
          } catch (e) {
            console.error('[interview-debug] getUserMedia error:', e && (e.name || e.message), e);
          }
        })();
      }
    } catch (e) {
      console.warn('[interview-debug] probe init failed:', e?.message || e);
    }
  }, []);

  useEffect(() => {
    if (paramToken && paramToken !== roleToken) {
      setRoleToken(paramToken);
      try { window.__ROLE_TOKEN = paramToken; } catch {}
    }
  }, [paramToken]);

  useEffect(() => {
    try {
      const u = new URL(window.location.href);
      const q = u.searchParams.get('role');
      if (q && !paramToken) {
        setRoleToken(q);
        try { window.__ROLE_TOKEN = q; } catch {}
        navigate(`/interview-access/${encodeURIComponent(q)}`, { replace: true });
      }
    } catch {}
  }, [location.search, paramToken, navigate]);

  useEffect(() => {
    const onMsg = (e) => {
      const d = e?.data;
      if (d && d.type === 'ROLE_TOKEN' && typeof d.token === 'string' && d.token) {
        try { window.__ROLE_TOKEN = d.token; } catch {}
        if (!paramToken) {
          navigate(`/interview-access/${encodeURIComponent(d.token)}`, { replace: true });
        }
        setRoleToken(d.token);
        try { if (window !== window.parent) window.parent.postMessage({ type: 'ROLE_TOKEN_CONFIRMED', token: d.token }, '*'); } catch {}
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [paramToken, navigate]);

  const roomRef = useRef(null);
  const autoEndTimerRef = useRef(null);
  const [endingSoon, setEndingSoon] = useState(false);
  const [roomUrl, setRoomUrl] = useState('');
  const [conversationId, setConversationId] = useState('');
  const [interviewId, setInterviewId] = useState('');
  const [prejoin, setPrejoin] = useState(false);
  const startAutoEnd = useCallback((reason) => {
    if (autoEndTimerRef.current) return;
    setEndingSoon(true);
    console.log('[interview] auto_end_scheduled', { reason });
    try { toast.success('Interview complete. Finishing up…', { duration: 1800 }); } catch {}
    autoEndTimerRef.current = setTimeout(() => {
      autoEndTimerRef.current = null;
      setEndingSoon(false);
      setRoomUrl('');
      setInterviewId('');
      setPrejoin(false);
      try { navigate('/interview-complete', { replace: true }); } catch { }
    }, 5000);
  }, [navigate]);
  const finishInterview = useCallback(async () => {
    const cid = String(conversationId || '').trim();
    if (!cid) {
      toast.error('Unable to end interview cleanly (missing conversation ID).');
      setRoomUrl('');
      setConversationId('');
      setInterviewId('');
      setPrejoin(false);
      if (autoEndTimerRef.current) {
        clearTimeout(autoEndTimerRef.current);
        autoEndTimerRef.current = null;
      }
      setEndingSoon(false);
      navigate('/interview-complete', { replace: true });
      return;
    }

    try {
      const resp = await fetch(joinUrl(BK, '/tavus/end-conversation'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_id: cid, interview_id: interviewId, role_token: roleToken }),
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
      setRoomUrl('');
      setConversationId('');
      setInterviewId('');
      setPrejoin(false);
      if (autoEndTimerRef.current) {
        clearTimeout(autoEndTimerRef.current);
        autoEndTimerRef.current = null;
      }
      setEndingSoon(false);
      navigate('/interview-complete', { replace: true });
    }
  }, [conversationId, navigate]);

  useEffect(() => {
    if (!roomUrl || !interviewId || !roleToken) return;

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
          navigate('/interview-complete', { replace: true });
        }
      } catch {}
    };

    pollStatus();
    timer = setInterval(pollStatus, 2500);

    return () => {
      active = false;
      if (timer) clearInterval(timer);
    };
  }, [roomUrl, interviewId, roleToken, navigate]);

  useEffect(() => {
    if (!roomUrl) return;

    const shouldAutoEnd = (payload) => {
      if (!payload) return false;
      const s = typeof payload === 'string' ? payload : JSON.stringify(payload);
      return /call_ended|call-ended|meeting-ended|meeting_ended|room_left|room-left|session_ended|session-ended|conversation_ended|conversation-ended|interview_ended|interview-ended|ended/i.test(s);
    };

    const onMsg = (e) => {
      try {
        const d = e?.data;
        const dbg = new URL(window.location.href).searchParams.get('autoenddebug') === '1';
        if (dbg) console.debug('[autoend.debug] message', e?.origin, d);
        if (shouldAutoEnd(d)) startAutoEnd('postMessage');
      } catch {}
    };

    window.addEventListener('message', onMsg);
    return () => {
      window.removeEventListener('message', onMsg);
      if (autoEndTimerRef.current) {
        clearTimeout(autoEndTimerRef.current);
        autoEndTimerRef.current = null;
      }
      setEndingSoon(false);
    };
  }, [roomUrl, navigate]);

  const [submitted, setSubmitted] = useState(null);
  const [verified, setVerified] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [inactiveInfo, setInactiveInfo] = useState(null);
  const [showPreInterviewNotice, setShowPreInterviewNotice] = useState(true);
  const [hasAcknowledgedQuiet, setHasAcknowledgedQuiet] = useState(false);
  const [preStartMaxInterviewMinutes, setPreStartMaxInterviewMinutes] = useState(null);

  useEffect(() => {
    let alive = true;
    if (!roleToken) {
      setPreStartMaxInterviewMinutes(null);
      return () => { alive = false; };
    }
    (async () => {
      try {
        const qs = new URLSearchParams({ role_token: String(roleToken) });
        const resp = await fetch(joinUrl(BK, `/public/interview-status?${qs.toString()}`));
        const data = await resp.json().catch(() => ({}));
        if (!alive || !resp.ok) return;
        const raw = Number(data?.max_interview_minutes);
        const minutes = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : null;
        setPreStartMaxInterviewMinutes(minutes);
      } catch {}
    })();
    return () => { alive = false; };
  }, [roleToken]);

  useEffect(() => {
    const t = setTimeout(pingEmbedSize, 60);
    return () => clearTimeout(t);
  }, []);

  const canStart = Boolean(verified && submitted?.candidate_id);

  const handleConfirmPreInterview = () => {
    setShowPreInterviewNotice(false);
    toast.success("You're all set. You can begin your interview.", { duration: 1200 });
    setTimeout(pingEmbedSize, 80);
  };

  useEffect(() => {
    const t = setTimeout(pingEmbedSize, 80);
    return () => clearTimeout(t);
  }, [submitted, verified, roomUrl, starting, prejoin, error, showPreInterviewNotice]);

  useEffect(() => {
    const REQUIRED = 'camera; microphone; autoplay; display-capture; fullscreen; clipboard-read; clipboard-write; storage-access';
    const matchesDaily = (src = '') => /(^https?:\/\/)?([a-z0-9-]+\.)?(tavus\.daily\.co|c\.daily\.co)(\/|\?|$)/i.test(String(src || ''));

    const patch = (el) => {
      if (!el || el.tagName !== 'IFRAME') return;
      const src = el.getAttribute('src') || '';
      if (!matchesDaily(src)) return;
      try {
        const allow = (el.getAttribute('allow') || '').toLowerCase();
        const needs = !allow.includes('camera') || !allow.includes('microphone') || !allow.includes('display-capture') || !allow.includes('autoplay') || !allow.includes('fullscreen');
        if (needs) el.setAttribute('allow', REQUIRED);
        if (!el.hasAttribute('allowfullscreen')) el.setAttribute('allowfullscreen', '');
        if (!el.getAttribute('referrerpolicy')) el.setAttribute('referrerpolicy', 'no-referrer');
      } catch {}
    };

    const scan = () => {
      try {
        const root = document.getElementById('tavus-slot') || document.body;
        const frames = root.querySelectorAll('iframe');
        frames.forEach(patch);
      } catch {}
    };

    scan();
    const tick = setInterval(scan, 800);

    const target = document.getElementById('tavus-slot') || document.body;
    const mo = new MutationObserver(() => scan());
    try { mo.observe(target, { subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'allow'] }); } catch {}

    return () => { clearInterval(tick); try { mo.disconnect(); } catch {} };
  }, []);

  const startInterview = useCallback(async () => {
    if (!canStart) return;
    setStarting(true);
    setError('');
    try {
      const resp = await fetch(joinUrl(BK, '/create-tavus-interview'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidate_id: submitted.candidate_id,
          role_id: submitted.role_id,
          email: submitted.email,
          roleToken: roleToken,
          role_token: roleToken
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        if (data?.code === 'interview_limit_reached') {
          setInactiveInfo({
            title: 'Interview Unavailable',
            detail: 'This interview is currently unavailable.',
            secondary: 'Please contact the employer if you have questions or need help continuing.',
            hint: data?.hint || ''
          });
          setVerified(false);
          setError('');
          return;
        }
        setError(data?.error || 'Could not start interview.');
        return;
      }
      const url = data?.conversation_url || data?.video_url || data?.redirect_url || data?.url || '';
      const cid = data?.conversation_id || '';
      const iid = data?.interview_id || '';
      const maxInterviewMinutesRaw = Number(data?.max_interview_minutes);
      const maxInterviewMinutes = Number.isFinite(maxInterviewMinutesRaw) && maxInterviewMinutesRaw > 0
        ? Math.floor(maxInterviewMinutesRaw)
        : null;
      const isLegacy = new URLSearchParams(location.search).get('legacy') === '1';
      if (url) {
        if (!isLegacy) {
          navigate('/interview-cvi', {
            replace: true,
            state: {
              conversation_url: url,
              conversation_id: cid ? String(cid) : '',
              interview_id: iid ? String(iid) : '',
              role_token: roleToken || '',
              max_interview_minutes: maxInterviewMinutes
            }
          });
          return;
        }
        setRoomUrl(url);
        setConversationId(cid ? String(cid) : '');
        setInterviewId(iid ? String(iid) : '');
        setPrejoin(true);
        setTimeout(() => { try { roomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch {} }, 50);
        setTimeout(pingEmbedSize, 120);
      } else {
        setConversationId('');
        setInterviewId('');
        setError('Interview room is initializing—try again in a moment.');
      }
    } catch {
      setError('Network error starting interview.');
    } finally {
      setStarting(false);
    }
  }, [canStart, submitted, roleToken, location.search, navigate]);

  const header = useMemo(
    () => (
      <header className="alpha-header" role="banner" aria-label="AlphaSource site header">
        <div className="inner">
          <div className="brand" aria-label="AlphaSource Home">
            <img src="/alpha-logo.png" alt="AlphaSource" />
          </div>
        </div>
      </header>
    ),
    []
  );

  const noRoom = !roomUrl;
  const hintRaw = String(inactiveInfo?.hint || '').trim();
  const hintPhone = extractPhoneDigits(hintRaw);

  const interviewContent = (
    <div className="space-y-6">
      {header}

      <div className="alpha-hero fullbleed">
        <div className={`tavus-stage${prejoin ? ' prejoin' : ''}`} ref={roomRef}>
          <div
            id="tavus-slot"
            className={`tavus-slot${noRoom ? ' no-room' : ''}`}
            aria-label="Interview video area"
          >
            {roomUrl ? (
              <>
                <iframe
                  title="Interview"
                  src={roomUrl}
                  loading="lazy"
                  allow="camera; microphone; autoplay; clipboard-read; clipboard-write; display-capture; fullscreen; storage-access"
                  referrerPolicy="no-referrer"
                  allowFullScreen
                />
                {endingSoon && (
                  <div className="tavus-ending-banner" role="status" aria-live="polite">
                    Interview complete — closing in a few seconds…
                  </div>
                )}
              </>
            ) : (
              <div className="placeholder">
                <div className="center-msg">
                  {!roleToken
                    ? "You’re almost there—this page needs a role link. Open the invite link you were sent, or contact your recruiter to resend it."
                    : inactiveInfo
                      ? (
                        <>
                          <div>{inactiveInfo?.title || 'Interview temporarily unavailable'}</div>
                          <div>{inactiveInfo?.detail || 'This interview is currently unavailable.'}</div>
                          {inactiveInfo?.secondary ? <div>{inactiveInfo.secondary}</div> : null}
                          {hintRaw
                            ? (
                              isEmailContact(hintRaw)
                                ? <div>Contact: <a href={`mailto:${hintRaw}`}>{hintRaw}</a></div>
                                : hintPhone
                                  ? <div>Contact: <a href={`tel:+1${hintPhone}`}>{formatPhone(hintPhone)}</a></div>
                                  : <div>Contact: {hintRaw}</div>
                            )
                            : null}
                        </>
                      )
                      : "Your interview room will appear here after verification."}
                </div>
              </div>
            )}
          </div>
          {roomUrl && !endingSoon && (
            <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn lilac"
                title="If the interview has ended, click to finish."
                onClick={finishInterview}
              >
                Finish interview
              </button>
            </div>
          )}
        </div>
      </div>

      {!roomUrl && !inactiveInfo && (
        <div className="alpha-form">
            <div className="alpha-form-grid-3">
              <div className="alpha-span-2">
                <h3 className="text-base font-semibold mb-3">Step 1 — Enter your information</h3>
                <InterviewAccessForm
                  roleToken={roleToken}
                  onInactive={(info) => {
                    setInactiveInfo(info || { detail: 'Interviewing service is inactive.', hint: '' });
                    setVerified(false);
                  }}
                  onSubmitted={(payload) => {
                    setInactiveInfo(null);
                    setSubmitted(payload);
                    setVerified(false);
                    setRoomUrl('');
                    setConversationId('');
                    setInterviewId('');
                    toast.success('Form submitted. Candidate created and verification code sent.', { duration: 3000 });
                    setTimeout(pingEmbedSize, 80);
                  }}
                />
              </div>

              {submitted ? (
                <OtpInline
                  email={submitted.email}
                  candidateId={submitted.candidate_id}
                  roleId={submitted.role_id}
                  onVerified={(info) => {
                    setVerified(true);
                    setSubmitted((s) => ({ ...(s || {}), ...info }));
                    toast.success('Verified. You can start your interview when ready.', { duration: 3000 });
                    setTimeout(pingEmbedSize, 80);
                  }}
                  onError={() => { setVerified(false); setTimeout(pingEmbedSize, 80); }}
                  onInactive={(info) => {
                    setInactiveInfo(info || { detail: 'Interviewing service is inactive.', hint: '' });
                    setVerified(false);
                    setTimeout(pingEmbedSize, 80);
                  }}
                />
              ) : (
                <div className="alpha-step2"></div>
              )}
            </div>

            {verified && (
              <div className="start-block">
                <button
                  type="button"
                  disabled={!canStart || starting}
                  onClick={startInterview}
                  className="btn-xl btn-outline-lilac btn-wide"
                >
                  {starting ? 'Starting…' : 'Start Interview'}
                </button>
              </div>
            )}

            {error && <p className="text-red-300 text-sm mt-2 center">{error}</p>}

            <div className="mt-4 center">
              <a
                href={roleToken ? `/accommodation-request/${encodeURIComponent(roleToken)}` : '/accommodation-request'}
              >
                Need an accommodation?
              </a>
            </div>
        </div>
      )}

      <style>{`
        .tavus-stage { width: 100%; }
        .tavus-slot {
          position: relative;
          width: 100%;
          border-radius: 16px;
          border: 1px solid rgba(255,255,255,0.1);
          background: rgba(0,0,0,0.85);
          overflow: hidden;
          margin: 0 auto;
          max-width: 1200px;
        }
        @media (min-width: 768px) {
          .tavus-stage .tavus-slot { height: 520px; }
          .tavus-stage.prejoin .tavus-slot { height: 650px; }
        }
        @media (max-width: 767px) {
          .tavus-slot { aspect-ratio: 16 / 9; }
        }
        .tavus-slot.no-room { height: 690px !important; }

        .tavus-slot > iframe,
        .tavus-slot video,
        .tavus-slot [data-daily-video],
        .tavus-slot .daily-video {
          position: absolute !important;
          inset: 0 !important;
          width: 100% !important;
          height: 100% !important;
          border: 0 !important;
          display: block;
          object-fit: contain;
          background: #000;
        }
        .tavus-slot .placeholder {
          position: absolute; inset: 0;
          display:flex; align-items:center; justify-content:center;
          color: rgba(255,255,255,0.85); padding:24px; text-align:center;
        }
        .tavus-slot .center-msg { max-width: 520px; }
        .tavus-ending-banner {
          position: absolute;
          left: 12px;
          right: 12px;
          bottom: 12px;
          padding: 10px 12px;
          border-radius: 12px;
          background: rgba(0,0,0,0.72);
          border: 1px solid rgba(255,255,255,0.16);
          color: rgba(255,255,255,0.92);
          font-size: 14px;
          text-align: center;
          z-index: 5;
          pointer-events: none;
        }
      `}</style>
    </div>
  );

  return (
    <div className="alpha-theme alpha-page interview-access-page">
      {showPreInterviewNotice && (
        <div className="pre-interview-overlay">
          <div className="alpha-card pre-interview-card">
            <h2 style={{ fontSize: '1.9rem', lineHeight: 1.2, marginBottom: 12 }}>Before you start your interview</h2>
            <p style={{ fontSize: '1.05rem', marginBottom: 10 }}>
              Please review this quick checklist before you begin:
            </p>
            <ul style={{ margin: '0 0 12px 20px', padding: 0, fontSize: '1.02rem', lineHeight: 1.5 }}>
              <li>Current resume in PDF or DOCX format</li>
              <li>Stable internet connection</li>
              <li>{preStartMaxInterviewMinutes ? `${preStartMaxInterviewMinutes} uninterrupted minutes to complete the interview` : 'The allotted uninterrupted time to complete the interview'}</li>
              <li>Quiet environment free of background conversations and distractions</li>
              <li>The interviewer is not mobile optimized yet; please complete this interview on a computer.</li>
              <li>You may complete only one interview per role. Once submitted, the interview cannot be retaken.</li>
            </ul>
            <p style={{ fontSize: '1rem', marginBottom: 12 }}>
              Background conversations and noise can be picked up during the interview and may interfere with your responses.
            </p>
            <label className="pre-interview-checkbox">
              <input
                type="checkbox"
                checked={hasAcknowledgedQuiet}
                onChange={(e) => setHasAcknowledgedQuiet(e.target.checked)}
              />
              <span>I understand and I am in a quiet place.</span>
            </label>
            <button
              className="alpha-button"
              disabled={!hasAcknowledgedQuiet}
              onClick={handleConfirmPreInterview}
            >
              Confirm
            </button>
          </div>
        </div>
      )}

      {!showPreInterviewNotice && interviewContent}
    </div>
  );
}
