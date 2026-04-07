// src/pages/ClientDashboard.jsx
import { useEffect, useMemo, useState, useRef } from 'react'
import { apiGet, apiDownload, apiPost, apiDelete, api } from '../lib/api'
import toast from 'react-hot-toast'
import { buildInterviewShareUrl } from '../lib/urlConfig'
import SignOutButton from '../components/SignOutButton.jsx'
import CustomFilePicker from '../components/CustomFilePicker'
import TesterFeedbackForm from '../components/TesterFeedbackForm.jsx'
import ConfirmDialog from '../components/ConfirmDialog.jsx'
import '../styles/clientDashboard.css';

// --- Dashboard enhancements: sorting, filtering, tooltips (no summaries) ---
const TIPS = {
  experience: 'How well prior roles align with the job requirements.',
  skills: 'Match between hard/soft skills and the role’s needs.',
  education: 'Relevance and level of education for the role.',
  clarity: 'How clearly the candidate communicates ideas/use of filler words.',
  confidence: 'Apparent confidence and composure while answering.',
  engagement: 'Engagement and non-verbal cues such as posture and eye contact.',
  evidence_strength: `Strength of evidence behind the interview score. Higher means more concrete, verifiable detail.
75–100 → High reliability — proceed with confidence.
50–74 → Moderate — validate key claims in follow-up.
<50 → Limited — conduct additional probing.`,
  ai_aided_risk: 'Probabilistic signal of possible AI-assisted responses. Use as a cue for follow-up, not a verdict.'
};

function SortIcon({ dir, active }) {
  if (!active) {
    return <span className="client-dash-sort-caret client-dash-sort-caret--neutral">▼</span>;
  }
  return <span className="client-dash-sort-caret">{dir === 'asc' ? '▲' : '▼'}</span>;
}

const th = {
  textAlign: 'left',
  borderBottom: '1px solid #e5e7eb',
  padding: '8px 6px',
  whiteSpace: 'nowrap',
  position: 'sticky',
  top: 0,
  zIndex: 5,
  background: '#0A1547',
};
const td = { borderBottom: '1px solid #f1f5f9', padding: '8px 6px', verticalAlign: 'top' };
const disabledBtn = { opacity: 0.6, cursor: 'not-allowed' };
const CLIENT_DASH_TOUR_SEEN_KEY = 'client_dash_tour_seen_v1';
const CLIENT_DASH_TOUR_DISMISSED_KEY = 'client_dash_tour_dismissed_v1';
const DAILY_ROOM_RE = /(^https?:\/\/)?([a-z0-9-]+\.)?(tavus\.daily\.co|c\.daily\.co)(\/|\?|$)/i;
const VALID_DASHBOARD_TABS = new Set(['roles', 'candidates', 'members', 'billing', 'feedback']);

function parseDashboardReturnState(search) {
  const params = new URLSearchParams(search || '');
  const clientIdParam = String(params.get('client_id') || '').trim();
  const tabParam = String(params.get('tab') || '').trim().toLowerCase();
  const roleIdParam = String(params.get('role_id') || '').trim();
  const checkoutParam = String(params.get('checkout') || '').trim().toLowerCase();
  const purchaseParam = String(params.get('purchase') || '').trim().toLowerCase();
  const roleCheckoutParam = String(params.get('role_checkout') || '').trim().toLowerCase();
  const intentParam = String(params.get('intent') || '').trim().toLowerCase();
  const isSuccessOrCancel = (value) => value === 'success' || value === 'cancel';

  let resolvedTab = VALID_DASHBOARD_TABS.has(tabParam) ? tabParam : '';
  if (!resolvedTab) {
    if (isSuccessOrCancel(roleCheckoutParam)) {
      resolvedTab = 'roles';
    } else if (
      isSuccessOrCancel(checkoutParam) ||
      isSuccessOrCancel(purchaseParam) ||
      intentParam === 'role_capacity'
    ) {
      resolvedTab = 'billing';
    }
  }

  return {
    clientId: clientIdParam,
    tab: resolvedTab,
    roleId: roleIdParam,
  };
}

function isDailyRoomUrl(url) {
  return !!url && DAILY_ROOM_RE.test(String(url));
}

function isUsableRecordingUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed || !/^https:\/\//i.test(trimmed)) return false;
  return !isDailyRoomUrl(trimmed);
}

function parseAnalysis(a) {
  if (a && typeof a === 'object') return a;
  if (typeof a === 'string') {
    try {
      const parsed = JSON.parse(a);
      if (parsed && typeof parsed === 'object') return parsed;
      return null;
    } catch {
      return null;
    }
  }
  return null;
}

function normalizeScoreObject(value) {
  if (value && typeof value === 'object') return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      return null;
    }
  }
  return null;
}

function hasPerceptionCoreScores(scores) {
  return (
    Number.isFinite(Number(scores?.clarity)) ||
    Number.isFinite(Number(scores?.confidence)) ||
    Number.isFinite(Number(scores?.engagement))
  );
}

function isPerceptionPendingRow(row) {
  const transcriptScores = normalizeScoreObject(row?.transcript_scores) || {};
  const summary = typeof row?.interview_summary === 'string' ? row.interview_summary.trim() : '';
  const hasOverall = Number.isFinite(Number(transcriptScores?.overall));
  const hasAnalysisSignal =
    row?.has_analysis === true ||
    hasOverall ||
    !!summary ||
    !!row?.analysis ||
    !!row?.analysis_url;
  if (!hasAnalysisSignal) return false;
  const perceptionScores = normalizeScoreObject(row?.perception_scores) || {};
  if (perceptionScores?.mode === 'text' || perceptionScores?.unavailable === true) return false;
  return !hasPerceptionCoreScores(perceptionScores);
}

function sanitizeFilenamePart(value, fallback) {
  const raw = value == null ? '' : String(value);
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  const cleaned = trimmed.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '');
  return cleaned || fallback;
}

const csvEscape = (value) => {
  const str = value == null ? '' : String(value);
  const escaped = str.replace(/"/g, '""');
  return `"${escaped}"`;
};

const buildCsv = (headers, rows) => {
  const lines = [headers, ...rows].map((row) => row.map(csvEscape).join(','));
  return lines.join('\r\n');
};

const extractRubricQuestions = (rubric) => {
  const questions = [];
  const seen = new Set();
  const add = (value) => {
    const text = value == null ? '' : String(value).trim();
    if (!text || seen.has(text)) return;
    seen.add(text);
    questions.push(text);
  };
  const handleItem = (item) => {
    if (item == null) return;
    if (typeof item === 'string' || typeof item === 'number') {
      add(item);
      return;
    }
    if (Array.isArray(item)) {
      item.forEach(handleItem);
      return;
    }
    if (typeof item === 'object') {
      const candidate = item.question || item.text || item.prompt || item.label || item.value;
      if (candidate) add(candidate);
      if (Array.isArray(item.questions)) item.questions.forEach(handleItem);
      if (Array.isArray(item.rubric)) item.rubric.forEach(handleItem);
      if (Array.isArray(item.items)) item.items.forEach(handleItem);
      if (Array.isArray(item.prompts)) item.prompts.forEach(handleItem);
    }
  };

  if (rubric == null) return questions;
  if (typeof rubric === 'string') {
    const raw = rubric.trim();
    if (!raw) return questions;
    if ((raw.startsWith('{') && raw.endsWith('}')) || (raw.startsWith('[') && raw.endsWith(']'))) {
      try {
        handleItem(JSON.parse(raw));
        return questions;
      } catch {
        add(raw);
        return questions;
      }
    }
    add(raw);
    return questions;
  }

  handleItem(rubric);
  return questions;
};

function FileIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" stroke="#FFFFFF" strokeWidth="2" strokeLinejoin="round"/>
      <path d="M14 2v6h6" stroke="#FFFFFF" strokeWidth="2" strokeLinejoin="round"/>
    </svg>
  );
}

const downloadCsv = (csvText, filename) => {
  const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

function HeaderButton({ label, active, dir, onClick }) {
  return (
    <button
      onClick={onClick}
      className="sortable-header"
      title={`Sort by ${label}`}
      aria-pressed={active}
    >
      <span>{label}</span>
      <SortIcon dir={dir} active={active} />
    </button>
  );
}

function InfoTip({ text, placement = 'top' }) {
  const [open, setOpen] = useState(false);
  const [flip, setFlip] = useState(false);
  const ref = useRef(null);
  const isBottom = placement === 'bottom';

  const onEnter = () => {
    setOpen(true);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const TOOLTIP_W = 360;
      const overflowRight = rect.right + TOOLTIP_W + 16 > window.innerWidth;
      setFlip(overflowRight);
    });
  };

  return (
    <span
      ref={ref}
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}
      onMouseEnter={onEnter}
      onMouseLeave={() => setOpen(false)}
      onFocus={onEnter}
      onBlur={() => setOpen(false)}
    >
      <span
        aria-hidden="true"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 14,
          height: 14,
          borderRadius: 999,
          fontSize: 10,
          background: '#AD8BF7',
          color: '#fff',
          marginLeft: 6,
          cursor: 'help'
        }}
      >
        i
      </span>
      {open && (
        <span
          role="tooltip"
          style={{
            position: 'absolute',
            top: isBottom ? 20 : -8,
            left: flip ? 'auto' : 12,
            right: flip ? 12 : 'auto',
            transform: isBottom ? 'none' : 'translateY(-100%)',
            background: '#111827',
            color: '#EBFEFF',
            border: '1px solid rgba(255,255,255,0.14)',
            borderRadius: 8,
            padding: '8px 10px',
            display: 'block',
            whiteSpace: 'pre-line',
            width: 360,
            fontSize: 12,
            zIndex: 50,
            maxWidth: 360,
            lineHeight: 1.45,
            boxShadow: '0 6px 18px rgba(0,0,0,0.3)'
          }}
        >
          {text}
        </span>
      )}
    </span>
  );
}

