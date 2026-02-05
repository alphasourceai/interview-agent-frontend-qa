// src/pages/ClientDashboard.jsx
import { useEffect, useMemo, useState, useRef } from 'react'
import { apiGet, apiDownload, apiPost, apiDelete, api } from '../lib/api'
import SignOutButton from '../components/SignOutButton.jsx'
import CustomFilePicker from '../components/CustomFilePicker'
import TesterFeedbackForm from '../components/TesterFeedbackForm.jsx'
import '../styles/clientDashboard.css';

// --- Dashboard enhancements: sorting, filtering, tooltips (no summaries) ---
const TIPS = {
  experience: 'How well prior roles align with the job requirements.',
  skills: 'Match between hard/soft skills and the role’s needs.',
  education: 'Relevance and level of education for the role.',
  clarity: 'How clearly the candidate communicates ideas/use of filler words.',
  confidence: 'Apparent confidence and composure while answering.',
  engagement: 'Engagement and non-verbal cues such as posture and eye contact.'
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
};
const td = { borderBottom: '1px solid #f1f5f9', padding: '8px 6px', verticalAlign: 'top' };
const disabledBtn = { opacity: 0.6, cursor: 'not-allowed' };
const SHARE_BASE = 'https://interviews.alphasourceai.com/interview-host';
const DAILY_ROOM_RE = /(^https?:\/\/)?([a-z0-9-]+\.)?(tavus\.daily\.co|c\.daily\.co)(\/|\?|$)/i;

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

