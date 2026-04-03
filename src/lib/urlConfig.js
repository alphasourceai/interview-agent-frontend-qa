const env = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : {};

function trimTrailingSlashes(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function firstBase(...values) {
  for (const value of values) {
    const normalized = trimTrailingSlashes(value);
    if (normalized) return normalized;
  }
  return '';
}

function originFromUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    return trimTrailingSlashes(new URL(raw).origin);
  } catch {
    return '';
  }
}

export const canonical = {
  publicSiteBase: trimTrailingSlashes(env.VITE_PUBLIC_SITE_BASE),
  clientAppBase: trimTrailingSlashes(env.VITE_CLIENT_APP_BASE),
  adminAppBase: trimTrailingSlashes(env.VITE_ADMIN_APP_BASE),
  interviewAppBase: trimTrailingSlashes(env.VITE_INTERVIEW_APP_BASE),
  backendUrl: trimTrailingSlashes(env.VITE_BACKEND_URL),
};

const legacyAppBase = firstBase(
  trimTrailingSlashes(env.VITE_FRONTEND_BASE),
  trimTrailingSlashes(env.VITE_APP_URL),
  originFromUrl(env.VITE_AUTH_REDIRECT_URL)
);

export const backendBase = firstBase(
  canonical.backendUrl,
  trimTrailingSlashes(env.VITE_API_URL),
  trimTrailingSlashes(env.VITE_PUBLIC_BACKEND_URL),
  trimTrailingSlashes(env.PUBLIC_BACKEND_URL),
  trimTrailingSlashes(env.BACKEND_URL)
);

export const publicSiteBase = firstBase(
  canonical.publicSiteBase,
  trimTrailingSlashes(env.VITE_APP_URL),
  originFromUrl(env.VITE_AUTH_REDIRECT_URL),
  'https://www.alphasourceai.com'
);

export const adminAppBase = firstBase(
  canonical.adminAppBase,
  legacyAppBase,
  'https://ia-frontend-prod.onrender.com'
);

export const clientAppBase = firstBase(
  canonical.clientAppBase,
  legacyAppBase,
  'https://ia-frontend-prod.onrender.com'
);

export const interviewAppBase = firstBase(
  canonical.interviewAppBase,
  'https://interviews.alphasourceai.com'
);

export const interviewHostBase = `${interviewAppBase}/interview-host`;
