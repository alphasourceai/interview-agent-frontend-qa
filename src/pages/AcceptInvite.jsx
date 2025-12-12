// Accept invite: allow invited users to set password then route to appropriate dashboard
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabaseClient';
import { apiGet } from '../lib/api';
import '../styles/alphaTheme.css';

export default function AcceptInvite() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    async function ensureSession() {
      const hash = window.location.hash || '';
      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');
      // If we have a code param, try exchanging it (helps when redirectTo uses ?code=)
      if (code) {
        try { await supabase.auth.exchangeCodeForSession(code); } catch (_) {}
      }
      // Supabase normally restores session from the hash for invite links automatically
      const { data } = await supabase.auth.getSession();
      setHasSession(!!data?.session);
    }
    ensureSession();
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (!password || password.length < 8) {
      setErr('Password must be at least 8 characters.');
      return;
    }
    if (password !== password2) {
      setErr('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setErr(error.message || 'Could not update password.');
        setBusy(false);
        return;
      }
      toast.success('Password set! Loading your dashboard…', { duration: 1200 });
      // Determine destination
      let hasMembership = false;
      let isAdmin = false;
      try {
        const me = await apiGet('/auth/me');
        hasMembership = Array.isArray(me?.memberships) && me.memberships.length > 0;
      } catch (_) {
        hasMembership = false;
      }
      if (hasMembership) {
        window.location.href = 'https://www.alphasourceai.com/account';
        return;
      }
      try {
        await apiGet('/admin/clients');
        isAdmin = true;
      } catch (_) {
        isAdmin = false;
      }
      if (isAdmin) {
        navigate('/admin', { replace: true });
      } else {
        navigate('/dashboard', { replace: true });
      }
    } catch (e) {
      setErr(e?.message || 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="alpha-theme alpha-container auth-wrap" style={{ maxWidth: 520, margin: '48px auto' }}>
      <div className="alpha-card auth-card">
        <h1 style={{ marginBottom: 12 }}>Welcome to alphaScreen</h1>
        <p style={{ marginBottom: 16, opacity: 0.85 }}>Set your password to activate your account.</p>
        {!hasSession && (
          <div className="input-error-text" style={{ marginBottom: 12 }}>
            We could not detect your invite session. Please open the link from your email.
          </div>
        )}
        <form onSubmit={submit} className="alpha-form-grid" style={{ gap: 12 }}>
          <div className="alpha-col-span-2">
            <label className="alpha-label">New password</label>
            <input
              type="password"
              className="alpha-input w-full"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
              required
            />
          </div>
          <div className="alpha-col-span-2">
            <label className="alpha-label">Confirm password</label>
            <input
              type="password"
              className="alpha-input w-full"
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
              disabled={busy}
              required
            />
          </div>
          {err && <div className="alpha-col-span-2 input-error-text">{err}</div>}
          <div className="alpha-col-span-2" style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="submit" className="btn-lg" disabled={busy || !hasSession}>
              {busy ? 'Saving…' : 'Set Password & Continue'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
