// src/pages/SignIn.jsx
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import toast from 'react-hot-toast';
import '../styles/clientTheme.css';

const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());

export default function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [emailError, setEmailError] = useState('');

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

  // Notify parent (Wix) to resize when layout changes
  useEffect(() => {
    const t = setTimeout(() => {
      postEmbedSizeBurst();
    }, 60);
    return () => clearTimeout(t);
  }, [err, loading]);

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
    try { localStorage.setItem('pwreset_origin', 'client'); } catch {}
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${origin}/pwreset?origin=client`
    });
    if (error) toast.error('Could not start reset: ' + error.message, { duration: 2000 });
    else toast.success('Check your email for a password reset link.', { duration: 1500 });
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