export default function ClientDashboard() {
  // --- Wix embed: CSS override for embedded mode ---
  useEffect(() => {
    // Detect if embedded (Wix, etc) by checking if in iframe
    if (window?.parent && window.parent !== window) {
      // Add a style tag at the top of <head>
      const style = document.createElement('style');
      style.setAttribute('data-embed-css', 'true');
      style.innerHTML = `
        html, body { overflow: visible !important; height: auto !important; }
      `;
      document.head.prepend(style);
      return () => {
        if (style.parentNode) style.parentNode.removeChild(style);
      };
    }
  }, []);
  const [me, setMe] = useState(null)
  const [clients, setClients] = useState([])
  const [clientId, setClientId] = useState('')
  const isGlobalAdmin = !!me?.isGlobalAdmin;
  const scopedMemberships = useMemo(() => {
    const fromScope = me?.client_scope?.memberships;
    if (Array.isArray(fromScope)) return fromScope;
    const legacy = me?.memberships;
    return Array.isArray(legacy) ? legacy : [];
  }, [me]);
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [opening, setOpening] = useState({})
  const [expandedId, setExpandedId] = useState(null)
  const [isTranscriptOpen, setIsTranscriptOpen] = useState(false)
  const [activeTranscript, setActiveTranscript] = useState('')
  const [activeTranscriptFilename, setActiveTranscriptFilename] = useState('')
  const [refreshing, setRefreshing] = useState(false)

  const pollRef = useRef({ timer: null, stopAt: 0, active: false, inflight: false })
  const POLL_INTERVAL_MS = 12000
  const POLL_MAX_MS = 360000

  // --- Row visibility controls (Show more / Show less) ---
  const INITIAL_COUNT = 20;
  const [visibleCount, setVisibleCount] = useState(INITIAL_COUNT);

  function showToast(msg, type = 'success', ttlMs = 4500) {
    if (type === 'error') {
      toast.error(msg, { duration: ttlMs });
      return;
    }
    toast.success(msg, { duration: ttlMs });
  }

  const getPerceptionScores = (row) => {
    return normalizeScoreObject(row?.perception_scores) || {};
  };

  const getTranscriptScores = (row) => {
    return normalizeScoreObject(row?.transcript_scores) || {};
  };

  const isRowComplete = (row) => {
    const summary = typeof row?.interview_summary === 'string' ? row.interview_summary.trim() : '';
    const transcriptScores = getTranscriptScores(row);
    const hasOverall = Number.isFinite(Number(transcriptScores.overall));
    const perceptionScores = getPerceptionScores(row);
    const hasPerception = hasPerceptionCoreScores(perceptionScores);
    return !!summary && hasOverall && hasPerception;
  };

  const countPerceptionPendingRows = (rowsList) => {
    return (rowsList || []).reduce((acc, row) => acc + (isPerceptionPendingRow(row) ? 1 : 0), 0);
  };

  function stopPolling() {
    const state = pollRef.current;
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    state.active = false;
    state.stopAt = 0;
    state.inflight = false;
    setRefreshing(false);
  }

  function scheduleNextPoll() {
    const state = pollRef.current;
    if (!state.active) return;
    if (Date.now() >= state.stopAt) {
      stopPolling();
      return;
    }
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      fetchRows({ silent: true, reason: 'poll' });
    }, POLL_INTERVAL_MS);
  }

  function startPolling(reason) {
    const state = pollRef.current;
    if (state.active) return;
    state.active = true;
    state.stopAt = Date.now() + POLL_MAX_MS;
    scheduleNextPoll();
  }

  async function fetchRows({ silent = false, reason = 'manual' } = {}) {
    if (!clientId) return;
    const state = pollRef.current;
    if (state.inflight) return;
    state.inflight = true;
    const isSilentFetch = !!silent;
    const isManual = silent && reason === 'manual';
    if (isManual) {
      setRefreshing(true);
    }
    if (!isSilentFetch) {
      setLoading(true);
    }
    try {
      const qs = `?client_id=${encodeURIComponent(clientId)}`;
      const resp = await apiGet('/dashboard/rows' + qs);
      const raw = resp?.items || [];
      const scrubbed = (raw || []).filter(r => r && r.id);
      setItems(scrubbed);
      if (reason === 'poll' && typeof import.meta !== 'undefined' && import.meta?.env?.DEV) {
        scrubbed.forEach((row) => {
          const transcriptScores = normalizeScoreObject(row?.transcript_scores) || {};
          const perceptionScores = normalizeScoreObject(row?.perception_scores) || {};
          console.log('[dashboard][poll] applied', {
            candidate_id: row?.candidate?.id || row?.id || null,
            has_analysis: row?.has_analysis ?? null,
            transcript_overall: Number.isFinite(Number(transcriptScores.overall))
              ? Number(transcriptScores.overall)
              : null,
            perception_keys: Object.keys(perceptionScores),
            interview_summary_len: typeof row?.interview_summary === 'string'
              ? row.interview_summary.trim().length
              : 0
          });
        });
      }
    } catch (e) {
      setError(String(e?.message || e));
      if (state.active) {
        scheduleNextPoll();
      }
    } finally {
      state.inflight = false;
      if (isManual) {
        setRefreshing(false);
      }
      if (!isSilentFetch) {
        setLoading(false);
      }
    }
  }

  const closeTranscriptModal = () => {
    setIsTranscriptOpen(false);
  };

  const openTranscriptModal = async (row) => {
    const transcriptText = typeof row?.transcript === 'string' ? row.transcript.trim() : '';
    const email = row?.candidate?.email || row?.email || 'candidate';
    const roleName = row?.role_name || row?.role?.title || row?.role || 'role';
    const filename = `${sanitizeFilenamePart(email, 'candidate')}-${sanitizeFilenamePart(roleName, 'role')}-transcript.txt`;

    if (transcriptText) {
      setActiveTranscript(transcriptText);
      setActiveTranscriptFilename(filename);
      setIsTranscriptOpen(true);
      postSizeSoon();
      setTimeout(postSizeSoon, 250);
      return;
    }

    showToast('Transcript is not available yet', 'error');
  };

  const handleManualRefresh = () => {
    fetchRows({ silent: true, reason: 'manual' });
  };

  const downloadTranscript = () => {
    if (!activeTranscript) {
      showToast('Transcript is empty', 'error');
      return;
    }
    const blob = new Blob([activeTranscript], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = activeTranscriptFilename || 'transcript.txt';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const copyTranscript = async () => {
    if (!activeTranscript) {
      showToast('Transcript is empty', 'error');
      return;
    }
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(activeTranscript);
        showToast('Transcript copied', 'success');
        return;
      }
      throw new Error('clipboard_api_unavailable');
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = activeTranscript;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        ta.setAttribute('readonly', '');
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showToast('Transcript copied', 'success');
      } catch (err) {
        console.warn('Copy failed:', err);
        showToast('Could not copy transcript', 'error');
      }
    }
  };
  const toMessage = (value, fallback) => {
    if (typeof value === 'string') return value;
    if (value == null) return fallback;
    try {
      return JSON.stringify(value);
    } catch {
      return fallback;
    }
  };

  // Roles panel state (for manager/admin client members)
  const [roles, setRoles] = useState([]);
  const [newRoleTitle, setNewRoleTitle] = useState('');
  const [roleTitleTouched, setRoleTitleTouched] = useState(false);
  const [interviewType, setInterviewType] = useState('');
  const [jobFile, setJobFile] = useState(null);
  const [roleBusy, setRoleBusy] = useState(false);
  const [rolesLoading, setRolesLoading] = useState(false);
  const fileInputRef = useRef(null);
  const [fileKey, setFileKey] = useState(0);
  const rolesEndpointBase = "/roles";
  const [openingJd, setOpeningJd] = useState({});
  const [rubricModalOpen, setRubricModalOpen] = useState(false);
  const [rubricRole, setRubricRole] = useState(null);
  const [rubricQuestions, setRubricQuestions] = useState([]);
  const [rubricNotes, setRubricNotes] = useState('');
  const [rubricError, setRubricError] = useState('');
  const [rubricSending, setRubricSending] = useState(false);
  const [confirmRoleDelete, setConfirmRoleDelete] = useState({ open: false, id: null, title: '' });

  // Members panel state
  const [members, setMembers] = useState([]);
  const [memberName, setMemberName] = useState('');
  const [memberEmail, setMemberEmail] = useState('');
  const [memberRole, setMemberRole] = useState('member');
  const [membersLoading, setMembersLoading] = useState(false);
  const [selfMember, setSelfMember] = useState(null);
  const [currentMember, setCurrentMember] = useState(null);
  const [selectedClientBillingSummary, setSelectedClientBillingSummary] = useState(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingPortalBusy, setBillingPortalBusy] = useState(false);
  const urlDashboardState = useMemo(() => {
    if (typeof window === 'undefined') {
      return { clientId: '', tab: '', roleId: '' };
    }
    return parseDashboardReturnState(window.location.search || '');
  }, []);

  // --- Wix embed: report our height to parent so the iframe can auto-resize ---
  // Clamp heights only if needed, but allow reduction, and always allow shrinkage.
  function postEmbedSize() {
    if (typeof window === 'undefined') return;
    try {
      window.__EMBED__?.updateSize?.();
    } catch (_) {
      // noop
    }
  }
  // postSizeSoon triggers two postEmbedSize calls: one soon, one after 250ms (to catch DOM reflow)
  function postSizeSoon() {
    postEmbedSize();
    setTimeout(postEmbedSize, 50);
    setTimeout(postEmbedSize, 250);
  }

  // Tab selector
  const [activeTab, setActiveTab] = useState(() => urlDashboardState.tab || 'roles'); // roles | candidates | members | billing | feedback
  const [billingRoleId, setBillingRoleId] = useState(() => urlDashboardState.roleId || '');
  const [billingPurchaseQuantityInput, setBillingPurchaseQuantityInput] = useState('1');
  const [billingPurchaseBusy, setBillingPurchaseBusy] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [tourStepIndex, setTourStepIndex] = useState(0);
  const [tourTargetRect, setTourTargetRect] = useState(null);
  const tourAutoCheckRef = useRef(false);
  const urlStateHydratedRef = useRef(false);
  const [urlStateHydrationNonce, setUrlStateHydrationNonce] = useState(0);

  // initial ping; also on viewport resize
  useEffect(() => {
    postEmbedSize();
    const onResize = () => postSizeSoon();
    window.addEventListener('resize', onResize, { passive: true });
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // observe DOM mutations to catch expand/collapse or dynamic content changes
  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return;
    const mo = new MutationObserver(() => postSizeSoon());
    try {
      mo.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
    } catch (_) { /* noop */ }
    return () => mo.disconnect();
  }, []);

  // sort & filter UI state
  const [sortBy, setSortBy] = useState('created'); // 'name' | 'email' | 'role' | 'resume' | 'interview' | 'overall' | 'created'
  const [sortDir, setSortDir] = useState('desc');  // 'asc' | 'desc'
  const [roleSortBy, setRoleSortBy] = useState('role'); // 'role' | 'type'
  const [roleSortDir, setRoleSortDir] = useState('asc');  // 'asc' | 'desc'
  const [roleFilter, setRoleFilter] = useState(''); // role title or ''
  const [minOverall, setMinOverall] = useState(''); // numeric (string input)

  const hasMembership = isGlobalAdmin || (clients || []).length > 0 || scopedMemberships.length > 0

  const nameById = useMemo(
    () => Object.fromEntries(clients.map(c => [c.client_id, c.name])),
    [clients]
  )
  const roleById = useMemo(
    () => Object.fromEntries(clients.map(c => [c.client_id, c.role])),
    [clients]
  )
  const currentName = nameById[clientId] || clientId
  const currentRole =
    roleById[clientId] ||
    scopedMemberships.find(m => m.client_id === clientId)?.role ||
    'member'

  const effectiveRole = (currentMember?.role || currentRole || 'member').toLowerCase();

  const [testerChecked, setTesterChecked] = useState(false);
  const canManage = ['manager', 'admin', 'tester'].includes(effectiveRole);
  const isTester = effectiveRole === 'tester';
  const tourSteps = useMemo(() => {
    const steps = [
      {
        target: 'client-context',
        title: 'Client context',
        body: 'Choose which client account you are viewing here. Everything in the dashboard updates based on the selected client.',
      },
      {
        target: 'client-tabs',
        title: 'Dashboard navigation',
        body: 'Use these tabs to move between roles, candidates, members, and billing. Roles and candidates are the primary day-to-day views.',
      },
      {
        target: 'roles-section',
        title: 'Roles',
        body: 'Create and manage roles here. Roles control interview type, job description, rubric generation, and interview links.',
        tab: 'roles',
      },
      {
        target: 'candidates-section',
        title: 'Candidates',
        body: 'Candidate interview results appear here. Review transcripts, summaries, scores, and downloadable reports.',
        tab: 'candidates',
      },
    ];
    if (canManage) {
      steps.push({
        target: 'members-section',
        title: 'Members',
        body: 'Add or remove teammates here. Managers have full-function access. Members are read-only.',
        tab: 'members',
      });
    }
    steps.push({
      target: 'billing-section',
      title: 'Billing',
      body: 'View membership status and manage additional interview capacity here.',
      tab: 'billing',
    });
    return steps;
  }, [canManage]);
  const activeTourStep = tourOpen ? (tourSteps[tourStepIndex] || null) : null;
  const isLastTourStep = tourStepIndex >= tourSteps.length - 1;
  const startTour = () => {
    setTourStepIndex(0);
    setTourOpen(true);
  };
  const dismissTour = () => {
    setTourOpen(false);
    try {
      localStorage.setItem(CLIENT_DASH_TOUR_DISMISSED_KEY, '1');
    } catch {}
  };
  const completeTour = () => {
    setTourOpen(false);
    try {
      localStorage.setItem(CLIENT_DASH_TOUR_SEEN_KEY, '1');
    } catch {}
  };
  const nextTourStep = () => {
    if (isLastTourStep) {
      completeTour();
      return;
    }
    setTourStepIndex((idx) => Math.min(tourSteps.length - 1, idx + 1));
  };
  const previousTourStep = () => {
    setTourStepIndex((idx) => Math.max(0, idx - 1));
  };

  const testerSplashRole = (currentMember?.role || '').toLowerCase();
  const testerAcknowledgedAt = currentMember?.tester_acknowledged_at ?? null;
  const [showTesterNda, setShowTesterNda] = useState(false);
  const mainTabsVisible = hasMembership && !showTesterNda;
  const prefillName =
    selfMember?.name ||
    me?.user?.user_metadata?.full_name ||
    me?.user?.user_metadata?.name ||
    '';
  const prefillEmail = me?.user?.email || me?.email || '';
  const validatedSelectedClientId = useMemo(
    () => (clients.some((c) => c?.client_id === clientId) ? clientId : ''),
    [clients, clientId]
  );
  const selectedClientAccessOverrideMode = String(selectedClientBillingSummary?.access_override_mode || '').toLowerCase();
  const selectedClientBillingStatus = String(selectedClientBillingSummary?.billing_status || '').toLowerCase();
  const selectedClientAccessStatusLabel = selectedClientAccessOverrideMode === 'force_active'
    ? 'Access: Forced Active'
    : (selectedClientAccessOverrideMode === 'force_inactive' ? 'Access: Forced Inactive' : 'Access: Inherited');
  const selectedClientAccessStatusClass = selectedClientAccessOverrideMode === 'force_active'
    ? 'client-access-status client-access-status--forced-active'
    : (selectedClientAccessOverrideMode === 'force_inactive'
      ? 'client-access-status client-access-status--forced-inactive'
      : 'client-access-status client-access-status--inherited');
  const selectedClientIsEffectivelyInactive = useMemo(() => {
    if (!validatedSelectedClientId) return false;
    if (selectedClientAccessOverrideMode === 'force_inactive') return true;
    if (selectedClientAccessOverrideMode === 'force_active') return false;
    if (billingLoading) return false;
    if (!selectedClientBillingSummary || Object.keys(selectedClientBillingSummary).length === 0) return false;
    return selectedClientBillingStatus !== 'active';
  }, [validatedSelectedClientId, selectedClientAccessOverrideMode, selectedClientBillingStatus, billingLoading, selectedClientBillingSummary]);

  useEffect(() => {
    setShowTesterNda(testerSplashRole === 'tester' && testerAcknowledgedAt == null);
  }, [testerSplashRole, testerAcknowledgedAt, clientId]);

  useEffect(() => {
    if (tourAutoCheckRef.current) return;
    if (!hasMembership || !mainTabsVisible) return;
    let seen = false;
    let dismissed = false;
    try {
      seen = localStorage.getItem(CLIENT_DASH_TOUR_SEEN_KEY) === '1';
      dismissed = localStorage.getItem(CLIENT_DASH_TOUR_DISMISSED_KEY) === '1';
    } catch {}
    if (!seen && !dismissed) {
      setTourStepIndex(0);
      setTourOpen(true);
    }
    tourAutoCheckRef.current = true;
  }, [hasMembership, mainTabsVisible]);

  useEffect(() => {
    if (!tourOpen) return;
    const step = tourSteps[tourStepIndex];
    if (!step?.tab) return;
    if (selectedClientIsEffectivelyInactive && (step.tab === 'roles' || step.tab === 'candidates')) return;
    if (activeTab !== step.tab) setActiveTab(step.tab);
  }, [tourOpen, tourStepIndex, tourSteps, activeTab, selectedClientIsEffectivelyInactive]);

  useEffect(() => {
    if (!tourOpen) {
      setTourTargetRect(null);
      return;
    }
    const step = tourSteps[tourStepIndex];
    if (!step) {
      setTourTargetRect(null);
      return;
    }
    let raf = 0;
    const update = () => {
      const el = document.querySelector(`[data-tour="${step.target}"]`);
      if (!el) {
        setTourTargetRect(null);
        return;
      }
      const rect = el.getBoundingClientRect();
      setTourTargetRect({
        top: Math.max(8, rect.top - 6),
        left: Math.max(8, rect.left - 6),
        width: Math.max(0, rect.width + 12),
        height: Math.max(0, rect.height + 12),
      });
    };
    const schedule = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    schedule();
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
    };
  }, [tourOpen, tourStepIndex, tourSteps, activeTab]);

  useEffect(() => {
    let alive = true;
    if (!validatedSelectedClientId) {
      setSelectedClientBillingSummary(null);
      setBillingLoading(false);
      return () => {
        alive = false;
      };
    }
    (async () => {
      try {
        setSelectedClientBillingSummary(null);
        setBillingLoading(true);
        const qs = `?client_id=${encodeURIComponent(validatedSelectedClientId)}`;
        const resp = await apiGet('/clients/billing/summary' + qs);
        if (!alive) return;
        const item = Array.isArray(resp?.items) ? (resp.items[0] || null) : null;
        setSelectedClientBillingSummary(item);
      } catch (e) {
        if (!alive) return;
        setSelectedClientBillingSummary(null);
      } finally {
        if (alive) setBillingLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [validatedSelectedClientId]);

  useEffect(() => {
    let alive = true;
    if (!me?.user?.id) {
      setCurrentMember(null);
      return () => {
        alive = false;
      };
    }
    if (!validatedSelectedClientId) {
      return () => {
        alive = false;
      };
    }
    (async () => {
      try {
        const resp = await apiGet(`/client-members/me?client_id=${encodeURIComponent(validatedSelectedClientId)}`);
        if (!alive) return;
        const member = (resp && typeof resp.member === 'object' && resp.member) ? resp.member : null;
        setCurrentMember({
          role: typeof resp?.role === 'string' ? resp.role : (member?.role || null),
          tester_acknowledged_at: resp?.tester_acknowledged_at ?? member?.tester_acknowledged_at ?? null,
          tester_acknowledged_ip: resp?.tester_acknowledged_ip ?? member?.tester_acknowledged_ip ?? null,
        });
      } catch (e) {
        if (!alive) return;
        setCurrentMember(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [validatedSelectedClientId, me?.user?.id]);

  useEffect(() => {
    if (activeTab === 'roles') return;
    if (!canManage && activeTab === 'members') {
      setActiveTab(selectedClientIsEffectivelyInactive ? 'billing' : 'candidates');
    }
  }, [canManage, activeTab, selectedClientIsEffectivelyInactive]);

  useEffect(() => {
    if (!selectedClientIsEffectivelyInactive) return;
    if (activeTab === 'roles' || activeTab === 'candidates') {
      setActiveTab(canManage ? 'members' : 'billing');
    }
  }, [selectedClientIsEffectivelyInactive, activeTab, canManage]);

  useEffect(() => {
    if (activeTab === 'feedback' && !isTester) {
      setActiveTab(canManage ? 'roles' : 'candidates');
    }
  }, [activeTab, isTester, canManage]);

  useEffect(() => {
    setSelfMember(null);
  }, [clientId]);

  useEffect(() => {
    if (!isTester || activeTab !== 'feedback') return;
    if (!validatedSelectedClientId || !me?.user?.id) return;
    if (selfMember) return;
    const fromMembers = members.find(
      (m) => m.user_id === me.user.id || (m.email && m.email === me.user.email)
    );
    if (fromMembers) {
      setSelfMember(fromMembers);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const resp = await apiGet(`/client-members/me?client_id=${encodeURIComponent(validatedSelectedClientId)}`);
        if (!alive) return;
        const item = resp?.member || resp?.item || null;
        if (item) setSelfMember(item);
      } catch (e) {
        if (!alive) return;
        console.warn('[feedback] me-membership fetch failed', e?.message || e);
      }
    })();
    return () => { alive = false; };
  }, [isTester, activeTab, me?.user?.id, me?.user?.email, members, validatedSelectedClientId, selfMember]);

  useEffect(() => {
    postSizeSoon();
    setTimeout(postSizeSoon, 250);
  }, [activeTab]);

  const pctText = (v) =>
    (typeof v === 'number' && isFinite(v)) || v === 0
      ? `${Math.max(0, Math.min(100, v))}%`
      : '—'
  const fmtDate = (iso) => {
    if (!iso) return '—'
    let normalized = iso
    if (typeof normalized === 'string') {
      const trimmed = normalized.trim()
      if (!trimmed) return '—'
      const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed)
      normalized = hasTimezone ? trimmed : `${trimmed}Z`
    }
    const date = new Date(normalized)
    if (Number.isNaN(date.getTime())) return '—'
    try {
      const formatted = date.toLocaleString('en-US', {
        timeZone: 'America/Chicago',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZoneName: 'short',
      })
      const normalized = formatted
        .replace(/\sGMT[+-]\d{1,2}(?::\d{2})?/g, '')
        .replace(/\b(?:CDT|CST)\b/g, 'CST')
      return /\bCST\b/.test(normalized) ? normalized : `${normalized} CST`
    } catch {
      return '—'
    }
  }

  function toggleRow(id) {
    setExpandedId(prev => {
      const next = prev === id ? null : id;
      postSizeSoon();
      setTimeout(postSizeSoon, 250);
      return next;
    });
  }

  async function openSigned(interviewId, kind) {
    if (!interviewId) return
    const key = `${interviewId}:${kind}`
    try {
      setOpening(p => ({ ...p, [key]: true }))
      const qs =
        `?interview_id=${encodeURIComponent(interviewId)}&kind=${encodeURIComponent(kind)}`
      const { url } = await apiGet('/files/signed-url' + qs)
      if (!url) throw new Error('No signed URL returned')
      window.open(url, '_blank', 'noopener,noreferrer')
      showToast(kind === 'transcript' ? 'Transcript opened' : 'File opened', 'success')
    } catch (e) {
      setError(String(e?.message || e))
      showToast(String(e?.message || 'Could not open file'), 'error')
    } finally {
      setOpening(p => ({ ...p, [key]: false }))
      // After content change, trigger postSizeSoon twice
      postSizeSoon();
      setTimeout(postSizeSoon, 250);
    }
  }

  async function generatePdfForRow(row) {
    const interviewId = row.latest_interview_id || null;
    const key = `${interviewId || row.id}:pdf`;
    try {
      setOpening(p => ({ ...p, [key]: true }));
      const payload = {
        candidate_id: row.candidate?.id || null,
        role_id: row.role?.id || null,
        interview_id: interviewId
      };
      const resp = await apiPost('/reports/generate', payload);
      const url = resp?.signed_url || resp?.url || resp?.report_url || null;
      if (url) {
        window.open(url, '_blank', 'noopener,noreferrer');
        showToast('Report generated — opening PDF', 'success');
        return;
      }
      if (interviewId) {
        await apiDownload(
          `/reports/${encodeURIComponent(interviewId)}/download`,
          `Candidate_Report_${interviewId}.pdf`
        );
        showToast('Report downloaded', 'success');
        return;
      }
      throw new Error('Report URL not available.');
    } catch (e) {
      setError(String(e?.message || e));
      showToast(String(e?.message || 'Could not generate report'), 'error');
    } finally {
      setOpening(p => ({ ...p, [key]: false }));
      // After content change, trigger postSizeSoon twice
      postSizeSoon();
      setTimeout(postSizeSoon, 250);
    }
  }

  const fetchRolesForClient = async (clientIdArg, options = {}) => {
    const silent = options?.silent === true;
    const targetId = clientIdArg || clientId;
    if (!targetId || !canManage) {
      setRoles([]);
      return;
    }
    const endpoint = `${rolesEndpointBase}?client_id=${encodeURIComponent(targetId)}`;
    if (!silent) setRolesLoading(true);
    try {
      const resp = await apiGet(endpoint);
      const items = Array.isArray(resp?.items) ? resp.items : [];
      const sorted = [...items].sort(
        (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)
      );
      setRoles(sorted);
    } catch (e) {
      const status = e?.status || e?.response?.status;
      const detail =
        e?.data?.detail ||
        e?.response?.data?.detail ||
        e?.data?.message ||
        e?.message ||
        'Failed to load roles';
      const requestId = e?.data?.request_id || e?.response?.data?.request_id;
      if (requestId) console.error('[roles] request_id', requestId);
      console.error('[roles] fetch error', {
        clientId: targetId,
        endpoint,
        status,
        detail,
        request_id: requestId || null,
        keys: e?.data ? Object.keys(e.data || {}) : []
      });
      setRoles([]);
      if (!silent) showToast(detail || 'Failed to load roles', 'error');
    } finally {
      if (!silent) setRolesLoading(false);
    }
  };

  // Fetch roles when needed
  useEffect(() => {
    if (activeTab !== 'roles') return;
    fetchRolesForClient(clientId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, canManage, activeTab]);

  useEffect(() => {
    if (activeTab !== 'billing') return;
    if (!validatedSelectedClientId || !canManage) return;
    fetchRolesForClient(validatedSelectedClientId, { silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, validatedSelectedClientId, canManage]);

  // Fetch members when needed
  useEffect(() => {
    if (!canManage || activeTab !== 'members') {
      setMembers([]);
      return;
    }
    if (!validatedSelectedClientId) return;
    let alive = true;
    (async () => {
      try {
        setMembersLoading(true);
        const qs = `?client_id=${encodeURIComponent(validatedSelectedClientId)}`;
        const resp = await apiGet('/client-members' + qs);
        if (!alive) return;
        setMembers(resp?.items || []);
      } catch (e) {
        if (!alive) return;
        showToast(String(e?.message || 'Failed to load members'), 'error');
      } finally {
        if (alive) setMembersLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [clientId, canManage, activeTab, validatedSelectedClientId]);

  const refreshMembersSilently = async (targetClientId = validatedSelectedClientId) => {
    if (!canManage || !targetClientId) return;
    try {
      const qs = `?client_id=${encodeURIComponent(targetClientId)}`;
      const resp = await apiGet('/client-members' + qs);
      setMembers(resp?.items || []);
    } catch (_) {}
  };

  const refreshBillingSummarySilently = async (targetClientId = validatedSelectedClientId) => {
    if (!targetClientId) return;
    try {
      const qs = `?client_id=${encodeURIComponent(targetClientId)}`;
      const resp = await apiGet('/clients/billing/summary' + qs);
      const item = Array.isArray(resp?.items) ? (resp.items[0] || null) : null;
      setSelectedClientBillingSummary(item);
    } catch (_) {}
  };

  useEffect(() => {
    let lastRefreshAt = 0;
    const REFRESH_DEBOUNCE_MS = 1000;
    const refreshOnFocus = async () => {
      if (!validatedSelectedClientId) return;
      if (activeTab === 'candidates' && !selectedClientIsEffectivelyInactive) {
        await fetchRows({ silent: true, reason: 'focus' });
        return;
      }
      if (activeTab === 'roles' && canManage && !selectedClientIsEffectivelyInactive) {
        await fetchRolesForClient(validatedSelectedClientId, { silent: true });
        return;
      }
      if (activeTab === 'members' && canManage) {
        await refreshMembersSilently(validatedSelectedClientId);
        return;
      }
      if (activeTab === 'billing') {
        await refreshBillingSummarySilently(validatedSelectedClientId);
      }
    };
    const triggerRefresh = () => {
      const now = Date.now();
      if (now - lastRefreshAt < REFRESH_DEBOUNCE_MS) return;
      lastRefreshAt = now;
      void refreshOnFocus();
    };
    const onFocus = () => { triggerRefresh(); };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') triggerRefresh();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [activeTab, canManage, selectedClientIsEffectivelyInactive, validatedSelectedClientId, clientId]);

  const uploadJDToBackend = async (roleId, file) => {
    const form = new FormData();
    form.append('file', file);
    const qs = new URLSearchParams({ client_id: clientId, role_id: roleId }).toString();
    return api.upload(`/roles-upload/upload-jd?${qs}`, form);
  };

  const handleRoleFileFromPicker = (file) => {
    setJobFile(file || null);
  };

  const openRubricModal = (role) => {
    const questions = extractRubricQuestions(role?.rubric);
    setRubricRole(role || null);
    setRubricQuestions(questions);
    setRubricNotes('');
    setRubricError('');
    setRubricModalOpen(true);
  };

  const closeRubricModal = () => {
    setRubricModalOpen(false);
    setRubricRole(null);
    setRubricQuestions([]);
    setRubricNotes('');
    setRubricError('');
  };

  const requestRubricChanges = async () => {
    if (!rubricRole?.id) return;
    setRubricSending(true);
    setRubricError('');
    try {
      await apiPost(`/roles/${encodeURIComponent(rubricRole.id)}/rubric-request-changes`, {
        notes: rubricNotes,
        questions: rubricQuestions,
      });
      showToast('Rubric change request sent', 'success');
      closeRubricModal();
    } catch (e) {
      const detail = e?.data?.detail || e?.data?.error || e?.message || 'Request failed';
      const message = toMessage(detail, 'Request failed');
      setRubricError(message);
      showToast(message, 'error');
    } finally {
      setRubricSending(false);
    }
  };

  const openRoleJd = async (role) => {
    const roleId = role?.id;
    if (!roleId) return;
    setOpeningJd((prev) => ({ ...prev, [roleId]: true }));
    try {
      const data = await apiGet(`/roles/${encodeURIComponent(roleId)}/jd-signed-url`);
      if (!data?.url) throw new Error('No URL returned');
      window.open(data.url, '_blank', 'noopener,noreferrer');
      showToast('Job description opened', 'success');
    } catch (e) {
      console.error('[roles] jd_open_failed', {
        role_id: roleId,
        error: e?.message || e,
        detail: e?.data?.detail || e?.data?.error || null,
      });
      showToast('Could not open Job Description', 'error');
    } finally {
      setOpeningJd((prev) => ({ ...prev, [roleId]: false }));
    }
  };

  const resolveClientIdForTesterAck = () => {
    if (validatedSelectedClientId) return validatedSelectedClientId;
    const defaultClientId = me?.client_scope?.default_client_id || me?.default_client_id || null;
    if (defaultClientId && clients.some((c) => c?.client_id === defaultClientId)) return defaultClientId;
    const membershipId = scopedMemberships.find((m) =>
      clients.some((c) => c?.client_id === m?.client_id)
    )?.client_id || null;
    if (membershipId) return membershipId;
    if (clients.length) return clients[0]?.client_id || null;
    return null;
  };

  const submitTesterAck = async () => {
    const resolvedClientId = resolveClientIdForTesterAck();
    if (!resolvedClientId) {
      showToast('No client selected', 'error');
      return;
    }
    try {
      await apiPost('/client-members/tester-ack', { client_id: resolvedClientId, accepted: true });
      try {
        const resp = await apiGet(`/client-members/me?client_id=${encodeURIComponent(resolvedClientId)}`);
        const member = (resp && typeof resp.member === 'object' && resp.member) ? resp.member : null;
        setCurrentMember({
          role: typeof resp?.role === 'string' ? resp.role : (member?.role || 'tester'),
          tester_acknowledged_at: resp?.tester_acknowledged_at ?? member?.tester_acknowledged_at ?? new Date().toISOString(),
          tester_acknowledged_ip: resp?.tester_acknowledged_ip ?? member?.tester_acknowledged_ip ?? null,
        });
      } catch {
        setCurrentMember((prev) => ({
          role: prev?.role || 'tester',
          tester_acknowledged_at: prev?.tester_acknowledged_at || new Date().toISOString(),
          tester_acknowledged_ip: prev?.tester_acknowledged_ip || null,
        }));
      }
      setShowTesterNda(false);
      showToast('Agreement recorded', 'success');
    } catch (e) {
      const rid = e?.response?.data?.request_id;
      if (rid) console.error('[tester-ack] request_id', rid);
      const status = e?.response?.status;
      if (status === 401 || status === 403) {
        showToast('You do not have access to acknowledge for this client.', 'error');
      } else {
        showToast('Unable to save agreement. Please try again.', 'error');
      }
    }
  };

  const safeCopy = async (text) => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        showToast('Link copied', 'success');
        return;
      }
      throw new Error('clipboard_api_unavailable');
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        ta.setAttribute('readonly', '');
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showToast('Link copied', 'success');
      } catch (err) {
        console.warn('Copy failed:', err);
        showToast('Could not copy link', 'error');
      }
    }
  };

  const manageBilling = async () => {
    if (!validatedSelectedClientId || billingPortalBusy) return;
    try {
      setBillingPortalBusy(true);
      const resp = await apiPost('/clients/billing/portal-session', {
        client_id: validatedSelectedClientId,
        tab: activeTab
      });
      const url = resp?.url;
      if (!url) throw new Error('No billing portal URL returned');
      if (window?.parent && window.parent !== window) {
        try {
          if (window.top) {
            window.top.location.href = url;
            return;
          }
        } catch (_) {
          // fallback below
        }
        window.open(url, '_blank', 'noopener,noreferrer');
        return;
      }
      window.location.assign(url);
    } catch (e) {
      showToast(String(e?.message || 'Could not open billing portal'), 'error');
    } finally {
      setBillingPortalBusy(false);
    }
  };

  const startAdditionalInterviewsCheckout = async () => {
    const parsedQuantity = Number(billingPurchaseQuantityInput);
    const quantity = Number.isInteger(parsedQuantity) ? parsedQuantity : NaN;
    if (!validatedSelectedClientId || !billingRoleSelectValue || !Number.isInteger(quantity) || quantity <= 0 || billingPurchaseBusy) return;
    try {
      setBillingPurchaseBusy(true);
      const resp = await apiPost('/clients/billing/additional-interviews/checkout-session', {
        client_id: validatedSelectedClientId,
        role_id: billingRoleSelectValue,
        quantity,
        tab: activeTab
      });
      const url = resp?.url;
      if (!url) throw new Error('No checkout URL returned');
      if (window?.parent && window.parent !== window) {
        try {
          if (window.top) {
            window.top.location.href = url;
            return;
          }
        } catch (_) {
          // fallback below
        }
        window.open(url, '_blank', 'noopener,noreferrer');
        return;
      }
      window.location.assign(url);
    } catch (e) {
      const detail =
        e?.data?.detail ||
        e?.response?.data?.detail ||
        e?.data?.error ||
        e?.response?.data?.error ||
        e?.message ||
        'Could not start additional interview checkout';
      showToast(toMessage(detail, 'Could not start additional interview checkout'), 'error');
    } finally {
      setBillingPurchaseBusy(false);
    }
  };

  const createRole = async () => {
    if (!clientId) return;
    const title = newRoleTitle.trim();
    if (!title) {
      setRoleTitleTouched(true);
      return;
    }
    if (!interviewType) {
      showToast('Please choose an interview type before creating the role.', 'error');
      return;
    }
    if (!jobFile) {
      showToast('Please choose a Job Description file (PDF or DOCX) before creating the role.', 'error');
      return;
    }
    setRoleBusy(true);
    try {
      const form = new FormData();
      form.append('client_id', clientId);
      form.append('role_title', title);
      form.append('interview_type', interviewType);
      form.append('tab', activeTab);
      form.append('file', jobFile);
      const resp = await api.upload('/clients/roles/checkout-session', form);
      const url = resp?.url;
      if (!url) throw new Error('Missing checkout URL');
      if (window?.parent && window.parent !== window) {
        try {
          if (window.top) {
            window.top.location.href = url;
            return;
          }
        } catch (_) {
          // fallback below
        }
        window.open(url, '_blank', 'noopener,noreferrer');
        return;
      }
      window.location.assign(url);
    } catch (e) {
      const status = e?.status || e?.response?.status;
      const requestId = e?.data?.request_id || e?.response?.data?.request_id;
      const detail =
        e?.data?.detail ||
        e?.response?.data?.detail ||
        e?.data?.message ||
        e?.message ||
        'Failed to start role checkout';
      if (requestId) console.error('[roles] request_id', requestId);
      console.error('[roles] checkout error', {
        clientId,
        status,
        detail,
        request_id: requestId || null
      });
      showToast(detail || 'Failed to start role checkout', 'error');
    } finally {
      setRoleBusy(false);
    }
  };

  const roleTitleError = roleTitleTouched && !newRoleTitle.trim();
  const rolesTableGridTemplate = canManage
    ? 'minmax(220px, 2.4fr) 100px 180px 84px 84px 132px 88px'
    : 'minmax(220px, 2.4fr) 100px 180px 84px 84px 132px';
  const displayRoles = useMemo(() => {
    const toSortText = (value) => {
      const text = String(value || '').trim().toLowerCase();
      return text || null;
    };
    const compareNullable = (a, b, dir) => {
      const aNull = a == null;
      const bNull = b == null;
      if (aNull && bNull) return 0;
      if (aNull) return 1;
      if (bNull) return -1;
      if (a < b) return dir === 'asc' ? -1 : 1;
      if (a > b) return dir === 'asc' ? 1 : -1;
      return 0;
    };

    const indexed = (roles || []).map((item, index) => ({ item, index }));
    indexed.sort((a, b) => {
      let cmp = 0;
      if (roleSortBy === 'role') {
        cmp = compareNullable(toSortText(a.item?.title), toSortText(b.item?.title), roleSortDir);
      } else {
        cmp = compareNullable(toSortText(a.item?.interview_type), toSortText(b.item?.interview_type), roleSortDir);
      }
      if (cmp !== 0) return cmp;
      return a.index - b.index;
    });
    return indexed.map(({ item }) => item);
  }, [roles, roleSortBy, roleSortDir]);
  const selectedBillingRole = useMemo(
    () => roles.find((r) => String(r?.id) === String(billingRoleId)) || null,
    [roles, billingRoleId]
  );
  const billingRoleSelectValue = selectedBillingRole ? String(selectedBillingRole.id) : '';
  const billingPurchaseQuantity = Number(billingPurchaseQuantityInput);
  const billingPurchaseQuantityIsValid = Number.isInteger(billingPurchaseQuantity) && billingPurchaseQuantity > 0;
  const canPurchaseAdditionalInterviews =
    !!validatedSelectedClientId &&
    !!billingRoleSelectValue &&
    billingPurchaseQuantityIsValid &&
    !billingPurchaseBusy;
  const billingPurchasedGridTemplate = 'minmax(220px, 2.2fr) minmax(120px, 1fr)';
  const normalizeCapacityValue = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.floor(n));
  };

  const deleteRole = async (id) => {
    try {
      const url = `${rolesEndpointBase}/admin/roles?id=${encodeURIComponent(id)}&client_id=${encodeURIComponent(clientId)}`;
      await apiDelete(url);
      setRoles((prev) => prev.filter((r) => r.id !== id));
      await fetchRolesForClient(clientId, { silent: true });
      postSizeSoon();
      setTimeout(postSizeSoon, 300);
      showToast('Role deleted', 'success');
    } catch (err) {
      const msg = err?.message || 'Could not delete role. Please refresh and try again.';
      const requestId = err?.data?.request_id || err?.response?.data?.request_id;
      if (requestId) console.error('[roles] request_id', requestId);
      console.error('Role delete failed:', err);
      showToast(msg, 'error');
    }
  };
  const openDeleteRoleConfirm = (id, title) => {
    setConfirmRoleDelete({ open: true, id, title: title || '' });
  };
  const closeDeleteRoleConfirm = () => {
    setConfirmRoleDelete({ open: false, id: null, title: '' });
  };
  const confirmDeleteRole = async () => {
    const targetId = confirmRoleDelete.id;
    closeDeleteRoleConfirm();
    if (!targetId) return;
    await deleteRole(targetId);
  };

  const addMember = async () => {
    if (!validatedSelectedClientId) return;
    const e = memberEmail.trim();
    const n = memberName.trim();
    if (!e || !n) return;
    try {
      const resp = await apiPost('/client-members', { client_id: validatedSelectedClientId, email: e, name: n, role: memberRole });
      if (resp?.item) {
        setMembers([resp.item, ...members]);
        setMemberEmail('');
        setMemberName('');
        setMemberRole('member');
        await refreshMembersSilently(validatedSelectedClientId);
        postSizeSoon();
        setTimeout(postSizeSoon, 300);
        showToast('Member added', 'success');
      }
    } catch (err) {
      const status = err?.status || err?.response?.status;
      const code = err?.data?.error || err?.response?.data?.error;
      if (status === 409 || code === 'email_in_use' || code === 'client_admin_email_in_use') {
        showToast('Email address already exists', 'error');
      } else {
        const detail = err?.data?.detail || err?.data?.message || err?.response?.data?.detail || err?.response?.data?.message;
        showToast(detail || err?.message || 'Could not add member.', 'error');
      }
    }
  };

  const removeMember = async (id) => {
    if (!validatedSelectedClientId) return;
    try {
      await apiDelete(`/client-members/${id}?client_id=${encodeURIComponent(validatedSelectedClientId)}`);
      setMembers((prev) => prev.filter((m) => m.id !== id));
      await refreshMembersSilently(validatedSelectedClientId);
      postSizeSoon();
      setTimeout(postSizeSoon, 300);
      showToast('Member removed', 'success');
    } catch (err) {
      const code = err?.data?.code || err?.response?.data?.code;
      if (code === 'self_delete_forbidden') {
        showToast('Not allowed to delete yourself', 'error');
        return;
      }
      showToast(err?.message || 'Could not remove member.', 'error');
    }
  };

  // Load me + clients
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        setLoading(true)
        const [meResp, myClients] = await Promise.all([
          apiGet('/auth/me'),
          apiGet('/clients/my'),
        ])
        if (!alive) return
        setMe(meResp)
        const list = myClients?.items || []
        setClients(list)
        const listIds = new Set(list.map((c) => c?.client_id).filter(Boolean))
        const defaultClientId = meResp?.client_scope?.default_client_id || meResp?.default_client_id || ''
        const urlClientId = urlDashboardState.clientId && listIds.has(urlDashboardState.clientId)
          ? urlDashboardState.clientId
          : ''
        const memberships = Array.isArray(meResp?.client_scope?.memberships)
          ? meResp.client_scope.memberships
          : (Array.isArray(meResp?.memberships) ? meResp.memberships : [])
        const first =
          urlClientId ||
          (defaultClientId && listIds.has(defaultClientId) ? defaultClientId : '') ||
          list[0]?.client_id ||
          memberships.find((m) => listIds.has(m?.client_id))?.client_id ||
          memberships[0]?.client_id ||
          ''
        setClientId(first)
        if (urlDashboardState.tab) setActiveTab(urlDashboardState.tab)
        if (urlDashboardState.roleId) setBillingRoleId(urlDashboardState.roleId)
      } catch (e) {
        setError(String(e?.message || e))
      } finally {
        if (alive) {
          urlStateHydratedRef.current = true;
          setUrlStateHydrationNonce((n) => n + 1);
        }
        setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (!clients.length) return;
    const hasSelected = clients.some((c) => c?.client_id === clientId);
    if (hasSelected) return;
    const fallback = clients[0]?.client_id || '';
    if (fallback && fallback !== clientId) {
      setClientId(fallback);
    }
  }, [clients, clientId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!urlStateHydratedRef.current) return;
    if (!clients.length && !clientId) return;
    const params = new URLSearchParams(window.location.search || '');
    if (clientId) params.set('client_id', clientId);
    else params.delete('client_id');
    const tab = VALID_DASHBOARD_TABS.has(String(activeTab || '').toLowerCase())
      ? String(activeTab || '').toLowerCase()
      : '';
    if (tab) params.set('tab', tab);
    else params.delete('tab');
    const roleId = tab === 'billing' && billingRoleId ? String(billingRoleId) : '';
    if (roleId) params.set('role_id', roleId);
    else params.delete('role_id');
    const nextSearch = params.toString();
    const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash || ''}`;
    const currentUrl = `${window.location.pathname}${window.location.search || ''}${window.location.hash || ''}`;
    if (nextUrl !== currentUrl) {
      window.history.replaceState(window.history.state, '', nextUrl);
    }
    if (window.parent && window.parent !== window) {
      try {
        window.parent.postMessage({
          type: 'DASHBOARD_QUERY_STATE',
          client_id: clientId || '',
          tab: tab || '',
          role_id: roleId || null,
        }, '*');
      } catch (_) {
        // noop
      }
    }
  }, [clients.length, clientId, activeTab, billingRoleId, urlStateHydrationNonce]);

  // Load candidate-centric rows for selected client
  useEffect(() => {
    stopPolling()
    setExpandedId(null)
    if (!clientId) {
      setItems([])
      return
    }
    fetchRows({ silent: false, reason: 'initial' })
    return () => {
      stopPolling()
    }
  }, [clientId])

  // Normalize for table
  const rows = useMemo(() => {
    return (items || []).map(r => {
      const row = {
      id: r.id,
      created_at: r.created_at,
      latest_interview_id: r.latest_interview_id || null,
      latest_report_url: r.latest_report_url || null,

      candidate: {
        id: r.candidate?.id || null,
        name: r.candidate?.name || '',
        email: r.candidate?.email || '',
      },
      role: r.role || null,

      video_url: r.video_url && !isDailyRoomUrl(r.video_url) ? r.video_url : null,
      transcript_url: r.transcript_url || null,
      analysis_url: r.analysis_url || null,
      transcript: typeof r.transcript === 'string' ? r.transcript : '',
      analysis: r.analysis ?? r.interview?.analysis ?? r.interviewAnalysis ?? null,
      interviewAnalysis: r.interviewAnalysis ?? null,
      transcript_scores: r.transcript_scores ?? r.interview?.transcript_scores ?? null,
      perception_scores: r.perception_scores ?? r.interview?.perception_scores ?? null,
      interview_summary: typeof r.interview_summary === 'string'
        ? r.interview_summary
        : (typeof r.interview?.interview_summary === 'string' ? r.interview.interview_summary : ''),
      unanswered_candidate_questions: Array.isArray(r.unanswered_candidate_questions)
        ? r.unanswered_candidate_questions
        : (Array.isArray(r.interview?.unanswered_candidate_questions) ? r.interview.unanswered_candidate_questions : []),

      has_video: r.has_video ?? (!!r.video_url && !isDailyRoomUrl(r.video_url)),
      has_transcript: typeof r.transcript === 'string' && r.transcript.trim().length > 0,
      has_analysis: r.has_analysis ?? !!r.analysis_url,

      resume_score: r.resume_score ?? null,
      interview_score: r.interview_score ?? null,
      overall_score: r.overall_score ?? null,

      resume_analysis: {
        experience: r.resume_analysis?.experience ?? null,
        skills: r.resume_analysis?.skills ?? null,
        education: r.resume_analysis?.education ?? null,
        summary: r.resume_analysis?.summary || '',
      },
      interview_analysis: {
        clarity: r.interview_analysis?.clarity ?? null,
        confidence: r.interview_analysis?.confidence ?? null,
        engagement: r.interview_analysis?.engagement ?? r.interview_analysis?.body_language ?? null,
        summary: typeof r.interview_analysis?.summary === 'string'
          ? r.interview_analysis.summary
          : (typeof r.interview_summary === 'string' ? r.interview_summary : '')
      },
    };
      row.is_complete = isRowComplete(row);
      return row;
    })
  }, [items])

  const expandedRow = useMemo(() => {
    return (items || []).find(i => i.id === expandedId) || null;
  }, [items, expandedId]);

  // Ping parent when table scope changes (or first load completes)
  useEffect(() => {
    postSizeSoon();
    setTimeout(postSizeSoon, 250);
  }, [loading, rows.length, roleFilter, minOverall, sortBy, sortDir, expandedId, expandedRow]);

  // unique role titles available in current rows
  const availableRoles = useMemo(() => {
    const set = new Set((rows || []).map(r => r.role?.title).filter(Boolean));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  // apply filters + sorting
  const displayRows = useMemo(() => {
    let out = [...(rows || [])];

    if (roleFilter) {
      out = out.filter(r => (r.role?.title || '') === roleFilter);
    }
    const min = parseInt(minOverall, 10);
    if (!Number.isNaN(min)) {
      out = out.filter(r => {
        const v = typeof r.overall_score === 'number' ? r.overall_score : -1;
        return v >= min;
      });
    }

    out.sort((a, b) => {
      let av, bv;
      if (sortBy === 'name') {
        av = (a.candidate.name || '').toLowerCase();
        bv = (b.candidate.name || '').toLowerCase();
        if (av < bv) return sortDir === 'asc' ? -1 : 1;
        if (av > bv) return sortDir === 'asc' ? 1 : -1;
        return 0;
      } else if (sortBy === 'email') {
        av = typeof a?.candidate?.email === 'string' ? a.candidate.email.trim().toLowerCase() : '';
        bv = typeof b?.candidate?.email === 'string' ? b.candidate.email.trim().toLowerCase() : '';
        const aMissing = !av;
        const bMissing = !bv;
        if (aMissing && bMissing) return 0;
        if (aMissing) return 1;
        if (bMissing) return -1;
        if (av < bv) return sortDir === 'asc' ? -1 : 1;
        if (av > bv) return sortDir === 'asc' ? 1 : -1;
        return 0;
      } else if (sortBy === 'role') {
        av = (a.role?.title || '').toLowerCase();
        bv = (b.role?.title || '').toLowerCase();
        if (av < bv) return sortDir === 'asc' ? -1 : 1;
        if (av > bv) return sortDir === 'asc' ? 1 : -1;
        return 0;
      } else if (sortBy === 'resume' || sortBy === 'interview' || sortBy === 'overall') {
        const aRaw = sortBy === 'resume' ? a.resume_score : sortBy === 'interview' ? a.interview_score : a.overall_score;
        const bRaw = sortBy === 'resume' ? b.resume_score : sortBy === 'interview' ? b.interview_score : b.overall_score;
        const aNum = Number(aRaw);
        const bNum = Number(bRaw);
        const aMissing = !Number.isFinite(aNum);
        const bMissing = !Number.isFinite(bNum);
        if (aMissing && bMissing) return 0;
        if (aMissing) return 1;
        if (bMissing) return -1;
        return sortDir === 'asc' ? aNum - bNum : bNum - aNum;
      } else {
        av = new Date(a.created_at || 0).getTime();
        bv = new Date(b.created_at || 0).getTime();
        return sortDir === 'asc' ? av - bv : bv - av;
      }
    });

    return out;
  }, [rows, roleFilter, minOverall, sortBy, sortDir]);

  // rows actually shown in the table (respect "Show more / Show less")
  const visibleRows = useMemo(() => {
    return (displayRows || []).slice(0, visibleCount);
  }, [displayRows, visibleCount]);

  useEffect(() => {
    const state = pollRef.current;
    if (activeTab !== 'candidates') {
      if (state.active) stopPolling();
      return;
    }
    const pendingVisible = countPerceptionPendingRows(visibleRows);
    if (pendingVisible > 0) {
      if (!state.active) startPolling('perception_pending');
      else scheduleNextPoll();
      return;
    }
    if (state.active) stopPolling();
  }, [activeTab, visibleRows]);

  // reset visible count when scope/order changes (and resize)
  useEffect(() => {
    setVisibleCount(INITIAL_COUNT);
    postSizeSoon();
    setTimeout(postSizeSoon, 250);
  }, [clientId, roleFilter, minOverall, sortBy, sortDir]);

  const exportCandidatesCsv = () => {
    const rowsForExport = visibleRows || [];
    const pctCsv = (v) =>
      (typeof v === 'number' && isFinite(v)) || v === 0
        ? `${Math.max(0, Math.min(100, v))}%`
        : '';
    const fmtDateCsv = (iso) => {
      if (!iso) return '';
      const formatted = fmtDate(iso);
      return formatted === '—' ? '' : formatted;
    };
    const headers = [
      'Name',
      'Email',
      'Role',
      'Resume Score',
      'Interview Score',
      'Overall Score',
      'Experience Score',
      'Skills Score',
      'Education Score',
      'Resume Analysis Summary',
      'Clarity Score',
      'Confidence Score',
      'Engagement Score',
      'Interview Analysis Summary',
      'Created At'
    ];
    const csvRows = rowsForExport.map((r) => [
      r.candidate?.name || '',
      r.candidate?.email || '',
      r.role?.title || '',
      pctCsv(r.resume_score),
      pctCsv(r.interview_score),
      pctCsv(r.overall_score),
      pctCsv(r.resume_analysis?.experience),
      pctCsv(r.resume_analysis?.skills),
      pctCsv(r.resume_analysis?.education),
      r.resume_analysis?.summary || '',
      pctCsv(r.interview_analysis?.clarity),
      pctCsv(r.interview_analysis?.confidence),
      pctCsv(r.interview_analysis?.engagement),
      r.interview_analysis?.summary || '',
      fmtDateCsv(r.created_at)
    ]);
    const csvText = buildCsv(headers, csvRows);
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    downloadCsv(csvText, `alphascreen-candidates-${yyyy}-${mm}-${dd}.csv`);
  };

  const tourCardStyle = (() => {
    const base = {
      position: 'fixed',
      left: '50%',
      top: 24,
      transform: 'translateX(-50%)',
      width: 360,
      maxWidth: 'calc(100vw - 24px)',
      background: '#0A1547',
      border: '1px solid rgba(255,255,255,0.16)',
      borderRadius: 12,
      color: '#EBFEFF',
      padding: 14,
      boxShadow: '0 18px 44px rgba(0,0,0,0.35)',
      zIndex: 120002
    };
    if (typeof window === 'undefined' || !tourTargetRect) return base;
    const margin = 16;
    const cardWidth = 360;
    const left = Math.min(window.innerWidth - cardWidth - margin, Math.max(margin, tourTargetRect.left));
    const preferredTop = tourTargetRect.top + tourTargetRect.height + 14;
    const top = preferredTop + 220 <= window.innerHeight
      ? preferredTop
      : Math.max(margin, tourTargetRect.top - 220);
    return { ...base, left, top, transform: 'none' };
  })();

  return (
    <div className="dash-page alpha-theme client-dash">
      <div className="dash-center dash-inner">
        <div className="dash-head">
          <h1 style={{ margin: 0 }}>Dashboard</h1>
          <div className="dash-actions">
            <SignOutButton />
          </div>
        </div>

        {error && <div style={{ color: 'crimson', marginBottom: 16 }}>{error}</div>}

        {hasMembership && (
          <div className="client-dash-card" style={{ marginBottom: 8 }}>
            <div className="client-dash-row" style={{ marginBottom: 0, alignItems: 'center', gap: 10 }} data-tour="client-context">
              <label htmlFor="clientSel">Client</label>
              <select
                id="clientSel"
                className="alpha-input alpha-select client-dash-input"
                value={clientId}
                onChange={e => setClientId(e.target.value)}
              >
                {clients.map(c => (
                  <option key={c.client_id} value={c.client_id}>
                    {c.name} ({c.role})
                  </option>
                ))}
              </select>
              <div style={{ color:'#6b7280', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span>Viewing: <strong>{currentName}</strong> · Role: <strong>{effectiveRole}</strong></span>
                <span className={selectedClientAccessStatusClass}>{selectedClientAccessStatusLabel}</span>
              </div>
              <div style={{ marginLeft: 'auto' }}>
                <button
                  type="button"
                  className="btn client-dash-pill client-dash-tour-trigger"
                  data-tour="tour-trigger"
                  onClick={startTour}
                >
                  Take a tour
                </button>
              </div>
            </div>
          </div>
        )}

      {showTesterNda && (
        <div className="tester-nda-overlay">
          <div className="tester-nda-card">
            <h2>Welcome to alphaScreen Interview Agent Pre-Release Trial!</h2>
            <p>
              Thank you for helping us test and refine this new platform — your feedback is incredibly valuable, and we appreciate you being part of this early group.
            </p>
            <p>
              As a reminder, the features, designs, and functionality you’ll see during testing are confidential and still in active development. We kindly ask that you do not share screenshots, recordings, or details outside your organization or beyond those directly participating in the test.
            </p>
            <p>By continuing, you acknowledge that:</p>
            <ul>
              <li>You understand this is a private beta version of the alphaScreen Interview Agent.</li>
              <li>All information, visuals, and interactions in this tool are confidential and should remain within your testing group.</li>
              <li>You agree not to copy, distribute, or disclose any part of the system without written permission.</li>
            </ul>
            <p>
              Thank you again for your partnership — your insights will help us shape alphaScreen into an outstanding experience for all users.
            </p>
            <p>Click ‘I Agree’ and ‘Submit’ to continue.</p>
            <label className="tester-nda-checkbox">
              <input
                type="checkbox"
                checked={testerChecked}
                onChange={(e) => setTesterChecked(e.target.checked)}
              />
              <span>I have read and agree to the terms above.</span>
            </label>
            <div className="tester-nda-actions">
              <button className="btn lilac client-dash-pill" disabled={!testerChecked} onClick={submitTesterAck}>
                I Agree and Submit
              </button>
            </div>
          </div>
        </div>
      )}

        {hasMembership && (
          <div className="dash-tabs" data-tour="client-tabs">
            {!selectedClientIsEffectivelyInactive && (
              <button
                type="button"
                onClick={() => setActiveTab('roles')}
                className={`client-dash-tab ${activeTab === 'roles' ? 'client-dash-tab--active' : ''}`}
              >
                Roles
              </button>
            )}
            {!selectedClientIsEffectivelyInactive && (
              <button
                type="button"
                onClick={() => setActiveTab('candidates')}
                className={`client-dash-tab ${activeTab === 'candidates' ? 'client-dash-tab--active' : ''}`}
              >
                Candidates
              </button>
            )}
            {canManage && (
              <button
                type="button"
                onClick={() => setActiveTab('members')}
                className={`client-dash-tab ${activeTab === 'members' ? 'client-dash-tab--active' : ''}`}
              >
                Members
              </button>
            )}
            <button
              type="button"
              onClick={() => setActiveTab('billing')}
              className={`client-dash-tab ${activeTab === 'billing' ? 'client-dash-tab--active' : ''}`}
            >
              Billing
            </button>
            {isTester && (
              <button
                type="button"
                onClick={() => setActiveTab('feedback')}
                className={`client-dash-tab ${activeTab === 'feedback' ? 'client-dash-tab--active' : ''}`}
              >
                Feedback
              </button>
            )}
          </div>
        )}

        {!hasMembership && !loading && (
          <div
            style={{
              background: '#fef3c7',
              border: '1px solid #f59e0b',
              color: '#1f2937',
              fontWeight: 600,
              padding: 12,
              borderRadius: 8,
              marginTop: 8
            }}
          >
            You are signed in but not a member of any client yet.
          </div>
        )}

        <div className="dash-scroll">
          {activeTab === 'candidates' && !selectedClientIsEffectivelyInactive && (
            <div className="client-dash-card" data-tour="candidates-section">
              {/* Filters: Role + Min Overall */}
              <div className="filters">
                <div style={{ fontWeight: 600, opacity: 0.9, marginRight: 4 }}>Filters:</div>
                <div style={{ display:'flex', alignItems:'center', gap: 6 }}>
                  <label htmlFor="roleFilter">Role</label>
                  <select
                    id="roleFilter"
                    value={roleFilter}
                    onChange={e => setRoleFilter(e.target.value)}
                    style={{ padding: 8 }}
                  >
                    <option value="">All roles</option>
                    {availableRoles.map(r => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </div>

                <div style={{ display:'flex', alignItems:'center', gap: 6 }}>
                  <label htmlFor="minOverall">Min Overall Score</label>
                  <input
                    id="minOverall"
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    placeholder="e.g. 70"
                    value={minOverall}
                    onChange={e => setMinOverall(e.target.value)}
                    style={{ padding: 8, width: 90 }}
                  />
                  {minOverall !== '' && (
                    <button
                      type="button"
                      onClick={() => setMinOverall('')}
                      className="btn lilac client-dash-pill"
                    >
                      Clear
                    </button>
                  )}
                </div>
                <div style={{ display:'flex', alignItems:'center' }}>
                  <button
                    type="button"
                    className="client-dash-tab"
                    onClick={exportCandidatesCsv}
                    disabled={visibleRows.length === 0}
                    title={visibleRows.length === 0 ? 'No candidates to export' : 'Export CSV'}
                    style={visibleRows.length === 0 ? { opacity: 0.6, cursor: 'not-allowed' } : undefined}
                  >
                    Export CSV
                  </button>
                </div>
              </div>

              {loading && <div>Loading…</div>}
              {!loading && displayRows.length === 0 && <div>No rows yet.</div>}

              {!loading && displayRows.length > 0 && (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={{...th, width: 36}}></th>
                        <th style={th}>
                          <HeaderButton
                            label="Name"
                            active={sortBy === 'name'}
                            dir={sortDir}
                            onClick={() => {
                              setSortBy('name');
                              setSortDir(d => (sortBy === 'name' ? (d === 'asc' ? 'desc' : 'asc') : 'asc'));
                            }}
                          />
                        </th>
                        <th style={th}>
                          <HeaderButton
                            label="Email"
                            active={sortBy === 'email'}
                            dir={sortDir}
                            onClick={() => {
                              setSortBy('email');
                              setSortDir(d => (sortBy === 'email' ? (d === 'asc' ? 'desc' : 'asc') : 'asc'));
                            }}
                          />
                        </th>
                        <th style={th}>
                          <HeaderButton
                            label="Role"
                            active={sortBy === 'role'}
                            dir={sortDir}
                            onClick={() => {
                              setSortBy('role');
                              setSortDir(d => (sortBy === 'role' ? (d === 'asc' ? 'desc' : 'asc') : 'asc'));
                            }}
                          />
                        </th>
                        <th style={th}>
                          <HeaderButton
                            label="Resume"
                            active={sortBy === 'resume'}
                            dir={sortDir}
                            onClick={() => {
                              setSortBy('resume');
                              setSortDir(d => (sortBy === 'resume' ? (d === 'asc' ? 'desc' : 'asc') : 'desc'));
                            }}
                          />
                        </th>
                        <th style={th}>
                          <HeaderButton
                            label="Interview"
                            active={sortBy === 'interview'}
                            dir={sortDir}
                            onClick={() => {
                              setSortBy('interview');
                              setSortDir(d => (sortBy === 'interview' ? (d === 'asc' ? 'desc' : 'asc') : 'desc'));
                            }}
                          />
                        </th>
                        <th style={th}>
                          <HeaderButton
                            label="Overall"
                            active={sortBy === 'overall'}
                            dir={sortDir}
                            onClick={() => {
                              setSortBy('overall');
                              setSortDir(d => (sortBy === 'overall' ? (d === 'asc' ? 'desc' : 'asc') : 'desc'));
                            }}
                          />
                        </th>
                        <th style={th}>
                          <HeaderButton
                            label="Created"
                            active={sortBy === 'created'}
                            dir={sortDir}
                            onClick={() => {
                              setSortBy('created');
                              setSortDir(d => (sortBy === 'created' ? (d === 'asc' ? 'desc' : 'asc') : 'desc'));
                            }}
                          />
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleRows.map(r => {
                        const trKey = `${r.latest_interview_id || r.id}:transcript`
                        const pdfKey = `${r.latest_interview_id || r.id}:pdf`
                        const opened = !!expandedRow && expandedRow.id === r.id
                        return (
                          <FragmentRow
                            key={r.id}
                            r={r}
                            opened={opened}
                            toggleRow={toggleRow}
                            pctText={pctText}
                            fmtDate={fmtDate}
                            opening={opening}
                            generatePdfForRow={generatePdfForRow}
                            trKey={trKey}
                            pdfKey={pdfKey}
                            showToast={showToast}
                            onOpenTranscript={openTranscriptModal}
                            onRefresh={handleManualRefresh}
                            refreshing={refreshing}
                          />
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {!loading && displayRows.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
                  {visibleCount < displayRows.length && (
                    <button
                      type="button"
                      className="btn lilac"
                      onClick={() => {
                        const next = Math.min(displayRows.length, visibleCount + INITIAL_COUNT);
                        setVisibleCount(next);
                        postSizeSoon();
                        setTimeout(postSizeSoon, 250);
                      }}
                    >
                      Show more
                    </button>
                  )}
                  {visibleCount > INITIAL_COUNT && (
                    <button
                      type="button"
                      className="btn lilac"
                      onClick={() => {
                        setVisibleCount(INITIAL_COUNT);
                        postSizeSoon();
                        setTimeout(postSizeSoon, 250);
                      }}
                    >
                      Show less
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {activeTab === 'feedback' && (
            <div className="client-dash-card feedback-card">
              <div className="client-dash-section-head">
                <h2>Feedback</h2>
              </div>
              <div className="feedback-form-shell">
                <TesterFeedbackForm
                  mode="embedded"
                  initialEmail={prefillEmail}
                  initialName={prefillName}
                />
              </div>
            </div>
          )}

          {activeTab === 'roles' && !selectedClientIsEffectivelyInactive && (
            <div className="client-dash-card" data-tour="roles-section">
              <div className="client-dash-section-head">
                <h2>Roles for {currentName}</h2>
              </div>
              {canManage && (
                <div
                  className="client-dash-row"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '280px 150px 320px 52px 90px',
                    gap: 10,
                    alignItems: 'center',
                    width: '100%',
                    marginBottom: 12
                  }}
                >
                  <div style={{ width: 280, maxWidth: 280, minWidth: 280, position: 'relative' }}>
                    <input
                      className={`alpha-input client-dash-input ${roleTitleError ? 'input-error' : ''}`}
                      placeholder="Role title"
                      value={newRoleTitle}
                      onChange={e => setNewRoleTitle(e.target.value)}
                      onBlur={() => setRoleTitleTouched(true)}
                      aria-invalid={roleTitleError ? 'true' : 'false'}
                      style={{ width: 280, minWidth: 280, maxWidth: 280 }}
                    />
                    <div
                      style={{
                        position: 'absolute',
                        right: 12,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        fontSize: 11,
                        fontWeight: 600,
                        color: '#ef4444',
                        visibility: roleTitleError ? 'visible' : 'hidden',
                        pointerEvents: 'none'
                      }}
                    >
                      Required
                    </div>
                  </div>
                  <div style={{ display: 'inline-flex', alignItems: 'center', width: 150, minWidth: 150, maxWidth: 150 }}>
                    <select
                      className="alpha-input alpha-select client-dash-input"
                      value={interviewType}
                      onChange={e => setInterviewType(e.target.value)}
                      style={{ flex: '1 1 auto', minWidth: 0, fontSize: interviewType ? undefined : '12px', color: interviewType ? undefined : 'var(--alpha-muted)' }}
                    >
                      <option value="" disabled>Interview Type</option>
                      <option value="BASIC">BASIC</option>
                      <option value="DETAILED">DETAILED</option>
                      <option value="TECHNICAL">TECHNICAL</option>
                    </select>
                    <InfoTip
                      placement="bottom"
                      text={`BASIC: shorter screening interview focused on core fit and relevant experience.
DETAILED: deeper interview with more behavioral and situational depth.
TECHNICAL: skill-heavy interview focused on technical reasoning and execution.`}
                    />
                  </div>
                  <div
                    className="client-dash-file-wrapper"
                    style={{
                      '--alpha-text': jobFile ? undefined : 'var(--alpha-muted)',
                      width: 320,
                      minWidth: 320,
                      maxWidth: 320,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    <CustomFilePicker
                      key={fileKey}
                      accept=".pdf,.doc,.docx,application/pdf"
                      onFileSelected={handleRoleFileFromPicker}
                      label={jobFile?.name ? jobFile.name : 'Drag JD file here or click to browse'}
                      className="client-dash-input client-dash-file-input"
                      inputRef={fileInputRef}
                    />
                  </div>
                  {/* Trash/clear button always present, after file picker, before Create */}
                  <button
                    type="button"
                    className="btn-icon"
                    title={jobFile ? 'Clear file' : 'No file selected'}
                    aria-label="Clear file"
                    disabled={!jobFile}
                    onClick={() => {
                      if (!jobFile) return;
                      if (fileInputRef.current) fileInputRef.current.value = '';
                      setJobFile(null);
                      setFileKey(k => k + 1);
                    }}
                    style={!jobFile ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
                  >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M3 6h18" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round"/>
                      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" stroke="#FFFFFF" strokeWidth="2"/>
                      <path d="M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14" stroke="#FFFFFF" strokeWidth="2" strokeLinejoin="round"/>
                      <path d="M10 11v6M14 11v6" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round"/>
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="btn lilac client-dash-pill"
                    style={{ width: 90, whiteSpace: 'nowrap', textAlign: 'center' }}
                    disabled={!clientId || roleBusy || !newRoleTitle.trim() || !jobFile}
                    onClick={createRole}
                  >
                    {roleBusy ? 'Creating…' : 'Create'}
                  </button>
                </div>
              )}

              {rolesLoading && <div className="client-dash-muted">Loading roles…</div>}
              {!rolesLoading && (
                <div className="client-dash-table">
                  <div className="t-head" style={{ position: 'sticky', top: 0, zIndex: 5, background: '#0A1547', gridTemplateColumns: rolesTableGridTemplate }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <HeaderButton
                        label="Role"
                        active={roleSortBy === 'role'}
                        dir={roleSortDir}
                        onClick={() => {
                          setRoleSortBy('role');
                          setRoleSortDir((d) => (roleSortBy === 'role' ? (d === 'asc' ? 'desc' : 'asc') : 'asc'));
                        }}
                      />
                    </div>
                    <div style={{ justifySelf: 'start', alignSelf: 'center', textAlign: 'left' }}>
                      <HeaderButton
                        label="Type"
                        active={roleSortBy === 'type'}
                        dir={roleSortDir}
                        onClick={() => {
                          setRoleSortBy('type');
                          setRoleSortDir((d) => (roleSortBy === 'type' ? (d === 'asc' ? 'desc' : 'asc') : 'asc'));
                        }}
                      />
                    </div>
                    <div style={{ justifySelf: 'start', alignSelf: 'center', textAlign: 'left' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' }}>
                        Usage
                        <InfoTip text="Shows how many interviews this role has used and how many are left." />
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', justifySelf: 'start', alignSelf: 'center', textAlign: 'left' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                        Rubric
                        <InfoTip text="The interview question set generated for this role." />
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', justifySelf: 'start', alignSelf: 'center', textAlign: 'left' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                        JD
                        <InfoTip text="The job description file used to generate the rubric." />
                      </span>
                    </div>
                    <div style={{ paddingRight: 8 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' }}>
                        Interview Link
                        <InfoTip text="Share this link with candidates to start the interview." />
                      </span>
                    </div>
                    {canManage && (
                      <div className="center" style={{ display: 'flex', justifyContent: 'center' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' }}>
                          Delete
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="t-body">
                    {displayRoles.map(r => {
                      const rubricQuestions = extractRubricQuestions(r.rubric);
                      const hasRubric = rubricQuestions.length > 0;
                      const hasJD = !!r.job_description_url;
                      const remainingRaw = r?.remaining_interviews;
                      const remainingNum = Number.isFinite(Number(remainingRaw)) ? Number(remainingRaw) : null;
                      const lowRemaining = remainingNum != null && remainingNum > 0 && remainingNum <= 3;
                      const exhausted = remainingNum === 0;
                      const usagePrimaryColor = exhausted ? '#fca5a5' : (lowRemaining ? '#fde68a' : 'inherit');
                      const lowRemainingDetail = lowRemaining
                        ? `This role has only ${remainingNum} interview${remainingNum === 1 ? '' : 's'} remaining.`
                        : '';
                      return (
                        <div key={r.id} className="t-row" style={{ gridTemplateColumns: rolesTableGridTemplate }}>
                          <div>
                            <div className="title">{r.title}</div>
                            <div className="sub">{fmtDate(r.created_at)}</div>
                          </div>
                          <div style={{ justifySelf: 'start', alignSelf: 'center', textAlign: 'left' }}>{r.interview_type || '—'}</div>
                          <div style={{ fontVariantNumeric: 'tabular-nums', display: 'grid', gap: 2, justifyItems: 'start', justifySelf: 'start', alignSelf: 'center', textAlign: 'left' }}>
                            <div style={{ whiteSpace: 'nowrap', color: usagePrimaryColor, fontWeight: exhausted || lowRemaining ? 700 : 600 }}>{`${r?.remaining_interviews ?? '—'} left`}</div>
                            <div className="sub" style={{ whiteSpace: 'nowrap', marginTop: 0 }}>{`${r?.used_interviews ?? '—'} used`}</div>
                            {lowRemaining && !exhausted ? (
                              <>
                                <div className="sub" style={{ marginTop: 0, whiteSpace: 'normal', color: '#fcd34d', fontWeight: 600 }}>
                                  Low interview availability
                                </div>
                                <div className="sub" style={{ marginTop: 0, maxWidth: 180, whiteSpace: 'normal', color: '#fef3c7' }}>
                                  {lowRemainingDetail}
                                </div>
                              </>
                            ) : null}
                            {exhausted ? (
                              <div className="sub" style={{ marginTop: 0, maxWidth: 180, whiteSpace: 'normal' }}>
                                Additional interview capacity is required before new interviews can start.
                              </div>
                            ) : null}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', justifySelf: 'start', alignSelf: 'center', textAlign: 'left' }}>
                            {hasRubric ? (
                              <button
                                className="btn-icon"
                                onClick={() => openRubricModal(r)}
                                title="View rubric questions"
                                aria-label="View rubric questions"
                              >
                                <FileIcon />
                              </button>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', justifySelf: 'start', alignSelf: 'center', textAlign: 'left' }}>
                            {hasJD ? (
                              <button
                                className="btn-icon"
                                onClick={() => openRoleJd(r)}
                                title="Open job description"
                                aria-label="Open job description"
                                disabled={!!openingJd[r.id]}
                                style={openingJd[r.id] ? { opacity: 0.6, cursor: 'not-allowed' } : undefined}
                              >
                                <FileIcon />
                              </button>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </div>
                          <div>
                            <button className="btn lilac client-dash-pill" onClick={() => safeCopy(buildInterviewShareUrl(r.slug_or_token))}>Copy link</button>
                          </div>
                          {canManage && (
                            <div className="center" style={{ display: 'flex', justifyContent: 'center' }}>
                              <button className="btn-icon" onClick={() => openDeleteRoleConfirm(r.id, r.title)} title="Delete role">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                  <path d="M3 6h18" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round"/>
                                  <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" stroke="#FFFFFF" strokeWidth="2"/>
                                  <path d="M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14" stroke="#FFFFFF" strokeWidth="2" strokeLinejoin="round"/>
                                  <path d="M10 11v6M14 11v6" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round"/>
                                </svg>
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {displayRoles.length === 0 && <div className="t-empty muted">No roles</div>}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'members' && (
            canManage ? (
              <div className="client-dash-card" data-tour="members-section">
                <div className="client-dash-section-head">
                  <h2>Client Members for {currentName}</h2>
                </div>
                <div className="client-dash-row">
                  <input
                    className="alpha-input client-dash-input"
                    placeholder="Member name"
                    value={memberName}
                    onChange={e => setMemberName(e.target.value)}
                  />
                  <input
                    className="alpha-input client-dash-input"
                    placeholder="Member email"
                    value={memberEmail}
                    onChange={e => setMemberEmail(e.target.value)}
                  />
                  <select
                    className="alpha-input alpha-select client-dash-input"
                    value={memberRole}
                    onChange={e => setMemberRole(e.target.value)}
                  >
                    <option value="member">Member</option>
                    <option value="manager">Manager</option>
                  </select>
                  <button type="button" className="btn lilac client-dash-pill" disabled={!clientId} onClick={addMember}>Add</button>
                </div>

                {membersLoading && <div className="client-dash-muted">Loading members…</div>}
                {!membersLoading && (
                  <div className="client-dash-table members">
                    <div className="t-head" style={{ position: 'sticky', top: 0, zIndex: 5, background: '#0A1547' }}>
                      <div>Name</div>
                      <div>Email</div>
                      <div>Role</div>
                      <div>Remove</div>
                    </div>
                    <div className="t-body">
                      {members.map(m => {
                        const isSelf = (m.user_id && me?.user?.id && m.user_id === me.user.id) || (m.id && me?.user?.id && m.id === me.user.id);
                        return (
                          <div key={m.id} className="t-row">
                            <div className="grow">
                              <div className="title">{m.name}</div>
                              <div className="sub">{m.email}</div>
                            </div>
                            <div className="muted">{m.email}</div>
                            <div>{m.role || 'member'}</div>
                            <div className="center">
                              <button
                                className="btn-icon"
                                onClick={() => !isSelf && removeMember(m.id)}
                                title={isSelf ? 'You cannot remove yourself' : 'Remove member'}
                                disabled={isSelf}
                                style={isSelf ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
                              >
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                  <path d="M3 6h18" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round"/>
                                  <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" stroke="#FFFFFF" strokeWidth="2"/>
                                  <path d="M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14" stroke="#FFFFFF" strokeWidth="2" strokeLinejoin="round"/>
                                  <path d="M10 11v6M14 11v6" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round"/>
                                </svg>
                              </button>
                            </div>
                          </div>
                        );
                      })}
                      {members.length === 0 && <div className="t-empty muted">No members yet</div>}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="client-dash-card" data-tour="members-section">
                You don’t have permission to manage members for this client.
              </div>
            )
          )}

          {activeTab === 'billing' && (
            <div className="client-dash-card" data-tour="billing-section">
              <div className="client-dash-section-head">
                <h2>Billing for {currentName}</h2>
              </div>
              {billingLoading ? (
                <div className="client-dash-muted">Loading billing summary…</div>
              ) : (
                <div className="client-dash-row" style={{ alignItems: 'stretch' }}>
                  <div className="client-dash-card" style={{ marginBottom: 0, flex: 1, minWidth: 260 }}>
                    <div className="client-dash-muted">Plan Tier</div>
                    <div>{selectedClientBillingSummary?.plan_tier || '—'}</div>
                  </div>
                  <div className="client-dash-card" style={{ marginBottom: 0, flex: 1, minWidth: 260 }}>
                    <div className="client-dash-muted">Billing Status</div>
                    <div>{selectedClientBillingSummary?.billing_status || '—'}</div>
                  </div>
                  <div className="client-dash-card" style={{ marginBottom: 0, flex: 1, minWidth: 260 }}>
                    <div className="client-dash-muted">Billing Cycle</div>
                    <div>{selectedClientBillingSummary?.billing_interval || '—'}</div>
                  </div>
                  <div className="client-dash-card" style={{ marginBottom: 0, flex: 1, minWidth: 260 }}>
                    <div className="client-dash-muted">Auto-Renew</div>
                    <div>
                      {selectedClientBillingSummary?.auto_renew === true
                        ? 'Yes'
                        : (selectedClientBillingSummary?.auto_renew === false ? 'No' : '—')}
                    </div>
                  </div>
                  <div className="client-dash-card" style={{ marginBottom: 0, flex: 1, minWidth: 260 }}>
                    <div className="client-dash-muted">Current Term End</div>
                    <div>
                      {selectedClientBillingSummary?.current_term_end
                        ? new Date(selectedClientBillingSummary.current_term_end).toLocaleDateString()
                        : '—'}
                    </div>
                  </div>
                  <div className="client-dash-card" style={{ marginBottom: 0, flex: 1, minWidth: 260 }}>
                    <div className="client-dash-muted">Current Contract End Date</div>
                    <div>
                      {selectedClientBillingSummary?.contract_end_at
                        ? new Date(selectedClientBillingSummary?.contract_end_at).toLocaleDateString()
                        : '—'}
                    </div>
                  </div>
                  <div className="client-dash-card" style={{ marginBottom: 0, flex: 1, minWidth: 260 }}>
                    <div className="client-dash-muted">Membership Status</div>
                    <div>{selectedClientBillingSummary?.subscription_status || '—'}</div>
                  </div>
                  <div className="client-dash-card" style={{ marginBottom: 0, flex: 1, minWidth: 260 }}>
                    <div className="client-dash-muted">Access Status</div>
                    <div><span className={selectedClientAccessStatusClass}>{selectedClientAccessStatusLabel}</span></div>
                  </div>
                  <div
                    className="client-dash-card"
                    aria-hidden="true"
                    style={{ marginBottom: 0, flex: 1, minWidth: 260, visibility: 'hidden' }}
                  />
                  <div
                    className="client-dash-card"
                    aria-hidden="true"
                    style={{ marginBottom: 0, flex: 1, minWidth: 260, visibility: 'hidden' }}
                  />
                </div>
              )}
              <div className="client-dash-row" style={{ marginTop: 12, alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                <div className="client-dash-card" style={{ marginBottom: 0, flex: '1 1 420px', minWidth: 280, maxWidth: 520 }}>
                  <div className="client-dash-muted">Role</div>
                  <select
                    className="alpha-input alpha-select client-dash-input"
                    value={billingRoleSelectValue}
                    onChange={(e) => setBillingRoleId(e.target.value)}
                    disabled={!canManage || !validatedSelectedClientId || rolesLoading}
                    style={{ width: '100%', marginTop: 8 }}
                  >
                    <option value="">
                      {canManage ? (rolesLoading ? 'Loading roles…' : 'Select a role') : 'Unavailable'}
                    </option>
                    {roles.map((role) => (
                      <option key={role.id} value={String(role.id)}>
                        {role.title || 'Untitled role'}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="client-dash-card" style={{ marginBottom: 0, flex: '0 0 138px', minWidth: 138, maxWidth: 152 }}>
                  <div className="client-dash-muted">Quantity</div>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    inputMode="numeric"
                    className="alpha-input client-dash-input"
                    value={billingPurchaseQuantityInput}
                    onChange={(e) => setBillingPurchaseQuantityInput(e.target.value)}
                    style={{ width: '100%', minWidth: 0, boxSizing: 'border-box', marginTop: 8 }}
                  />
                </div>
                <div style={{ marginBottom: 0, display: 'flex', flexDirection: 'column', flex: '0 0 240px', minWidth: 220 }}>
                  <div className="client-dash-muted" aria-hidden="true" style={{ visibility: 'hidden' }}>Action</div>
                  <button
                    type="button"
                    className="btn lilac client-dash-pill"
                    disabled={!canPurchaseAdditionalInterviews}
                    onClick={startAdditionalInterviewsCheckout}
                    style={{ width: '100%', minHeight: 42, marginTop: 8, textAlign: 'center' }}
                  >
                    {billingPurchaseBusy ? 'Redirecting…' : 'Purchase Additional Interviews'}
                  </button>
                </div>
              </div>
              <div className="client-dash-card" style={{ marginTop: 12, marginBottom: 0 }}>
                <div className="client-dash-muted" style={{ marginBottom: 8 }}>Additional Interviews Purchased</div>
                {rolesLoading ? (
                  <div className="client-dash-muted">Loading roles…</div>
                ) : (
                  <div className="client-dash-table">
                    <div className="t-head" style={{ position: 'sticky', top: 0, zIndex: 5, background: '#0A1547', gridTemplateColumns: billingPurchasedGridTemplate }}>
                      <div>Role</div>
                      <div>Purchased</div>
                    </div>
                    <div className="t-body">
                      {roles
                        .filter((role) => normalizeCapacityValue(role?.purchased_interviews) > 0)
                        .map((role) => (
                        <div key={role.id} className="t-row" style={{ gridTemplateColumns: billingPurchasedGridTemplate }}>
                          <div className="title">{role.title || 'Untitled role'}</div>
                          <div>{normalizeCapacityValue(role?.purchased_interviews)}</div>
                        </div>
                      ))}
                      {roles.filter((role) => normalizeCapacityValue(role?.purchased_interviews) > 0).length === 0 && (
                        <div className="t-empty muted">No additional interview purchases yet</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
              <div style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className="btn lilac client-dash-pill"
                  disabled={!validatedSelectedClientId || billingPortalBusy || selectedClientBillingSummary?.has_stripe_customer === false}
                  onClick={manageBilling}
                >
                  {billingPortalBusy ? 'Opening…' : 'Manage Billing'}
                </button>
              </div>
            </div>
          )}
        </div>

        {tourOpen && activeTourStep && (
          <>
            <div
              aria-hidden="true"
              style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(10, 21, 71, 0.42)',
                zIndex: 120000
              }}
            />
            {tourTargetRect && (
              <div
                aria-hidden="true"
                style={{
                  position: 'fixed',
                  top: tourTargetRect.top,
                  left: tourTargetRect.left,
                  width: tourTargetRect.width,
                  height: tourTargetRect.height,
                  borderRadius: 12,
                  border: '2px solid rgba(125, 211, 252, 0.95)',
                  boxShadow: '0 0 0 9999px rgba(10, 21, 71, 0.42)',
                  pointerEvents: 'none',
                  zIndex: 120001
                }}
              />
            )}
            <div role="dialog" aria-modal="true" style={tourCardStyle}>
              <div style={{ fontSize: 12, opacity: 0.84, marginBottom: 8 }}>
                Step {tourStepIndex + 1} of {tourSteps.length}
              </div>
              <h3 style={{ margin: '0 0 8px 0', fontSize: 18, lineHeight: 1.2 }}>
                {activeTourStep.title}
              </h3>
              <p style={{ margin: 0, color: '#dbeafe', fontSize: 14, lineHeight: 1.45 }}>
                {activeTourStep.body}
              </p>
              {!tourTargetRect && (
                <div style={{ marginTop: 8, fontSize: 12, color: '#bfdbfe' }}>
                  This section is currently hidden. Continue to the next step.
                </div>
              )}
              <div style={{ marginTop: 14, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <button
                  type="button"
                  className="btn lilac client-dash-pill"
                  onClick={dismissTour}
                >
                  Skip
                </button>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    className="btn lilac client-dash-pill"
                    onClick={previousTourStep}
                    disabled={tourStepIndex === 0}
                    style={tourStepIndex === 0 ? { opacity: 0.6, cursor: 'not-allowed' } : undefined}
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    className="btn lilac client-dash-pill"
                    onClick={nextTourStep}
                  >
                    {isLastTourStep ? 'Done' : 'Next'}
                  </button>
                </div>
              </div>
            </div>
          </>
        )}

        {isTranscriptOpen && (
          <div className="rubric-modal-overlay" role="dialog" aria-modal="true">
            <div className="rubric-modal-card" style={{ maxWidth: 720 }}>
              <div className="rubric-modal-head">
                <h2>Transcript</h2>
              </div>
              <div className="rubric-modal-body">
                <div
                  style={{
                    border: '1px solid #e5e7eb',
                    borderRadius: 8,
                    padding: 12,
                    background: '#f8fafc',
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                    fontSize: 13,
                    lineHeight: 1.5,
                    whiteSpace: 'pre-wrap',
                    maxHeight: 360,
                    overflowY: 'auto',
                    color: '#111827'
                  }}
                >
                  {activeTranscript || 'Transcript not available.'}
                </div>
              </div>
              <div className="rubric-modal-actions">
                <button type="button" className="btn lilac client-dash-pill" onClick={closeTranscriptModal}>
                  Close
                </button>
                <button type="button" className="btn lilac client-dash-pill" onClick={copyTranscript}>
                  Copy Transcript
                </button>
                <button type="button" className="btn lilac client-dash-pill" onClick={downloadTranscript}>
                  Download Transcript
                </button>
              </div>
            </div>
          </div>
        )}

        {rubricModalOpen && (
          <div className="rubric-modal-overlay" role="dialog" aria-modal="true">
            <div className="rubric-modal-card">
              <div className="rubric-modal-head">
                <h2>Rubric — {rubricRole?.title || 'Role'}</h2>
              </div>
              <div className="rubric-modal-body">
                {rubricQuestions.length === 0 ? (
                  <div className="muted">No rubric questions available.</div>
                ) : (
                  <ol className="rubric-list">
                    {rubricQuestions.map((q, idx) => (
                      <li key={`${idx}-${q.slice(0, 12)}`}>{q}</li>
                    ))}
                  </ol>
                )}
                <label className="alpha-label">Requested changes (optional)</label>
                <textarea
                  className="alpha-input rubric-notes"
                  rows={4}
                  value={rubricNotes}
                  onChange={(e) => setRubricNotes(e.target.value)}
                  placeholder="Add notes for the alphaScreen team"
                />
                {rubricError && <div className="text-red-300 text-sm">{rubricError}</div>}
              </div>
              <div className="rubric-modal-actions">
                <button type="button" className="btn lilac client-dash-pill" onClick={closeRubricModal}>
                  Close
                </button>
                <button
                  type="button"
                  className="btn lilac client-dash-pill"
                  onClick={requestRubricChanges}
                  disabled={rubricSending}
                >
                  {rubricSending ? 'Sending…' : 'Request changes'}
                </button>
              </div>
            </div>
          </div>
        )}

        <ConfirmDialog
          open={confirmRoleDelete.open}
          title={confirmRoleDelete.title ? `Delete role: ${confirmRoleDelete.title}` : 'Delete role'}
          message={
            <span>
              • This role has already been paid for.
              <br />
              • Deleting it will remove the role from the dashboard.
              <br />
              • Payment is not automatically refunded.
            </span>
          }
          confirmLabel="Delete Role"
          cancelLabel="Cancel"
          onConfirm={confirmDeleteRole}
          onCancel={closeDeleteRoleConfirm}
        />
      </div>
    </div>
  )
}

function FragmentRow({
  r, opened, toggleRow, pctText, fmtDate, opening, generatePdfForRow, pdfKey, showToast, onOpenTranscript, onRefresh, refreshing
}) {
  const videoReady = isUsableRecordingUrl(r.video_url);
  const handleVideoClick = () => {
    if (!videoReady) {
      if (typeof showToast === 'function') showToast('Recording is processing', 'success');
      return;
    }
    try {
      window.open(r.video_url, '_blank', 'noopener,noreferrer');
    } catch {
      if (typeof showToast === 'function') showToast('Could not open recording.', 'error');
    }
  };
  const perceptionScores = r.perception_scores && typeof r.perception_scores === 'object' ? r.perception_scores : {};
  const interviewAnalysis = r.interview_analysis && typeof r.interview_analysis === 'object' ? r.interview_analysis : {};
  const transcriptScores = r.transcript_scores && typeof r.transcript_scores === 'object' ? r.transcript_scores : {};
  const evidenceStrengthValue = (() => {
    const raw = transcriptScores?.confidence;
    if (raw === null || raw === undefined || raw === '') return null;
    const num = typeof raw === 'number' ? raw : Number(String(raw).replace(/[^\d.-]/g, ''));
    return Number.isFinite(num) ? num : null;
  })();
  const aiAidedRiskRaw = typeof transcriptScores?.ai_aided_risk === 'string' ? transcriptScores.ai_aided_risk.trim().toLowerCase() : '';
  const aiAidedRiskLabel = aiAidedRiskRaw ? `${aiAidedRiskRaw.charAt(0).toUpperCase()}${aiAidedRiskRaw.slice(1)}` : '—';
  const aiAidedRiskReason = typeof transcriptScores?.ai_aided_risk_reason === 'string' ? transcriptScores.ai_aided_risk_reason.trim() : '';
  const analysisSummary = typeof r.interview_summary === 'string' ? r.interview_summary.trim() : '';
  const analysisSummaryLower = analysisSummary.toLowerCase();
  const insufficientInterview =
    !Number.isFinite(Number(transcriptScores?.overall)) &&
    (
      analysisSummaryLower.includes('before any substantive responses were recorded') ||
      analysisSummaryLower.includes('before substantive responses were captured') ||
      analysisSummaryLower.includes('insufficient data')
    );
  const analysisPending = r.has_analysis === false;
  const analysisStatus = analysisPending ? 'Processing' : 'Summary not available';
  const perceptionUnavailable = perceptionScores?.mode === 'text' || perceptionScores?.unavailable === true;
  const perceptionUnavailableReason =
    typeof perceptionScores?.reason === 'string' && perceptionScores.reason.trim()
      ? perceptionScores.reason.trim()
      : 'Perception analysis is not available for text interviews.';
  const perceptionPending = !insufficientInterview && !perceptionUnavailable && isPerceptionPendingRow(r);
  const transcriptReady =
    typeof r.transcript === 'string' && r.transcript.trim().length > 0;
  const createdAtText = fmtDate(r.created_at);
  const createdAtParts = createdAtText === '—' ? null : createdAtText.split(', ');
  const createdAtDateLine = createdAtParts && createdAtParts.length > 1 ? `${createdAtParts[0]},` : createdAtText;
  const createdAtTimeLine = createdAtParts && createdAtParts.length > 1 ? createdAtParts.slice(1).join(', ') : '';
  const handleTranscriptClick = async () => {
    if (!transcriptReady) {
      if (typeof showToast === 'function') showToast('Transcript is processing', 'success');
      return;
    }
    if (typeof onOpenTranscript === 'function') await onOpenTranscript(r);
  };
  return (
    <>
      <tr className={opened ? 'cd-row opened' : 'cd-row'}>
        <td style={{ ...td, verticalAlign: 'top' }}>
          <button
            onClick={() => toggleRow(r.id)}
            title={opened ? 'Collapse' : 'Expand'}
            aria-label={opened ? 'Collapse' : 'Expand'}
            className="btn lilac expand-toggle"
            style={{
              width: 28,
              height: 28,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0
            }}
          >
            <span
              style={{
                display:'inline-block',
                transform: opened ? 'rotate(90deg)' : 'none',
                transition:'transform 120ms ease'
              }}
            >
              ▶
            </span>
          </button>
        </td>
        <td style={td}><div style={{ fontWeight: 600 }}>{r.candidate.name || '—'}</div></td>
        <td style={td}>{r.candidate.email || '—'}</td>
        <td style={td}>{r.role?.title || '—'}</td>
        <td style={td}>{pctText(r.resume_score)}</td>
        <td style={td}>{pctText(r.interview_score)}</td>
        <td style={td}>{pctText(r.overall_score)}</td>
        <td style={td}>
          {createdAtTimeLine ? (
            <span style={{ display: 'inline-block', whiteSpace: 'nowrap', lineHeight: 1.2 }}>
              <span style={{ display: 'block' }}>{createdAtDateLine}</span>
              <span style={{ display: 'block' }}>{createdAtTimeLine}</span>
            </span>
          ) : (
            createdAtText
          )}
        </td>
      </tr>

      {opened && (
        <tr>
          <td style={td}></td>
          <td style={{...td, paddingTop: 0}} colSpan={7}>
            <div style={{ display:'grid', gap: 12 }}>
              <div className="row-actions" style={{ display:'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                <button
                  onClick={() => {
                    if (typeof onRefresh === 'function') onRefresh();
                  }}
                  className={`btn lilac${refreshing ? ' is-disabled' : ''}`}
                  style={refreshing ? disabledBtn : undefined}
                  aria-disabled={!!refreshing}
                >
                  {refreshing ? 'Refreshing…' : 'Refresh'}
                </button>
                {videoReady && (
                  <button
                    onClick={handleVideoClick}
                    className="btn lilac"
                    title="Open recording"
                  >
                    Video
                  </button>
                )}

                <button
                  onClick={handleTranscriptClick}
                  className={`btn lilac${!transcriptReady ? ' is-disabled' : ''}`}
                  style={!transcriptReady ? disabledBtn : undefined}
                  aria-disabled={!transcriptReady}
                >
                  Transcript
                </button>

                <button
                  onClick={() => generatePdfForRow(r)}
                  disabled={!!opening[pdfKey] || (!r.latest_interview_id && !r.candidate?.id)}
                  className={`btn lilac${(!!opening[pdfKey] || (!r.latest_interview_id && !r.candidate?.id)) ? ' is-disabled' : ''}`}
                  style={(!!opening[pdfKey] || (!r.latest_interview_id && !r.candidate?.id)) ? disabledBtn : undefined}
                  title="Generate and download a fresh PDF"
                >
                  {opening[pdfKey] ? 'Generating…' : 'Download PDF'}
                </button>
              </div>

              <div style={{ display:'grid', gridTemplateColumns:'repeat(12,1fr)', gap: 12, marginTop: 8 }}>
                <div style={{ gridColumn: 'span 6', display: 'grid', gap: 12 }}>
                  <div className="detail-card">
                    <div className="detail-title">Resume Analysis</div>
                    <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap: 8 }}>
                      <div><Meter label="Experience" value={r.resume_analysis.experience} /> <InfoTip text={TIPS.experience} /></div>
                      <div><Meter label="Skills" value={r.resume_analysis.skills} /> <InfoTip text={TIPS.skills} /></div>
                      <div><Meter label="Education" value={r.resume_analysis.education} /> <InfoTip text={TIPS.education} /></div>
                    </div>
                    <div style={{ marginTop: 8, color:'#374151' }}>
                      <strong>Summary:</strong>{' '}
                      {r.resume_analysis.summary
                        ? r.resume_analysis.summary
                        : <span style={{ color: '#6b7280' }}>Summary not available</span>}
                    </div>
                  </div>

                  <div className="detail-card">
                    <div className="detail-title">Unanswered questions</div>
                    {Array.isArray(r.unanswered_candidate_questions) && r.unanswered_candidate_questions.length ? (
                      <ul style={{ marginTop: 6, paddingLeft: 20, color: '#374151' }}>
                        {r.unanswered_candidate_questions.map((q, idx) => (
                          <li key={`${idx}-${q.slice(0, 20)}`}>{q}</li>
                        ))}
                      </ul>
                    ) : (
                      <div style={{ marginTop: 6, color: '#6b7280' }}>No unanswered questions captured.</div>
                    )}
                  </div>
                </div>

                <div style={{ gridColumn: 'span 6', display: 'grid', gap: 12 }}>
                  <div className="detail-card">
                    <div className="detail-title">Interview Analysis</div>
                    <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap: 8 }}>
                      <div><Meter label="Clarity" value={insufficientInterview ? null : (interviewAnalysis?.clarity ?? null)} /> <InfoTip text={TIPS.clarity} /></div>
                      <div><Meter label="Confidence" value={insufficientInterview ? null : (interviewAnalysis?.confidence ?? null)} /> <InfoTip text={TIPS.confidence} /></div>
                      <div><Meter label="Engagement" value={insufficientInterview ? null : (interviewAnalysis?.engagement ?? interviewAnalysis?.body_language ?? null)} /> <InfoTip text={TIPS.engagement} /></div>
                    </div>
                    {perceptionUnavailable && (
                      <div style={{ marginTop: 8 }}>
                        <div style={{ fontWeight: 600, color: '#374151' }}>{perceptionUnavailableReason}</div>
                      </div>
                    )}
                    {!perceptionUnavailable && perceptionPending && (
                      <div style={{ marginTop: 8 }}>
                        <div style={{ fontWeight: 600, color: '#374151' }}>Perception analysis pending…</div>
                        <div style={{ color: '#6b7280', fontSize: 12 }}>This can take a few minutes after interview completion.</div>
                      </div>
                    )}
                    <div style={{ marginTop: 8, color:'#374151' }}>
                      <strong>Summary:</strong>{' '}
                      {analysisSummary
                        ? analysisSummary
                        : <span style={{ color: '#6b7280' }}>{analysisStatus}</span>}
                    </div>
                  </div>

                  <div className="detail-card">
                    <div className="detail-title">Signals</div>
                    <div style={{ display:'grid', gap: 8, marginTop: 6, color: '#374151' }}>
                      <div style={{ display:'flex', alignItems:'center', gap: 6, flexWrap: 'wrap' }}>
                        <strong>Evaluation Reliability:</strong>
                        <InfoTip text={TIPS.evidence_strength} />
                        <span>{insufficientInterview || evidenceStrengthValue === null ? '—' : `${Math.round(evidenceStrengthValue)}%`}</span>
                      </div>
                      <div style={{ display:'flex', alignItems:'center', gap: 6, flexWrap: 'wrap' }}>
                        <strong>AI-aided interview risk:</strong>
                        <InfoTip text={TIPS.ai_aided_risk} />
                        <span>{insufficientInterview ? '—' : aiAidedRiskLabel}</span>
                      </div>
                      {!insufficientInterview && aiAidedRiskReason && (
                        <div style={{ color: '#6b7280', fontSize: 12 }}>{aiAidedRiskReason}</div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function Meter({ label, value }) {
  const pct =
    (typeof value === 'number' && isFinite(value)) || value === 0
      ? Math.max(0, Math.min(100, value))
      : null
  return (
    <div style={{ display:'grid', gap: 4 }}>
      <div style={{ display:'flex', justifyContent:'space-between', fontSize: 12, color:'#374151' }}>
        <span>{label}</span>
        <span style={{ fontWeight: 600, color:'#111827' }}>{pct === null ? '—' : `${pct}%`}</span>
      </div>
      <div style={{ height: 8, background:'#e5e7eb', borderRadius: 8, overflow:'hidden' }}>
        <div style={{ height: '100%', width: pct === null ? 0 : `${pct}%`, background:'#60a5fa' }} />
      </div>
    </div>
  )
}