function InfoTip({ text }) {
  const [open, setOpen] = useState(false);
  const [flip, setFlip] = useState(false);
  const ref = useRef(null);

  const onEnter = () => {
    setOpen(true);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const TOOLTIP_W = 260;
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
            top: -8,
            left: flip ? 'auto' : 12,
            right: flip ? 12 : 'auto',
            transform: 'translateY(-100%)',
            background: '#111827',
            color: '#EBFEFF',
            border: '1px solid rgba(255,255,255,0.14)',
            borderRadius: 8,
            padding: '8px 10px',
            whiteSpace: 'normal',
            fontSize: 12,
            zIndex: 50,
            maxWidth: 260,
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
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [opening, setOpening] = useState({})
  const [expanded, setExpanded] = useState({})
  const [isTranscriptOpen, setIsTranscriptOpen] = useState(false)
  const [activeTranscript, setActiveTranscript] = useState('')
  const [activeTranscriptFilename, setActiveTranscriptFilename] = useState('')

  // --- Row visibility controls (Show more / Show less) ---
  const INITIAL_COUNT = 20;
  const [visibleCount, setVisibleCount] = useState(INITIAL_COUNT);

  // lightweight toast (success / error)
  const [toast, setToast] = useState({ visible: false, type: 'success', msg: '' });
  const toastTimerRef = useRef(null);
  function showToast(msg, type = 'success', ttlMs = 3000) {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    setToast({ visible: true, type, msg });
    toastTimerRef.current = setTimeout(() => {
      setToast(t => ({ ...t, visible: false }));
      toastTimerRef.current = null;
    }, ttlMs);
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
  const [interviewType, setInterviewType] = useState('BASIC');
  const [jobFile, setJobFile] = useState(null);
  const [roleBusy, setRoleBusy] = useState(false);
  const [rolesLoading, setRolesLoading] = useState(false);
  const fileInputRef = useRef(null);
  const [fileKey, setFileKey] = useState(0);
  const rolesEndpointBase = '/api/roles';
  const [openingJd, setOpeningJd] = useState({});
  const [rubricModalOpen, setRubricModalOpen] = useState(false);
  const [rubricRole, setRubricRole] = useState(null);
  const [rubricQuestions, setRubricQuestions] = useState([]);
  const [rubricNotes, setRubricNotes] = useState('');
  const [rubricError, setRubricError] = useState('');
  const [rubricSending, setRubricSending] = useState(false);

  // Members panel state
  const [members, setMembers] = useState([]);
  const [memberName, setMemberName] = useState('');
  const [memberEmail, setMemberEmail] = useState('');
  const [memberRole, setMemberRole] = useState('member');
  const [membersLoading, setMembersLoading] = useState(false);
  const [selfMember, setSelfMember] = useState(null);

  // --- Wix embed: report our height to parent so the iframe can auto-resize ---
  // Clamp heights only if needed, but allow reduction, and always allow shrinkage.
  function postEmbedSize() {
    if (typeof window === 'undefined') return;
    const doc = document;
    // Measure the content height
    const h = Math.max(
      doc.body?.scrollHeight || 0,
      doc.documentElement?.scrollHeight || 0,
      doc.body?.offsetHeight || 0,
      doc.documentElement?.offsetHeight || 0
    );
    // Optionally, clamp if you want a max/min, but allow reductions
    // (Wix sometimes ignores shrinkage if height is same as before, so always post)
    try {
      window.parent?.postMessage({ type: 'EMBED_SIZE', height: h }, '*');
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
  const [activeTab, setActiveTab] = useState('roles'); // roles | candidates | members | feedback

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
  const [sortBy, setSortBy] = useState('created'); // 'name' | 'role' | 'created'
  const [sortDir, setSortDir] = useState('desc');  // 'asc' | 'desc'
  const [roleFilter, setRoleFilter] = useState(''); // role title or ''
  const [minOverall, setMinOverall] = useState(''); // numeric (string input)

  const hasMembership = (me?.memberships || []).length > 0

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
    (me?.memberships || []).find(m => m.client_id === clientId)?.role ||
    'member'
  const [testerChecked, setTesterChecked] = useState(false);
  const currentMembership = useMemo(
    () => (me?.memberships || []).find((m) => m.client_id === clientId) || null,
    [me?.memberships, clientId]
  );
  const canManage = ['manager', 'admin', 'tester'].includes((currentRole || '').toLowerCase());
  const isTester = (currentRole || '').toLowerCase() === 'tester';
  const testerAcknowledged = Boolean(currentMembership?.tester_acknowledged_at);
  const [showTesterNda, setShowTesterNda] = useState(false);
  const prefillName =
    selfMember?.name ||
    me?.user?.user_metadata?.full_name ||
    me?.user?.user_metadata?.name ||
    '';
  const prefillEmail = me?.user?.email || me?.email || '';

  useEffect(() => {
    if (isTester && !testerAcknowledged) {
      setShowTesterNda(true);
    } else {
      setShowTesterNda(false);
    }
  }, [isTester, testerAcknowledged, clientId]);

  useEffect(() => {
    if (activeTab === 'roles') return;
    if (!canManage && activeTab === 'members') {
      setActiveTab('candidates');
    }
  }, [canManage, activeTab]);

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
    if (!clientId || !me?.user?.id) return;
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
        const resp = await apiGet(`/client-members/me?client_id=${encodeURIComponent(clientId)}`);
        if (!alive) return;
        if (resp?.item) setSelfMember(resp.item);
      } catch (e) {
        if (!alive) return;
        console.warn('[feedback] me-membership fetch failed', e?.message || e);
      }
    })();
    return () => { alive = false; };
  }, [isTester, activeTab, clientId, me?.user?.id, me?.user?.email, members]);

  useEffect(() => {
    postSizeSoon();
    setTimeout(postSizeSoon, 250);
  }, [activeTab]);

  const pctText = (v) =>
    (typeof v === 'number' && isFinite(v)) || v === 0
      ? `${Math.max(0, Math.min(100, v))}%`
      : '—'
  const fmtDate = (iso) => {
    try {
      return new Date(iso).toLocaleString()
    } catch {
      return iso || '—'
    }
  }

  function toggleRow(id) {
    setExpanded(prev => {
      const next = { ...prev, [id]: !prev[id] };
      postSizeSoon(); // grow/shrink when row toggles
      // Also trigger a delayed call to catch DOM reflow
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

  const fetchRolesForClient = async (clientIdArg) => {
    const targetId = clientIdArg || clientId;
    const userId = me?.user?.id || me?.id || null;
    if (!targetId || !canManage) {
      console.debug('[roles] fetch skipped', {
        clientId: targetId,
        userId,
        canManage,
        reason: !targetId ? 'no_client' : 'no_permission'
      });
      setRoles([]);
      return;
    }
    const endpoint = `${rolesEndpointBase}?client_id=${encodeURIComponent(targetId)}`;
    console.debug('[roles] fetch start', { clientId: targetId, userId, endpoint });
    setRolesLoading(true);
    try {
      const resp = await apiGet(endpoint);
      const items = Array.isArray(resp?.roles) ? resp.roles : (resp?.items || []);
      console.debug('[roles] fetch success', {
        clientId: targetId,
        count: items.length,
        keys: Object.keys(resp || {})
      });
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
        userId,
        endpoint,
        status,
        detail,
        request_id: requestId || null,
        keys: e?.data ? Object.keys(e.data || {}) : []
      });
      setRoles([]);
      showToast(detail || 'Failed to load roles', 'error');
    } finally {
      setRolesLoading(false);
    }
  };

  // Fetch roles when needed
  useEffect(() => {
    if (activeTab !== 'roles') return;
    fetchRolesForClient(clientId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, canManage, activeTab]);

  // Fetch members when needed
  useEffect(() => {
    if (!clientId || !canManage || activeTab !== 'members') {
      setMembers([]);
      return;
    }
    let alive = true;
    (async () => {
      try {
        setMembersLoading(true);
        const qs = `?client_id=${encodeURIComponent(clientId)}`;
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
  }, [clientId, canManage, activeTab]);

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
      await apiPost(`/api/roles/${encodeURIComponent(rubricRole.id)}/rubric-request-changes`, {
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
      const data = await apiGet(`/api/roles/${encodeURIComponent(roleId)}/jd-signed-url`);
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
    if (clientId) return clientId;
    if (me?.default_client_id) return me.default_client_id;
    const membershipId = (me?.memberships || [])[0]?.client_id || null;
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
      await apiPost('/client-members/tester-ack', { client_id: resolvedClientId });
      setMe((prev) => {
        if (!prev) return prev;
        const updatedMemberships = (prev.memberships || []).map((m) =>
          m.client_id === resolvedClientId ? { ...m, tester_acknowledged_at: new Date().toISOString() } : m
        );
        return { ...prev, memberships: updatedMemberships };
      });
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

  const createRole = async () => {
    if (!clientId) return;
    const title = newRoleTitle.trim();
    if (!title) return;
    if (!jobFile) {
      showToast('Please choose a Job Description file (PDF or DOCX) before creating the role.', 'error');
      return;
    }
    setRoleBusy(true);
    try {
      const payload = { client_id: clientId, title, interview_type: interviewType };
      const resp = await apiPost(rolesEndpointBase, payload);
      const role = resp?.role;
      if (!role) { showToast('Role create failed', 'error'); return; }
      try {
        const out = await uploadJDToBackend(role.id, jobFile);
        if (out?.parsed_text_preview) console.log('[JD preview]', out.parsed_text_preview);
      } catch (e) {
        console.error('uploadJDToBackend error', e);
        showToast('Role created, but JD processing failed: ' + e.message, 'error');
      }
      // refresh
      await fetchRolesForClient(clientId);
      setNewRoleTitle('');
      setJobFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setFileKey((k) => k + 1);
      postSizeSoon();
      setTimeout(postSizeSoon, 300);
      showToast('Role created', 'success');
    } catch (e) {
      const status = e?.status || e?.response?.status;
      const requestId = e?.data?.request_id || e?.response?.data?.request_id;
      const detail =
        e?.data?.detail ||
        e?.response?.data?.detail ||
        e?.data?.message ||
        e?.message ||
        'Failed to create role';
      if (requestId) console.error('[roles] request_id', requestId);
      console.error('[roles] create error', {
        clientId,
        status,
        detail,
        request_id: requestId || null
      });
      showToast(detail || 'Failed to create role', 'error');
    } finally {
      setRoleBusy(false);
    }
  };

  const deleteRole = async (id) => {
    try {
      const url = `${rolesEndpointBase}?id=${encodeURIComponent(id)}&client_id=${encodeURIComponent(clientId)}`;
      await apiDelete(url);
      setRoles((prev) => prev.filter((r) => r.id !== id));
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

  const addMember = async () => {
    if (!clientId) return;
    const e = memberEmail.trim();
    const n = memberName.trim();
    if (!e || !n) return;
    try {
      const resp = await apiPost('/client-members', { client_id: clientId, email: e, name: n, role: memberRole });
      if (resp?.item) {
        setMembers([resp.item, ...members]);
        setMemberEmail('');
        setMemberName('');
        setMemberRole('member');
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
    try {
      await apiDelete(`/client-members/${id}?client_id=${encodeURIComponent(clientId)}`);
      setMembers((prev) => prev.filter((m) => m.id !== id));
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
        const first =
          meResp?.default_client_id ||
          list[0]?.client_id ||
          meResp.memberships?.[0]?.client_id ||
          ''
        setClientId(first)
      } catch (e) {
        setError(String(e?.message || e))
      } finally {
        setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [])

  // Load candidate-centric rows for selected client
  useEffect(() => {
    if (!clientId) {
      setItems([])
      return
    }
    let alive = true
    ;(async () => {
      try {
        setLoading(true)
        const qs = `?client_id=${encodeURIComponent(clientId)}`
        const resp = await apiGet('/dashboard/rows' + qs)
        const raw = resp?.items || []
        const scrubbed = (raw || []).filter(r => r && r.id)
        if (!alive) return
        setItems(scrubbed)
      } catch (e) {
        setError(String(e?.message || e))
      } finally {
        setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [clientId])

  // Normalize for table
  const rows = useMemo(() => {
    return (items || []).map(r => ({
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
        clarity: r.perception_scores?.clarity ?? null,
        confidence: r.perception_scores?.confidence ?? null,
        engagement: r.perception_scores?.engagement ?? r.perception_scores?.body_language ?? null,
        summary: typeof r.interview_summary === 'string' ? r.interview_summary : ''
      },
    }))
  }, [items])

  // Ping parent when table scope changes (or first load completes)
  useEffect(() => {
    postSizeSoon();
    setTimeout(postSizeSoon, 250);
  }, [loading, rows.length, roleFilter, minOverall, sortBy, sortDir]);

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
      } else if (sortBy === 'role') {
        av = (a.role?.title || '').toLowerCase();
        bv = (b.role?.title || '').toLowerCase();
        if (av < bv) return sortDir === 'asc' ? -1 : 1;
        if (av > bv) return sortDir === 'asc' ? 1 : -1;
        return 0;
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
            <div className="client-dash-row" style={{ marginBottom: 0 }}>
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
              <div style={{ color:'#6b7280' }}>
                Viewing: <strong>{currentName}</strong> · Role: <strong>{currentRole}</strong>
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
          <div className="dash-tabs">
            <button
              type="button"
              onClick={() => setActiveTab('roles')}
              className={`client-dash-tab ${activeTab === 'roles' ? 'client-dash-tab--active' : ''}`}
            >
              Roles
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('candidates')}
              className={`client-dash-tab ${activeTab === 'candidates' ? 'client-dash-tab--active' : ''}`}
            >
              Candidates
            </button>
            {canManage && (
              <button
                type="button"
                onClick={() => setActiveTab('members')}
                className={`client-dash-tab ${activeTab === 'members' ? 'client-dash-tab--active' : ''}`}
              >
                Members
              </button>
            )}
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
              background: '#fff3cd',
              border: '1px solid #ffeeba',
              padding: 12,
              borderRadius: 8,
              marginTop: 8
            }}
          >
            You are signed in but not a member of any client yet.
          </div>
        )}

        <div className="dash-scroll">
          {activeTab === 'candidates' && (
            <div className="client-dash-card">
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
                        <th style={th}>Email</th>
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
                        <th style={th}>Resume</th>
                        <th style={th}>Interview</th>
                        <th style={th}>Overall</th>
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
                        const opened = !!expanded[r.id]
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

          {activeTab === 'roles' && (
            <div className="client-dash-card">
              <div className="client-dash-section-head">
                <h2>Roles for {currentName}</h2>
              </div>
              {canManage && (
                <div className="client-dash-row">
                  <input
                    className="alpha-input client-dash-input"
                    placeholder="Role title"
                    value={newRoleTitle}
                    onChange={e => setNewRoleTitle(e.target.value)}
                  />
                  <select
                    className="alpha-input alpha-select client-dash-input"
                    value={interviewType}
                    onChange={e => setInterviewType(e.target.value)}
                  >
                    <option value="BASIC">BASIC</option>
                    <option value="DETAILED">DETAILED</option>
                    <option value="TECHNICAL">TECHNICAL</option>
                  </select>
                  <div className="client-dash-file-wrapper">
                    <CustomFilePicker
                      key={fileKey}
                      accept=".pdf,.doc,.docx,application/pdf"
                      onFileSelected={handleRoleFileFromPicker}
                      label="Drag JD file here or click to browse"
                      className="client-dash-input client-dash-file-input"
                      inputRef={fileInputRef}
                    />
                  </div>
                  {jobFile && (
                    <button
                      type="button"
                      className="btn lilac"
                      onClick={() => {
                        if (fileInputRef.current) fileInputRef.current.value = '';
                        setJobFile(null);
                        setFileKey(k => k + 1);
                      }}
                    >
                      Clear file
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn lilac client-dash-pill"
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
                  <div className="t-head">
                    <div>Role</div>
                    <div>Created</div>
                    <div>Type</div>
                    <div className="col-center">Rubric</div>
                    <div className="col-center">JD</div>
                    <div>Link</div>
                    {canManage && <div>Delete</div>}
                  </div>
                  <div className="t-body">
                    {roles.map(r => {
                      const rubricQuestions = extractRubricQuestions(r.rubric);
                      const hasRubric = rubricQuestions.length > 0;
                      const hasJD = !!r.job_description_url;
                      return (
                        <div key={r.id} className="t-row">
                          <div>
                            <div className="title">{r.title}</div>
                            <div className="sub">Token: {r.slug_or_token}</div>
                          </div>
                          <div>{r.created_at ? new Date(r.created_at).toLocaleString() : '—'}</div>
                          <div>{r.interview_type || '—'}</div>
                          <div className="col-center">
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
                          <div className="col-center">
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
                            <button className="btn lilac client-dash-pill" onClick={() => safeCopy(`${SHARE_BASE}/${r.slug_or_token}`)}>Copy link</button>
                          </div>
                          {canManage && (
                            <div className="center">
                              <button className="btn-icon" onClick={() => deleteRole(r.id)} title="Delete role">
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
                    {roles.length === 0 && <div className="t-empty muted">No roles yet</div>}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'members' && (
            canManage ? (
              <div className="client-dash-card">
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
                    <div className="t-head">
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
              <div className="client-dash-card">
                You don’t have permission to manage members for this client.
              </div>
            )
          )}
        </div>

        {/* Toast */}
        {toast.visible && (
          <div
            role="status"
            aria-live="polite"
            style={{
              position: 'fixed',
              right: 16,
              bottom: 16,
              background: toast.type === 'error' ? 'rgba(220, 38, 38, 0.95)' : 'rgba(16, 185, 129, 0.95)',
              color: '#fff',
              borderRadius: 8,
              padding: '10px 12px',
              boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
              maxWidth: 360,
              zIndex: 1000,
              fontSize: 14,
              lineHeight: 1.3
            }}
          >
            {toast.msg}
          </div>
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
      </div>
    </div>
  )
}

function FragmentRow({
  r, opened, toggleRow, pctText, fmtDate, opening, generatePdfForRow, pdfKey, showToast, onOpenTranscript
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
  const analysisSummary = typeof r.interview_summary === 'string' ? r.interview_summary.trim() : '';
  const analysisPending = !analysisSummary;
  const analysisStatus = analysisPending ? 'Processing' : null;
  const transcriptReady =
    typeof r.transcript === 'string' && r.transcript.trim().length > 0;
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
        <td style={td}>{fmtDate(r.created_at)}</td>
      </tr>

      {opened && (
        <tr>
          <td style={td}></td>
          <td style={{...td, paddingTop: 0}} colSpan={7}>
            <div style={{ display:'grid', gap: 12 }}>
              <div className="row-actions" style={{ display:'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
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
                <div className="detail-card" style={{ gridColumn: 'span 6' }}>
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

                <div className="detail-card" style={{ gridColumn: 'span 6' }}>
                  <div className="detail-title">Interview Analysis</div>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap: 8 }}>
                    <div><Meter label="Clarity" value={perceptionScores?.clarity ?? null} /> <InfoTip text={TIPS.clarity} /></div>
                    <div><Meter label="Confidence" value={perceptionScores?.confidence ?? null} /> <InfoTip text={TIPS.confidence} /></div>
                    <div><Meter label="Engagement" value={perceptionScores?.engagement ?? perceptionScores?.body_language ?? null} /> <InfoTip text={TIPS.engagement} /></div>
                  </div>
                  <div style={{ marginTop: 8, color:'#374151' }}>
                    <strong>Summary:</strong>{' '}
                    {analysisSummary
                      ? analysisSummary
                      : <span style={{ color: '#6b7280' }}>{analysisStatus}</span>}
                  </div>
                </div>

                <div className="detail-card" style={{ gridColumn: 'span 12' }}>
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
