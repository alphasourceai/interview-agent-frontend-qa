// src/pages/SignIn.jsx
import { useState, useMemo, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import { apiGet } from '../lib/api';
import toast from 'react-hot-toast';
import '../styles/clientTheme.css';

const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());

export default function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [showReset, setShowReset] = useState(false);
  const [newPass1, setNewPass1] = useState('');
  const [newPass2, setNewPass2] = useState('');
  const [emailError, setEmailError] = useState('');
  const [resetReady, setResetReady] = useState(false);
  const [resetProcessing, setResetProcessing] = useState(false);
  const [resetError, setResetError] = useState('');
  const requestId = useMemo(() => {
    try {
      return crypto.randomUUID();
    } catch (_) {
      return `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    }
  }, []);

  // --- Wix embed: report our height to the parent so the iframe can auto-resize ---
  function postEmbedSize() {
    if (typeof window === 'undefined') return;
    const doc = document;
    const h = Math.max(
      doc.body?.scrollHeight || 0,
      doc.documentElement?.scrollHeight || 0,
      doc.body?.offsetHeight || 0,
      doc.documentElement?.offsetHeight || 0
    );
    try {
      window.parent?.postMessage({ type: 'EMBED_SIZE', height: h }, '*');
    } catch (_) {
      // noop
    }
  }

  function postEmbedSizeBurst() {
    // fire immediately
    postEmbedSize();
    // and again after layout settles
    setTimeout(postEmbedSize, 60);
    setTimeout(postEmbedSize, 180);
    setTimeout(postEmbedSize, 400);
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(() => postEmbedSize());
    }
  }

  // Embedded (Wix) detection and HTML hook
  const EMBEDDED = typeof window !== 'undefined' && window !== window.parent;
  if (typeof document !== 'undefined' && EMBEDDED) {
    try {
      document.documentElement.classList.add('embedded');
      // Ensure the iframe can shrink as content collapses
      const style = document.createElement('style');
      style.setAttribute('data-embed-overflow', '1');
      style.textContent = `
        .embedded, .embedded body {
          overflow: hidden !important;
          height: auto !important;
        }
      `;
      // Avoid duplicating the style tag
      if (!document.querySelector('style[data-embed-overflow="1"]')) {
        document.head.appendChild(style);
      }
    } catch {}
  }

  // Preserve any ?next=/path on the current URL
  const { nextPath } = useMemo(() => {
    const url = new URL(window.location.href);
    const next = url.searchParams.get('next') || '';
    return { nextPath: next };
  }, []);

  function forceSignOutForPwReset() {
    try {
      console.debug('[signin pwreset]', { request_id: requestId, step: 'forceSignOut.start' });
      // Clear Supabase auth tokens from localStorage to avoid auto-restore
      if (typeof localStorage !== 'undefined') {
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (!k) continue;
          if (k.includes('sb-') && k.includes('-auth-token')) keys.push(k);
          if (k.startsWith('supabase.auth.token')) keys.push(k);
        }
        keys.forEach((k) => {
          try { localStorage.removeItem(k); } catch (_) {}
        });
        if (keys.length) console.debug('[signin pwreset]', { request_id: requestId, step: 'forceSignOut.clearedKeys', keys });
      }
    } catch (e) {
      console.warn('[signin pwreset] storage clear failed', { request_id: requestId, error: e?.message || e });
    }
    return supabase.auth.getSession()
      .then(async ({ data }) => {
        const hadSession = !!data?.session;
        if (hadSession) {
          console.debug('[signin pwreset]', { request_id: requestId, step: 'forceSignOut.signOut', hadSession: true });
          await supabase.auth.signOut();
        } else {
          console.debug('[signin pwreset]', { request_id: requestId, step: 'forceSignOut.noSession' });
        }
      })
      .catch((e) => {
        console.warn('[signin pwreset] signOut check failed', { request_id: requestId, error: e?.message || e });
      });
  }

  // Detect Supabase recovery redirect (?pwreset=1 or hash with recovery)
  useEffect(() => {
    let alive = true;
    const url = new URL(window.location.href);
    const hashParams = new URLSearchParams((url.hash || '').replace(/^#/, ''));
    const code = url.searchParams.get('code');
    const token_hash = url.searchParams.get('token_hash') || hashParams.get('token_hash');
    const typeParam = url.searchParams.get('type') || hashParams.get('type');
    const access_token = hashParams.get('access_token');
    const refresh_token = hashParams.get('refresh_token');
    const hasTokens = !!(access_token && refresh_token);
    const hasPwreset = url.searchParams.get('pwreset') === '1';
    const hasRecoveryParams = !!(code || token_hash || hasTokens || (typeParam === 'recovery'));

    const mode = hasPwreset || hasRecoveryParams ? 'pwreset' : 'signin';
    console.debug('[signin detect]', { request_id: requestId, mode, hasPwreset, hasRecoveryParams, code: !!code, token_hash: !!token_hash, hasTokens, typeParam });

    if (mode === 'pwreset') {
      setShowReset(true);
      (async () => {
        await forceSignOutForPwReset();
        setResetProcessing(true);
        setResetError('');
        try {
          if (code) {
            console.debug('[signin pwreset]', { request_id: requestId, step: 'exchangeCodeForSession' });
            await supabase.auth.exchangeCodeForSession(code);
          } else if (hasTokens) {
            console.debug('[signin pwreset]', { request_id: requestId, step: 'setSession.hashTokens' });
            await supabase.auth.setSession({ access_token, refresh_token });
          } else if (token_hash) {
            console.debug('[signin pwreset]', { request_id: requestId, step: 'verifyOtp.token_hash', type: typeParam || 'recovery' });
            await supabase.auth.verifyOtp({ type: typeParam || 'recovery', token_hash });
          }
          const { data } = await supabase.auth.getSession();
          if (!alive) return;
          if (data?.session) {
            console.debug('[signin pwreset]', { request_id: requestId, step: 'session.ready' });
            setResetReady(true);
          } else {
            console.debug('[signin pwreset]', { request_id: requestId, step: 'session.missing' });
            setResetError('Invalid or expired link. Please request a new password reset.');
          }
        } catch (e) {
          if (!alive) return;
          console.error('[signin pwreset] session init failed', { request_id: requestId, error: e?.message || e });
          setResetError('Invalid or expired link. Please request a new password reset.');
        } finally {
          if (alive) setResetProcessing(false);
        }
      })();
    }

    return () => { alive = false; };
  }, [requestId]);

  // Notify parent (Wix) to resize when layout changes
  useEffect(() => {
    const t = setTimeout(() => {
      postEmbedSizeBurst();
    }, 60);
    return () => clearTimeout(t);
  }, [showReset, err, loading]);

  // Initial size on mount (helps Wix editor/preview too)
  useEffect(() => {
    const t = setTimeout(() => {
      postEmbedSizeBurst();
    }, 40);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    function onLoad() { postEmbedSizeBurst(); }
    window.addEventListener('load', onLoad);
    return () => window.removeEventListener('load', onLoad);
  }, []);

  // Safari/WebKit: request third‑party storage access when embedded (Wix)
  async function requestSafariStorageAccess() {
    try {
      if (typeof document !== 'undefined' && document.hasStorageAccess && document.requestStorageAccess) {
        const has = await document.hasStorageAccess();
        if (!has) {
          // must be called in response to a user gesture
          await document.requestStorageAccess();
        }
      }
    } catch (_) {}
  }

  async function handleSignIn(e) {
    e.preventDefault();
    if (!email || !password || loading) return;
    if (!isValidEmail(email)) {
      setEmailError('Please enter a valid email address.');
      toast.error('Please enter a valid email address.', { duration: 1500 });
      return;
    }
    setEmailError('');
    setErr('');
    setLoading(true);
    try { await requestSafariStorageAccess(); } catch (_) {}
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    setTimeout(() => postEmbedSizeBurst(), 40);
    if (error) {
      setErr(error.message || 'Could not sign in.');
      return;
    }
    const url = new URL(window.location.href);
    const next = url.searchParams.get('next');
    window.location.replace(next || '/dashboard');
  }

  async function startReset() {
    if (!email) {
      toast.error('Enter your email first.', { duration: 1500 });
      return;
    }
    if (!isValidEmail(email)) {
      setEmailError('Please enter a valid email address.');
      toast.error('Please enter a valid email address.', { duration: 1500 });
      return;
    }
    setEmailError('');
    const origin = window.location.origin;
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${origin}/signin?pwreset=1`
    });
    if (error) toast.error('Could not start reset: ' + error.message, { duration: 2000 });
    else toast.success('Check your email for a password reset link.', { duration: 1500 });
  }

  async function submitReset(e) {
    e.preventDefault();
    if (!newPass1 || newPass1 !== newPass2) {
      toast.error('Passwords do not match.', { duration: 1500 });
      return;
    }
    const { error } = await supabase.auth.updateUser({ password: newPass1 });
    if (error) {
      console.error('[signin pwreset] updateUser failed', { request_id: requestId, error: error.message });
      return toast.error('Could not update password: ' + error.message, { duration: 2000 });
    }
    console.debug('[signin pwreset]', { request_id: requestId, step: 'passwordUpdated' });
    toast.success('Password updated. Loading your dashboard…', { duration: 1200 });

    try {
      let isAdmin = false;
      let hasMembership = false;
      try {
        const me = await apiGet('/auth/me');
        hasMembership = Array.isArray(me?.memberships) && me.memberships.length > 0;
      } catch (_) {}
      if (!hasMembership) {
        try {
          await apiGet('/admin/clients');
          isAdmin = true;
        } catch (_) {
          isAdmin = false;
        }
      }
      if (isAdmin) {
        window.location.replace('/admin');
      } else {
        window.location.replace('https://www.alphasourceai.com/account');
      }
    } catch (navErr) {
      console.error('[signin pwreset] navigation failed', navErr);
      toast.error('Password updated, but navigation failed. Please sign in again.', { duration: 2000 });
      await supabase.auth.signOut();
      window.location.replace('/signin');
    }
  }

  function exitReset() {
    setShowReset(false);
    setResetReady(false);
    setResetError('');
    const url = new URL(window.location.href);
    url.searchParams.delete('pwreset');
    url.searchParams.delete('code');
    url.searchParams.delete('token_hash');
    url.searchParams.delete('type');
    window.history.replaceState({}, '', url.toString().split('#')[0]);
    window.location.replace('/signin');
  }

  if (showReset) {
    return (
      <div className="alpha-theme client-auth" style={EMBEDDED ? { overflow: 'hidden' } : { minHeight: '100vh' }}>
        <div className="alpha-card auth-wrap client-card">
          <div className="auth-head">
            <h2>Reset Password</h2>
          </div>
          {resetProcessing && (
            <div style={{ marginBottom: 12 }}>Preparing your reset link…</div>
          )}
          {resetError && (
            <div className="input-error-text" style={{ marginBottom: 12 }}>
              {resetError}
            </div>
          )}
          {resetReady && !resetError && (
            <form onSubmit={submitReset}>
              <label>New password</label>
              <input className="alpha-input" type="password" value={newPass1} onChange={(e) => setNewPass1(e.target.value)} required />
              <label>Confirm new password</label>
              <input className="alpha-input" type="password" value={newPass2} onChange={(e) => setNewPass2(e.target.value)} required />
              <button type="submit">Update Password</button>
            </form>
          )}
          {!resetProcessing && !resetReady && (
            <button
              type="button"
              className="btn"
              onClick={submitReset}
              disabled
              style={{ opacity: 0.6 }}
            >
              Awaiting valid reset link…
            </button>
          )}
          <div style={{ marginTop: 12 }}>
            <button
              type="button"
              className="btn-ghost"
              onClick={exitReset}
              style={{ background: 'none', border: 'none', padding: 0, textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}
            >
              Back to sign in
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="alpha-theme client-auth" style={EMBEDDED ? { overflow: 'hidden' } : { minHeight: '100vh' }}>
      <div className="alpha-card auth-wrap client-card">
        <div className="auth-head">
          <h2>Client Sign In</h2>
        </div>

        <form onSubmit={handleSignIn}>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            className={`alpha-input ${emailError ? 'input-error' : ''}`}
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => setEmailError(isValidEmail(email) ? '' : (email ? 'Please enter a valid email address.' : ''))}
            required
            autoComplete="email"
          />
          {emailError && <div className="input-error-text">{emailError}</div>}

          <label htmlFor="password">Password</label>
          <input
            id="password"
            className="alpha-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />

          <button type="submit" disabled={!email || !password || loading}>
            {loading ? 'Signing in…' : 'Sign In'}
          </button>

          <div style={{ marginTop: 10 }}>
            <button
              type="button"
              onClick={startReset}
              className="btn-ghost"
              style={{ background: 'none', border: 'none', padding: 0, textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}
            >
              Forgot password?
            </button>
          </div>
        </form>

        {err && (
          <div role="alert" style={{ color: '#ffb4b4', marginTop: 12, fontSize: 14 }}>
            {err}
          </div>
        )}
      </div>
    </div>
  );
}
