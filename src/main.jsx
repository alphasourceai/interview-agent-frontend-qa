// src/main.jsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { createBrowserRouter, RouterProvider, Navigate, useRouteError } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { Elements } from '@stripe/react-stripe-js'
import { loadStripe } from '@stripe/stripe-js'

import * as Sentry from '@sentry/react'

import './styles/alphaTheme.css'

// Route components (lazy to prevent TDZ/circular init during first render)
const SignIn = React.lazy(() => import('./pages/SignIn.jsx'))
const PwReset = React.lazy(() => import('./pages/PwReset.jsx'))
const VerifyOtp = React.lazy(() => import('./pages/VerifyOtp.jsx'))
const InterviewAccessPage = React.lazy(() => import('./pages/InterviewAccessPage.jsx'))
const InterviewCviPage = React.lazy(() => import('./pages/InterviewCviPage.jsx'))
const AccommodationRequestPage = React.lazy(() => import('./pages/AccommodationRequestPage.jsx'))
const TextInterviewPage = React.lazy(() => import('./pages/TextInterviewPage.jsx'))
const Admin = React.lazy(() => import('./pages/Admin.jsx'))
const PaymentTerminal = React.lazy(() => import('./pages/PaymentTerminal.jsx'))
const TesterFeedback = React.lazy(() => import('./pages/TesterFeedback.jsx'))

const ClientDashboard = React.lazy(() => import('./pages/ClientDashboard.jsx'))
const RoleCreator = React.lazy(() => import('./pages/RoleCreator.jsx'))
const RoleReports = React.lazy(() => import('./pages/RoleReports.jsx'))
const RoleCandidates = React.lazy(() => import('./pages/RoleCandidates.jsx'))

// Auth guard
import ProtectedRoute from './components/ProtectedRoute.jsx'

import { supabase } from './lib/supabaseClient'
import { useEffect } from 'react'

const publishableKey =
  import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY ||
  import.meta.env.STRIPE_PUBLISHABLE_KEY ||
  '';

if (!publishableKey) {
  console.warn('Stripe publishable key missing. Payment terminal will not function.');
}

const stripePromise = publishableKey ? loadStripe(publishableKey) : null;

// --- Sentry (frontend) ---
const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: import.meta.env.VITE_SENTRY_ENV || import.meta.env.MODE || 'production',
    release: import.meta.env.VITE_COMMIT_SHA || (typeof __COMMIT_SHA__ !== 'undefined' ? __COMMIT_SHA__ : undefined),
    tracesSampleRate: Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE ?? 0.02), // low perf sample rate by default
    beforeSend(event) {
      try {
        // Basic PII scrubbing for URLs and strings
        const scrub = (s) =>
          typeof s === 'string'
            ? s
                .replace(/[^@\s]+@[^@\s]+\.[^@\s]+/g, '***@***')
                .replace(/(X-Amz-Signature|Signature)=[^&]+/g, '$1=REDACTED')
            : s
        if (event.request?.url) event.request.url = scrub(event.request.url)
      } catch {}
      return event
    },
  })

  // Capture global errors that may bypass React boundaries (e.g., router render failures)
  window.onerror = (message, source, lineno, colno, error) => {
    try { Sentry.captureException(error || new Error(String(message))); } catch {}
  };
  window.onunhandledrejection = (event) => {
    try { Sentry.captureException(event?.reason || new Error('Unhandled promise rejection')); } catch {}
  };
}

// --- Wix auto-resize for embedded mode (ResizeObserver, no inner scrollbars) ---
(function () {
  if (window === window.parent) return; // only when embedded

  // Tag document as embedded and prevent inner scrollbars
  try {
    document.documentElement.classList.add('embedded');
    if (document.body) document.body.style.overflow = 'hidden';
  } catch {}

  const root = document.getElementById('root') || document.documentElement;

  const postSize = () => {
    // Use root.scrollHeight so expanded content is included
    const h = Math.max(600, Math.min(6000, Math.ceil(root.scrollHeight)));
    window.parent.postMessage({ type: 'EMBED_SIZE', height: h }, '*');
  };

  // Observe size changes of the root for stable updates
  try {
    const ro = new ResizeObserver(() => {
      requestAnimationFrame(postSize);
    });
    ro.observe(root);
  } catch {
    // Fallback: minimal listeners
    window.addEventListener('resize', () => setTimeout(postSize, 50));
    const mo = new MutationObserver(() => setTimeout(postSize, 50));
    mo.observe(root, { childList: true, subtree: true });
  }

  // Initial measure
  window.addEventListener('load', () => setTimeout(postSize, 30));
  setTimeout(postSize, 60);

  // Manual trigger API for pages (Start Interview, toggles, etc.)
  window.__EMBED__ = { updateSize: postSize };
})();

