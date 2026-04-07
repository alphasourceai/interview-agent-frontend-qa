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
  trimTrailingSlashes(env.VITE_PUBLIC_SITE_BASE_FALLBACK)
);

export const adminAppBase = firstBase(
  canonical.adminAppBase,
  legacyAppBase,
  trimTrailingSlashes(env.VITE_ADMIN_APP_BASE_FALLBACK)
);

export const clientAppBase = firstBase(
  canonical.clientAppBase,
  legacyAppBase,
  trimTrailingSlashes(env.VITE_CLIENT_APP_BASE_FALLBACK)
);

export const interviewAppBase = firstBase(
  canonical.interviewAppBase,
  trimTrailingSlashes(env.VITE_INTERVIEW_APP_BASE_FALLBACK)
);

export const interviewHostBase = `${interviewAppBase}/interview-host`;

function serializeQuery(query) {
  if (!query) return '';
  if (query instanceof URLSearchParams) return query.toString();
  if (typeof query === 'string') return query.replace(/^\?+/, '');
  try {
    return new URLSearchParams(query).toString();
  } catch {
    return '';
  }
}

function appendQuery(url, query) {
  const serialized = serializeQuery(query);
  return serialized ? `${url}?${serialized}` : url;
}

export function buildPublicAccountUrl(query, { absolute = true } = {}) {
  const base = absolute ? publicSiteBase : '';
  return appendQuery(`${base}/account`, query);
}

export function buildAdminEntryUrl(query, { absolute = false } = {}) {
  const base = absolute ? adminAppBase : '';
  return appendQuery(`${base}/admin`, query);
}

export function buildAdminDashboardUrl(query, { absolute = false } = {}) {
  const base = absolute ? adminAppBase : '';
  return appendQuery(`${base}/admin-dashboard`, query);
}

export function buildPwResetUrl(query, { base } = {}) {
  const originBase = firstBase(base, typeof window !== 'undefined' ? window.location.origin : '');
  const normalizedBase = trimTrailingSlashes(originBase);
  const pwResetBase = normalizedBase ? `${normalizedBase}/pwreset` : '/pwreset';
  return appendQuery(pwResetBase, query);
}

export function buildInterviewShareUrl(token, { base = interviewHostBase } = {}) {
  const safeToken = String(token || '');
  const interviewOrigin = originFromUrl(interviewAppBase);
  const currentOrigin = (typeof window !== 'undefined' && window.location)
    ? originFromUrl(window.location.origin)
    : '';
  const publicOrigin = originFromUrl(publicSiteBase);
  const clientOrigin = originFromUrl(clientAppBase);

  if (
    interviewOrigin &&
    (
      interviewOrigin === currentOrigin ||
      interviewOrigin === publicOrigin ||
      interviewOrigin === clientOrigin
    )
  ) {
    return `${interviewOrigin}/interview-access/${safeToken}`;
  }

  return `${trimTrailingSlashes(base)}/${safeToken}`;
}
