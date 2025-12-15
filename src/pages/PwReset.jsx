import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { apiGet } from '../lib/api';
import toast from 'react-hot-toast';

const accountUrl = 'https://www.alphasourceai.com/account';

export default function PwReset() {
  const [readyForPassword, setReadyForPassword] = useState(false);
  const [processing, setProcessing] = useState(true);
  const [error, setError] = useState('');
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');

  const requestId = useMemo(() => {
    try { return crypto.randomUUID(); } catch (_) { return `req_${Date.now()}_${Math.random().toString(16).slice(2)}`; }
  }, []);

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

    console.debug('[pwreset]', { request_id: requestId, step: 'init', code: !!code, token_hash: !!token_hash, typeParam, hasTokens });

    async function handleRecovery() {
      try {
        if (code) {
          console.debug('[pwreset]', { request_id: requestId, step: 'exchangeCodeForSession' });
          await supabase.auth.exchangeCodeForSession(code);
        } else if (hasTokens) {
          console.debug('[pwreset]', { request_id: requestId, step: 'setSession.hashTokens' });
          await supabase.auth.setSession({ access_token, refresh_token });
        } else if (token_hash) {
          console.debug('[pwreset]', { request_id: requestId, step: 'verifyOtp', type: typeParam || 'recovery' });
          await supabase.auth.verifyOtp({ type: typeParam || 'recovery', token_hash });
        }
        const { data } = await supabase.auth.getSession();
        if (!alive) return;
        if (data?.session) {
          console.debug('[pwreset]', { request_id: requestId, step: 'session.ready' });
          setReadyForPassword(true);
          setError('');
        } else {
          setError('Invalid or expired reset link.');
        }
      } catch (e) {
        if (!alive) return;
        console.error('[pwreset] recovery init failed', { request_id: requestId, error: e?.message || e });
        setError('Invalid or expired reset link.');
      } finally {
        if (alive) setProcessing(false);
      }
    }

    // Also listen for PASSWORD_RECOVERY events
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (!alive) return;
      if (event === 'PASSWORD_RECOVERY') {
        console.debug('[pwreset]', { request_id: requestId, step: 'onAuthStateChange.PASSWORD_RECOVERY' });
        setReadyForPassword(true);
        setProcessing(false);
      }
    });

    handleRecovery();
    return () => {
      alive = false;
      sub?.subscription?.unsubscribe();
    };
  }, [requestId]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!pw1 || pw1.length < 8) {
      toast.error('Password must be at least 8 characters.');
      return;
    }
    if (pw1 !== pw2) {
      toast.error('Passwords do not match.');
      return;
    }
    try {
      console.debug('[pwreset]', { request_id: requestId, step: 'updateUser.start' });
      const { error: updErr } = await supabase.auth.updateUser({ password: pw1 });
      if (updErr) {
        console.error('[pwreset] updateUser failed', { request_id: requestId, error: updErr.message });
        toast.error(updErr.message || 'Could not update password.');
        return;
      }
      toast.success('Password updated. Redirecting…', { duration: 1200 });
      console.debug('[pwreset]', { request_id: requestId, step: 'updateUser.success' });

      // Determine destination before signing out
      let isAdmin = false;
      let hasMembership = false;
      try {
        const me = await apiGet('/auth/me');
        hasMembership = Array.isArray(me?.memberships) && me.memberships.length > 0;
        isAdmin = (me?.memberships || []).some((m) => String(m.role || '').toLowerCase() === 'admin');
      } catch (_) { /* ignore */ }
      if (!isAdmin && !hasMembership) {
        try {
          await apiGet('/admin/clients');
          isAdmin = true;
        } catch (_) {}
      }

      await supabase.auth.signOut();
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete('pwreset');
      cleanUrl.searchParams.delete('code');
      cleanUrl.searchParams.delete('token_hash');
      cleanUrl.searchParams.delete('type');
      window.history.replaceState({}, '', cleanUrl.toString().split('#')[0]);

      if (isAdmin) {
        window.location.replace('/admin');
      } else {
        window.location.replace(accountUrl);
      }
    } catch (e) {
      console.error('[pwreset] submit failed', { request_id: requestId, error: e?.message || e });
      toast.error(e?.message || 'Something went wrong.');
    }
  };

  const goSignin = () => {
    window.location.replace('/signin');
  };

  return (
    <div className="alpha-theme client-auth" style={{ minHeight: '100vh' }}>
      <div className="alpha-card auth-wrap client-card">
        <div className="auth-head">
          <h2>Set Password</h2>
        </div>
        {processing && <div>Preparing your reset link…</div>}
        {error && (
          <div className="input-error-text" style={{ marginBottom: 12 }}>
            {error}
            <div style={{ marginTop: 8 }}>
              <button className="btn" type="button" onClick={goSignin}>Go to sign in</button>
            </div>
          </div>
        )}
        {readyForPassword && !error && (
          <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 12 }}>
            <label>New password</label>
            <input className="alpha-input" type="password" value={pw1} onChange={(e) => setPw1(e.target.value)} required />
            <label>Confirm new password</label>
            <input className="alpha-input" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} required />
            <button type="submit" className="btn">Update Password</button>
          </form>
        )}
        {!processing && !readyForPassword && !error && (
          <div>Waiting for recovery session…</div>
        )}
      </div>
    </div>
  );
}