// --- Embedded interview token bridge (from Wix wrapper -> app) ---
(function () {
  if (window === window.parent) return; // only when embedded
  window.addEventListener('message', (e) => {
    const data = e?.data;
    if (data && data.type === 'ROLE_TOKEN' && typeof data.token === 'string' && data.token.length > 0) {
      const target = `/interview-access/${encodeURIComponent(data.token)}`;
      if (window.location.pathname !== target) {
        window.location.replace(target); // ensure loaders run
      }
    }
  });
})();

// --- Fallback: allow /interview-access?role=<uuid> to redirect to /interview-access/<uuid> ---
(function () {
  try {
    const u = new URL(window.location.href);
    const role = u.searchParams.get('role');
    if (role && window.location.pathname === '/interview-access') {
      window.location.replace(`/interview-access/${encodeURIComponent(role)}`);
    }
  } catch {}
})();

function RouteErrorFallback() {
  const err = useRouteError?.() || null
  // minimal, safe fallback to avoid React Router default crash screen
  return (
    <div style={{ padding: 16 }}>
      <h3>Something went wrong loading this page.</h3>
      <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>
        {err && (err.message || String(err))}
      </pre>
      <button onClick={() => window.location.reload()}>Reload</button>
    </div>
  )
}
const errorElement = <RouteErrorFallback />

function InterviewComplete() {
  return (
    <div style={{ padding: 24, display: 'grid', placeItems: 'center' }}>
      <div style={{ maxWidth: 640, width: '100%', textAlign: 'center' }}>
        <h1 style={{ marginBottom: 12 }}>Interview complete</h1>
        <p style={{ marginBottom: 18 }}>
          Thank you for completing your interview. You may now close this window.
        </p>
      </div>
    </div>
  )
}

const router = createBrowserRouter([
  { path: '/', element: <ProtectedRoute><ClientDashboard /></ProtectedRoute>, errorElement },

  // public
  { path: '/signin', element: <SignIn />, errorElement },
  { path: '/pwreset', element: <PwReset />, errorElement },
  { path: '/verify-otp', element: <VerifyOtp />, errorElement },
  { path: '/interview-access', element: <InterviewAccessPage />, errorElement },
  { path: '/interview-access/:role_token', element: <InterviewAccessPage />, errorElement },
  { path: '/interview-cvi', element: <InterviewCviPage />, errorElement },
  { path: '/interview-complete', element: <InterviewComplete />, errorElement },
  { path: '/accommodation-request', element: <AccommodationRequestPage />, errorElement },
  { path: '/accommodation-request/:role_token', element: <AccommodationRequestPage />, errorElement },
  { path: '/text-interview/:token', element: <TextInterviewPage />, errorElement },
  { path: '/admin', element: <Admin />, errorElement },
  { path: '/payment-terminal', element: <PaymentTerminal />, errorElement },
  { path: '/tester-feedback', element: <TesterFeedback />, errorElement },

  // legacy single-page + role views
  { path: '/dashboard', element: <ProtectedRoute><ClientDashboard /></ProtectedRoute>, errorElement },
  { path: '/create-role', element: <ProtectedRoute><RoleCreator /></ProtectedRoute>, errorElement },
  { path: '/reports/:roleId', element: <ProtectedRoute><RoleReports /></ProtectedRoute>, errorElement },
  { path: '/candidates/:roleId', element: <ProtectedRoute><RoleCandidates /></ProtectedRoute>, errorElement },

  // catch-all → dashboard
  { path: '*', element: <Navigate to="/dashboard" replace />, errorElement },
])

function SessionRecoveryWrapper({ children }) {
  useEffect(() => {
    async function recoverSession() {
      try {
        const { data, error } = await supabase.auth.getSession()
        if (error || !data?.session) {
          await supabase.auth.refreshSession()
        }
      } catch (e) {
        console.warn('Session recovery failed:', e)
      }
    }
    recoverSession()
  }, [])
  return <>{children}</>
}

const __PATHNAME__ = (typeof window !== 'undefined' && window.location && window.location.pathname) ? window.location.pathname : '';
const __IS_INTERVIEW_ACCESS__ = __PATHNAME__ === '/interview-access' || __PATHNAME__.startsWith('/interview-access/');
const __APP_SHELL_STYLE__ = __IS_INTERVIEW_ACCESS__
  ? { minHeight: '100dvh', overflow: 'auto' }
  : { height: '100vh', overflow: 'hidden' };

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Sentry.ErrorBoundary fallback={<div style={{ padding: 16 }}>Something went wrong. Please refresh and try again.</div>}>
      <SessionRecoveryWrapper>
        <div style={__APP_SHELL_STYLE__}>
          <React.Suspense fallback={<div style={{ padding: 16 }}>Loading…</div>}>
            <Elements stripe={stripePromise}>
              <RouterProvider router={router} />
            </Elements>
          </React.Suspense>
        </div>
        <Toaster
          position="top-center"
          toastOptions={{
            duration: 1000,
            style: {
              fontSize: '0.9rem',
              color: '#ffffff',
              background: '#2f2a4a'
            }
          }}
          containerStyle={{ marginTop: 64 }}
        />
      </SessionRecoveryWrapper>
    </Sentry.ErrorBoundary>
  </React.StrictMode>
)
