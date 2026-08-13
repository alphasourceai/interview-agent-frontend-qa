// src/pages/SignIn.jsx
import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';
import toast from 'react-hot-toast';
import { buildPwResetUrl } from '../lib/urlConfig';
import '../styles/clientTheme.css';
import '../styles/publicRefresh.css';

const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
const CLIENT_SIGNIN_ERROR_TOAST_ID = 'client-signin-error';

export default function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const signInInFlightRef = useRef(false);
  const dropdownRef = useRef(null);

  // --- Wix embed: report our height to the parent so the iframe can auto-resize ---
  function postEmbedSize() {
    if (typeof window === 'undefined') return;
    try {
      window.__EMBED__?.updateSize?.();
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
  }, [loading]);

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

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    document.documentElement.classList.add('public-refresh-page');
    document.body.classList.add('public-refresh-page');
    return () => {
      document.documentElement.classList.remove('public-refresh-page');
      document.body.classList.remove('public-refresh-page');
    };
  }, []);

  useEffect(() => {
    const handleClick = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setLoginOpen(false);
      }
    };
    if (loginOpen) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [loginOpen]);

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
    if (signInInFlightRef.current) return;
    if (!email || !password || loading) return;
    toast.dismiss(CLIENT_SIGNIN_ERROR_TOAST_ID);
    if (!isValidEmail(email)) {
      setEmailError('Please enter a valid email address.');
      toast.error('Please enter a valid email address.', { duration: 1500 });
      return;
    }
    setEmailError('');
    signInInFlightRef.current = true;
    setLoading(true);
    try {
      try { await requestSafariStorageAccess(); } catch (_) {}
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        toast.error(error.message || 'Could not sign in.', {
          id: CLIENT_SIGNIN_ERROR_TOAST_ID,
          duration: 2000
        });
        return;
      }
      setLoginOpen(false);
      setMobileOpen(false);
      toast.dismiss(CLIENT_SIGNIN_ERROR_TOAST_ID);
      const url = new URL(window.location.href);
      const next = url.searchParams.get('next');
      window.location.replace(next || '/dashboard');
    } finally {
      signInInFlightRef.current = false;
      setLoading(false);
      setTimeout(() => postEmbedSizeBurst(), 40);
    }
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
    try { localStorage.setItem('pwreset_origin', 'client'); } catch {}
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: buildPwResetUrl({ origin: 'client' })
    });
    if (error) toast.error('Could not start reset: ' + error.message, { duration: 2000 });
    else toast.success('Check your email for a password reset link.', { duration: 1500 });
  }

  const navLinks = [
    { label: 'Home', href: '/' },
    { label: 'About', href: '/about' },
    { label: 'alphaScreen', href: '/alphascreen' },
    { label: 'How It Works', href: '/#how-it-works' },
    { label: 'Get in Touch', href: '/#contact' },
  ];

  const currentLocation = typeof window !== 'undefined' ? window.location.pathname : '';

  return (
    <div className="alpha-theme" style={EMBEDDED ? { overflow: 'hidden', minHeight: '100vh' } : { minHeight: '100vh' }}>
      <nav
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
          scrolled
            ? 'bg-white/95 backdrop-blur-md shadow-sm border-b border-gray-100'
            : 'bg-white/80 backdrop-blur-sm'
        }`}
      >
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <a href="/" className="flex items-center gap-0" data-testid="nav-logo">
              <img
                src="/logo-dark-text.png"
                alt="AlphaSource AI"
                className="h-8 w-auto"
                onError={(e) => { e.currentTarget.src = '/No bg - color logo - dark text.png'; }}
              />
            </a>

            <div className="hidden md:flex items-center gap-1">
              {navLinks.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                    currentLocation === link.href
                      ? 'text-[#A380F6]'
                      : 'text-[#0A1547] hover:text-[#A380F6]'
                  }`}
                  data-testid={`nav-link-${link.label.toLowerCase().replace(/\s+/g, '-')}`}
                >
                  {link.label}
                </a>
              ))}
            </div>

            <div className="hidden md:flex items-center gap-3" ref={dropdownRef}>
              <div className="relative">
                <button
                  onClick={() => setLoginOpen(!loginOpen)}
                  className="px-5 py-2.5 text-sm font-semibold text-[#0A1547] border border-[#0A1547]/15 rounded-full transition-all duration-200 hover:border-[#A380F6] hover:text-[#A380F6] hover:shadow-sm active:scale-95 flex items-center gap-2"
                  data-testid="nav-login-button"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
                    <polyline points="10 17 15 12 10 7"/>
                    <line x1="15" y1="12" x2="3" y2="12"/>
                  </svg>
                  Log In
                </button>

                {loginOpen && (
                  <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-2xl shadow-xl border border-gray-100 p-6 z-50">
                    <div className="mb-5">
                      <h3 className="text-base font-black text-[#0A1547] mb-1">Sign In to alphaSource</h3>
                      <p className="text-xs text-[#0A1547]/50">Access your client dashboard</p>
                    </div>

                    <form onSubmit={handleSignIn} className="space-y-3 alpha-refresh-login-form">
                      <input
                        type="email"
                        placeholder="Email address"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        onBlur={() => setEmailError(isValidEmail(email) ? '' : (email ? 'Please enter a valid email address.' : ''))}
                        className="w-full px-4 py-2.5 rounded-xl bg-gray-50 border border-gray-200 text-[#0A1547] text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#A380F6]/30 focus:border-[#A380F6] transition-all"
                        autoComplete="email"
                      />
                      {emailError && <p className="text-xs text-red-500 -mt-1">{emailError}</p>}
                      <input
                        type="password"
                        placeholder="Password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full px-4 py-2.5 rounded-xl bg-gray-50 border border-gray-200 text-[#0A1547] text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#A380F6]/30 focus:border-[#A380F6] transition-all"
                        autoComplete="current-password"
                      />
                      <button
                        type="submit"
                        disabled={!email || !password || loading}
                        className="w-full py-2.5 text-sm font-semibold text-white rounded-full transition-all hover:opacity-90 active:scale-[0.99]"
                        style={{ backgroundColor: '#A380F6' }}
                      >
                        {loading ? 'Signing in…' : 'Sign In'}
                      </button>
                      <button
                        type="button"
                        onClick={startReset}
                        className="text-xs text-[#A380F6] hover:underline"
                        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit' }}
                      >
                        Forgot password?
                      </button>
                    </form>

                    <p className="mt-4 text-center text-xs text-[#0A1547]/40">
                      Need access?{' '}
                      <a href="/#contact" className="text-[#A380F6] hover:underline" onClick={() => setLoginOpen(false)}>
                        Get in touch
                      </a>
                    </p>
                  </div>
                )}
              </div>
            </div>

            <button
              className="md:hidden p-2 rounded-lg text-[#0A1547]"
              onClick={() => setMobileOpen(!mobileOpen)}
              data-testid="nav-mobile-menu-button"
              aria-label="Toggle menu"
            >
              <svg width="22" height="22" fill="none" viewBox="0 0 24 24">
                {mobileOpen ? (
                  <path
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeWidth="2"
                    d="M6 6l12 12M6 18L18 6"
                  />
                ) : (
                  <path
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeWidth="2"
                    d="M4 6h16M4 12h16M4 18h16"
                  />
                )}
              </svg>
            </button>
          </div>
        </div>

        {mobileOpen && (
          <div className="md:hidden bg-white border-t border-gray-100 px-6 py-4 space-y-1">
            {navLinks.map((link) => (
              <a
                key={link.label}
                href={link.href}
                className="block px-3 py-2.5 text-sm font-medium text-[#0A1547] hover:text-[#A380F6] hover:bg-purple-50 rounded-lg transition-colors"
                onClick={() => setMobileOpen(false)}
              >
                {link.label}
              </a>
            ))}
            <div className="pt-3 border-t border-gray-100 mt-3">
              <p className="text-xs font-semibold text-[#0A1547]/40 uppercase tracking-wider mb-3 px-3">Client Login</p>
              <form onSubmit={handleSignIn} className="space-y-2 px-3 alpha-refresh-login-form">
                <input
                  type="email"
                  placeholder="Email address"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onBlur={() => setEmailError(isValidEmail(email) ? '' : (email ? 'Please enter a valid email address.' : ''))}
                  className="w-full px-4 py-2.5 rounded-xl bg-gray-50 border border-gray-200 text-[#0A1547] text-sm placeholder-gray-400 focus:outline-none"
                  autoComplete="email"
                />
                {emailError && <p className="text-xs text-red-500">{emailError}</p>}
                <input
                  type="password"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl bg-gray-50 border border-gray-200 text-[#0A1547] text-sm placeholder-gray-400 focus:outline-none"
                  autoComplete="current-password"
                />
                <button
                  type="submit"
                  disabled={!email || !password || loading}
                  className="w-full py-2.5 text-sm font-semibold text-white rounded-full"
                  style={{ backgroundColor: '#A380F6' }}
                >
                  {loading ? 'Signing in…' : 'Sign In'}
                </button>
                <button
                  type="button"
                  onClick={startReset}
                  className="text-xs text-[#A380F6] hover:underline"
                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit' }}
                >
                  Forgot password?
                </button>
              </form>
            </div>
          </div>
        )}
      </nav>

      <main id="top" className="public-refresh">
        <section id="about" className="public-refresh-hero">
          <div className="public-refresh-hero-copy">
            <div className="public-refresh-category"><span />AI INTERVIEW AGENT</div>
            <h1>alphaScreen</h1>
            <h2>Providing a clearer picture of more candidates.</h2>
            <p className="public-refresh-lead">Freeing up your time to focus on what you do best.</p>
            <p id="how-it-works" className="public-refresh-description">
              A membership-based AI interview agent that lets you create job roles and conduct automated screening interviews with AI avatars—with flexible scheduling so candidates can interview anytime, day or night.
            </p>
            <div className="public-refresh-hero-actions">
              <a href="#pricing" className="public-refresh-button public-refresh-button--primary">View pricing</a>
              <a href="#how-it-works" className="public-refresh-button public-refresh-button--secondary">See how it works</a>
            </div>
            <p className="public-refresh-proof">Structured interviews · Flexible scheduling · Hiring decisions stay with people</p>
          </div>

          <div className="public-refresh-demo" aria-label="Illustrative alphaScreen candidate evaluation">
            <div className="public-refresh-demo-head">
              <span className="public-refresh-demo-dots" aria-hidden="true"><i /><i /><i /></span>
              <span>alphaScreen candidate workspace</span>
            </div>
            <div className="public-refresh-report">
              <div className="public-refresh-report-main">
                <div className="public-refresh-report-kicker">CANDIDATE EVALUATION</div>
                <h3>Jordan Lee</h3>
                <p>Dental Assistant</p>
                <div className="public-refresh-score-row"><span>Resume match</span><strong>92%</strong></div>
                <div className="public-refresh-score-track"><span style={{ width: '92%' }} /></div>
                <div className="public-refresh-score-row"><span>Interview performance</span><strong>87%</strong></div>
                <div className="public-refresh-score-track"><span style={{ width: '87%' }} /></div>
                <div className="public-refresh-score-row"><span>Communication</span><strong>94%</strong></div>
                <div className="public-refresh-score-track"><span style={{ width: '94%' }} /></div>
              </div>
              <div className="public-refresh-fit-card">
                <span>OVERALL FIT</span>
                <strong>90<small>%</small></strong>
                <b>Advance</b>
              </div>
              <div className="public-refresh-report-note">
                <strong>Clearer signal for a faster human review.</strong>
                <p>AI organizes the evidence. Your team decides what happens next.</p>
              </div>
            </div>
          </div>
        </section>

        <section id="pricing" className="public-refresh-pricing">
          <div className="public-refresh-pricing-copy">
            <div className="public-refresh-section-kicker">PRICING AND SIGNUP</div>
            <h2>Choose the membership that best fits your team.</h2>
            <p>Start with Basic or Pro, then complete agreement review and secure checkout when you are ready.</p>
            <a href="/#contact">Talk to sales →</a>
          </div>
          <div className="public-refresh-memberships">
            <article>
              <span>BASIC</span>
              <h3>Focused hiring needs</h3>
              <p>20 interviews per role · 10-minute interviews</p>
              <a href="/#pricing">View membership →</a>
            </article>
            <article className="public-refresh-membership--featured">
              <span>PRO</span>
              <h3>More active roles</h3>
              <p>30 interviews per role · 12-minute interviews</p>
              <a href="/#pricing">View membership →</a>
            </article>
            <a className="public-refresh-compare" href="/#pricing">
              <strong>See memberships and pricing</strong>
              <span>Compare Basic, Pro, and Enterprise options.</span>
            </a>
          </div>
        </section>
      </main>
    </div>
  );
}
