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

/* ---------------- OTP COMPONENT (unchanged) ---------------- */

function OtpInline({ email, candidateId, roleId, onVerified, onError }) {
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

      {isVerified ? (
        <span className="verified-inline">Verified! You can start your interview.</span>
      ) : (
        <button type="submit" disabled={busy} className="btn-lg">
          {busy ? 'Verifying…' : 'Verify'}
        </button>
      )}
    </form>
  );
}

/* ---------------- PAGE COMPONENT ---------------- */

export default function InterviewAccessPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const roomRef = useRef(null);

  const params = useParams();
  const paramToken = params?.role_token || params?.token || params?.role || params?.id || '';
  const [roleToken, setRoleToken] = useState(paramToken || '');

  const [submitted, setSubmitted] = useState(null);
  const [verified, setVerified] = useState(false);
  const [roomUrl, setRoomUrl] = useState('');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [showPreInterviewNotice, setShowPreInterviewNotice] = useState(true);
  const [hasAcknowledgedQuiet, setHasAcknowledgedQuiet] = useState(false);

  const canStart = Boolean(verified && submitted?.candidate_id);

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
        setError(data?.error || 'Could not start interview.');
        return;
      }
      const url =
        data?.conversation_url ||
        data?.video_url ||
        data?.redirect_url ||
        data?.url ||
        '';
      if (url) {
        setRoomUrl(url);
      } else {
        setError('Interview room is initializing—try again in a moment.');
      }
    } catch {
      setError('Network error starting interview.');
    } finally {
      setStarting(false);
    }
  }, [canStart, submitted, roleToken]);

  const header = useMemo(
    () => (
      <header className="alpha-header">
        <div className="inner">
          <div className="brand">
            <img src="/alpha-logo.png" alt="AlphaSource" />
          </div>
        </div>
      </header>
    ),
    []
  );

  return (
    <div
      className="alpha-theme alpha-page interview-access-page"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100dvh'
      }}
    >
      {showPreInterviewNotice && (
        <div className="pre-interview-overlay">
          <div className="alpha-card pre-interview-card">
            <h2>Before you start your interview</h2>
            <p>Please move to a quiet, distraction-free area.</p>
            <label>
              <input
                type="checkbox"
                checked={hasAcknowledgedQuiet}
                onChange={(e) => setHasAcknowledgedQuiet(e.target.checked)}
              />
              <span>I am in a quiet place.</span>
            </label>
            <button
              disabled={!hasAcknowledgedQuiet}
              onClick={() => setShowPreInterviewNotice(false)}
            >
              Confirm
            </button>
          </div>
        </div>
      )}

      {!showPreInterviewNotice && (
        <>
          {header}

          <div
            ref={roomRef}
            style={{
              flex: 1,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column'
            }}
          >
            <div
              style={{
                position: 'relative',
                flex: 1,
                minHeight: 400,
                background: '#000'
              }}
            >
              {roomUrl && (
                <iframe
                  title="Interview"
                  src={roomUrl}
                  allow="camera; microphone; autoplay; display-capture; fullscreen"
                  allowFullScreen
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    border: 0
                  }}
                />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}