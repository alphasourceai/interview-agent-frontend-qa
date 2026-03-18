// src/pages/Admin.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { apiGet, apiPost, apiPatch, apiDelete, api, apiDownload } from '../lib/api';
import { supabase } from '../lib/supabaseClient';
import toast from 'react-hot-toast';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import CustomFilePicker from '../components/CustomFilePicker.jsx';

import '../styles/adminTheme.css';
import '../styles/clientDashboard.css';
import '../styles/clientTheme.css';

const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
const ALL_CLIENTS_VALUE = 'ALL';
const EMBEDDED = typeof window !== 'undefined' && window !== window.parent;

const IconTrash = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M3 6h18" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round"/>
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" stroke="#FFFFFF" strokeWidth="2"/>
    <path d="M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14" stroke="#FFFFFF" strokeWidth="2" strokeLinejoin="round"/>
    <path d="M10 11v6M14 11v6" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round"/>
  </svg>
);

const IconKey = ({ size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M14.5 10a3.5 3.5 0 1 0-3.15 2.17l1.65 1.65v2.18h2v-2h2v-2h-2l-1.6-1.6A3.5 3.5 0 0 0 14.5 10Z" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M12 10h.01" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const FileIcon = ({ size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" stroke="#FFFFFF" strokeWidth="2" strokeLinejoin="round"/>
    <path d="M14 2v6h6" stroke="#FFFFFF" strokeWidth="2" strokeLinejoin="round"/>
  </svg>
);

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

function getClientBillingDisplay(c) {
  const billingStatus = String(c?.billing_status || '').toLowerCase();
  const subscriptionStatus = String(c?.subscription_status || '').toLowerCase();
  const activeForDisplay = subscriptionStatus === 'active' || subscriptionStatus === 'trialing';
  if (billingStatus === 'inactive' && c?.cancel_at_term_end === true && activeForDisplay) return 'inactive — Stripe canceling';
  if (billingStatus === 'inactive') return 'inactive';
  if (activeForDisplay && c?.cancel_at_term_end === true) return 'active — canceling';
  if (activeForDisplay) return 'active';
  if (c?.stripe_subscription_id || c?.subscription_status) return 'inactive';
  return 'inactive';
}

function isClientActivelySubscribed(c) {
  if (c?.manual_active_override === true) return true;
  const subscriptionStatus = String(c?.subscription_status || '').toLowerCase();
  return subscriptionStatus === 'active' || subscriptionStatus === 'trialing';
}

function isLiveStripeSubscription(c) {
  const subscriptionStatus = String(c?.subscription_status || '').toLowerCase();
  return subscriptionStatus === 'active' || subscriptionStatus === 'trialing';
}

function canCancelContractNow(c) {
  if (String(c?.billing_status || '').toLowerCase() === 'inactive') return false;
  return !!c?.stripe_subscription_id && isLiveStripeSubscription(c);
}

function formatShortDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString();
}

function formatCurrency(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `$${n.toFixed(2)}`;
}

function getAccessOverrideModeLabel(value) {
  const mode = String(value || 'inherit').toLowerCase();
  if (mode === 'force_active') return 'Force Active';
  if (mode === 'force_inactive') return 'Force Inactive';
  return 'Inherit';
}

export default function Admin() {
  const [session, setSession] = useState(null);
  const [me, setMe] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [showReset, setShowReset] = useState(false);
  const [newPass1, setNewPass1] = useState('');
  const [newPass2, setNewPass2] = useState('');

  const [clients, setClients] = useState([]);
  const [selectedClientId, setSelectedClientId] = useState('');
  const [newClientName, setNewClientName] = useState('');
  const [newClientAdminName, setNewClientAdminName] = useState('');
  const [newClientAdminEmail, setNewClientAdminEmail] = useState('');
  const [newClientAdminRole, setNewClientAdminRole] = useState('manager');
  const [clientCheckoutCycles, setClientCheckoutCycles] = useState({});
  const [clientCheckoutBusy, setClientCheckoutBusy] = useState({});
  const [clientAutoRenewBusy, setClientAutoRenewBusy] = useState({});
  const [clientAccessOverrideBusy, setClientAccessOverrideBusy] = useState({});
  const [clientInvoicePlanTiers, setClientInvoicePlanTiers] = useState({});
  const [clientInvoiceIntervals, setClientInvoiceIntervals] = useState({});
  const [clientInvoicePlatformFees, setClientInvoicePlatformFees] = useState({});
  const [clientInvoicePerRoleFees, setClientInvoicePerRoleFees] = useState({});
  const [clientInvoiceIncludedInterviewsPerRole, setClientInvoiceIncludedInterviewsPerRole] = useState({});
  const [clientInvoiceAdditionalInterviewFees, setClientInvoiceAdditionalInterviewFees] = useState({});
  const [clientSubscriptionInvoiceBusy, setClientSubscriptionInvoiceBusy] = useState({});
  const [processRenewalsBusy, setProcessRenewalsBusy] = useState(false);

  const [roles, setRoles] = useState([]);
  const [newRoleTitle, setNewRoleTitle] = useState('');
  const [interviewType, setInterviewType] = useState('BASIC');
  const [jobFile, setJobFile] = useState(null);
  const [roleBusy, setRoleBusy] = useState(false);
  const fileInputRef = useRef(null);
  const [fileKey, setFileKey] = useState(0);
  const [openingJd, setOpeningJd] = useState({});
  const [rubricModalOpen, setRubricModalOpen] = useState(false);
  const [rubricRole, setRubricRole] = useState(null);
  const [rubricQuestions, setRubricQuestions] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [candidatesMessage, setCandidatesMessage] = useState('');
  const [candidateRoleFilter, setCandidateRoleFilter] = useState('');
  const [expandedCandidateId, setExpandedCandidateId] = useState(null);
  const [expandedClientId, setExpandedClientId] = useState(null);
  const [candidateReportGenerating, setCandidateReportGenerating] = useState({});
  const [expandedRoleConfigId, setExpandedRoleConfigId] = useState(null);
  const [roleConfigs, setRoleConfigs] = useState({});
  const [roleConfigLoading, setRoleConfigLoading] = useState({});
  const [roleConfigSaving, setRoleConfigSaving] = useState({});

  const [members, setMembers] = useState([]);
  const [memberEmail, setMemberEmail] = useState('');
  const [memberName, setMemberName] = useState('');
  const [memberRole, setMemberRole] = useState('member');
  const [confirmClient, setConfirmClient] = useState({ open: false, id: null });
  const [confirmRole, setConfirmRole] = useState({ open: false, id: null });
  const [confirmMember, setConfirmMember] = useState({ open: false, id: null });
  const [emailError, setEmailError] = useState('');

  const [activeTab, setActiveTab] = useState('clients');

  const [billingCustomers, setBillingCustomers] = useState([]);
  const [billingInvoices, setBillingInvoices] = useState([]);
  const [billingCompanyName, setBillingCompanyName] = useState('');
  const [billingContactName, setBillingContactName] = useState('');
  const [billingContactEmail, setBillingContactEmail] = useState('');
  const [billingNotes, setBillingNotes] = useState('');
  const [billingSelectedCustomerId, setBillingSelectedCustomerId] = useState('');
  const [billingSelectedCustomerLabel, setBillingSelectedCustomerLabel] = useState('');
  const [billingCustomerQuery, setBillingCustomerQuery] = useState('');
  const [billingInvoiceTitle, setBillingInvoiceTitle] = useState('');
  const [billingInvoiceDesc, setBillingInvoiceDesc] = useState('');
  const [billingDueDays, setBillingDueDays] = useState('7');
  const [billingLineItems, setBillingLineItems] = useState([{ id: 1, description: '', quantity: 1, unitAmount: '' }]);
  const [billingHostedUrl, setBillingHostedUrl] = useState('');
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingSending, setBillingSending] = useState(false);
  const [billingCustomerMenuOpen, setBillingCustomerMenuOpen] = useState(false);
  const customerDropdownRef = useRef(null);

  const [accommodations, setAccommodations] = useState([]);
  const [accommodationsLoading, setAccommodationsLoading] = useState(false);
  const [accommodationFilter, setAccommodationFilter] = useState('pending');
  const [accommodationNotes, setAccommodationNotes] = useState({});
  const [accommodationSaving, setAccommodationSaving] = useState({});
  const [accommodationSending, setAccommodationSending] = useState({});
  const [auditRuns, setAuditRuns] = useState([]);
  const [auditRunsLoading, setAuditRunsLoading] = useState(false);
  const [contractCancellationRuns, setContractCancellationRuns] = useState([]);
  const [contractCancellationRunsLoading, setContractCancellationRunsLoading] = useState(false);
  const [billingReconciliationItems, setBillingReconciliationItems] = useState([]);
  const [billingReconciliationLoading, setBillingReconciliationLoading] = useState(false);
  const [cancelContractModalOpen, setCancelContractModalOpen] = useState(false);
  const [cancelContractClientId, setCancelContractClientId] = useState('');
  const [cancelContractClientName, setCancelContractClientName] = useState('');
  const [cancelContractFinalInvoiceAmount, setCancelContractFinalInvoiceAmount] = useState('');
  const [cancelContractNote, setCancelContractNote] = useState('');
  const [cancelContractSubmitBusy, setCancelContractSubmitBusy] = useState(false);

  const shareBase = 'https://interviews.alphasourceai.com/interview-host';
  const isAllClients = selectedClientId === ALL_CLIENTS_VALUE;
  const clientNameById = useMemo(() => Object.fromEntries(clients.map((c) => [c.id, c.name])), [clients]);
  const currentClientName = useMemo(() => {
    if (isAllClients) return 'All clients';
    return clients.find((c) => c.id === selectedClientId)?.name || '';
  }, [clients, selectedClientId, isAllClients]);

  const openRubricModal = (role) => {
    const questions = extractRubricQuestions(role?.rubric);
    setRubricRole(role || null);
    setRubricQuestions(questions);
    setRubricModalOpen(true);
  };

  const closeRubricModal = () => {
    setRubricModalOpen(false);
    setRubricRole(null);
    setRubricQuestions([]);
  };

  const openRoleJd = async (role) => {
    const roleId = role?.id;
    if (!roleId) return;
    setOpeningJd((prev) => ({ ...prev, [roleId]: true }));
    try {
      const data = await apiGet(`/api/roles/${encodeURIComponent(roleId)}/jd-signed-url`);
      if (!data?.url) throw new Error('No URL returned');
      window.open(data.url, '_blank', 'noopener,noreferrer');
      toast.success('Job description opened', { duration: 1400 });
    } catch (e) {
      console.error('[admin/roles] jd_open_failed', {
        role_id: roleId,
        error: e?.message || e,
        detail: e?.data?.detail || e?.data?.error || null,
      });
      toast.error('Could not open Job Description', { duration: 1600 });
    } finally {
      setOpeningJd((prev) => ({ ...prev, [roleId]: false }));
    }
  };

  const postEmbedSize = () => {
    if (typeof window === 'undefined') return;
    try {
      const send = () => {
        const h = Math.max(
          document.body?.scrollHeight || 0,
          document.documentElement?.scrollHeight || 0,
          document.body?.offsetHeight || 0,
          document.documentElement?.offsetHeight || 0
        );
        window.parent?.postMessage({ type: 'EMBED_SIZE', height: h }, '*');
      };
      send();
      setTimeout(send, 250);
    } catch (_) {}
  };

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess || null);
      if (sess && window.location.pathname !== '/admin') {
        setTimeout(() => {
          window.location.replace('/admin');
        }, 250);
      }
    });
    return () => {
      try {
        sub.subscription?.unsubscribe?.();
      } catch (e) {
        console.warn('Auth subscription cleanup error:', e);
      }
    };
  }, []);

  useEffect(() => {
    const t = setTimeout(postEmbedSize, 60);
    const t2 = setTimeout(postEmbedSize, 320);
    return () => { clearTimeout(t); clearTimeout(t2); };
  }, [loading, isAdmin, clients.length, roles.length, members.length, selectedClientId, billingCustomers.length, billingInvoices.length, accommodations.length]);

  useEffect(() => {
    const IDLE_LIMIT_MS = 60 * 60 * 1000;
    let timer;
    const triggerLogout = async () => {
      try {
        await supabase.auth.signOut();
      } finally {
        localStorage.removeItem('adm_show_clients');
        localStorage.removeItem('adm_show_roles');
        localStorage.removeItem('adm_show_members');
        window.location.replace('/admin');
      }
    };
    const resetTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(triggerLogout, IDLE_LIMIT_MS);
    };
    const activityEvents = ['mousemove','mousedown','keydown','scroll','touchstart','visibilitychange','click'];
    activityEvents.forEach((ev) => window.addEventListener(ev, resetTimer));
    resetTimer();
    return () => {
      clearTimeout(timer);
      activityEvents.forEach((ev) => window.removeEventListener(ev, resetTimer));
    };
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    const needsReset =
      url.searchParams.get('pwreset') === '1' ||
      window.location.hash.includes('type=recovery') ||
      window.location.hash.includes('recovery');
    if (needsReset) setShowReset(true);
  }, []);

  useEffect(() => {
    let alive = true;
    let initializing = true;
    (async () => {
      if (!initializing) return;
      const { data } = await supabase.auth.getSession();
      if (!alive || !initializing) return;
      await new Promise(res => setTimeout(res, 200));
      if (!alive || !initializing) return;
      setSession(data?.session || null);
      if (data?.session) {
        try {
          if (!alive || !initializing) return;
          const u = await apiGet('/auth/me');
          if (!alive || !initializing) return;
          setMe(u || null);
          const probe = await apiGet('/admin/clients');
          if (!alive || !initializing) return;
          const list = (probe?.items || []).sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
          setIsAdmin(true);
          setClients(list);
          if (list.length && !selectedClientId) setSelectedClientId(list[0].id);
        } catch {
          if (!alive || !initializing) return;
          setIsAdmin(false);
        }
      }
      if (alive && initializing) setLoading(false);
      initializing = false;
    })();
    return () => { alive = false; initializing = false; };
  }, []);

  async function refreshClients() {
    const probe = await apiGet('/admin/clients');
    const list = (probe?.items || []).sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
    setClients(list);
    postEmbedSize();
    setTimeout(postEmbedSize, 300);
  }

  async function refreshRoles(clientId = selectedClientId) {
    const isAll = clientId === ALL_CLIENTS_VALUE;
    if (!isAll && !clientId) { setRoles([]); postEmbedSize(); setTimeout(postEmbedSize, 300); return; }
    const effectiveClientId = isAll ? '' : clientId;
    const r = await apiGet('/admin/roles' + (effectiveClientId ? ('?client_id=' + encodeURIComponent(effectiveClientId)) : ''));
    const items = r?.items || [];
    items.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    setRoles(items);
    postEmbedSize();
    setTimeout(postEmbedSize, 300);
  }

  async function refreshMembers(clientId = selectedClientId) {
    if (clientId === ALL_CLIENTS_VALUE) {
      if (!clients.length) { setMembers([]); postEmbedSize(); setTimeout(postEmbedSize, 300); return; }
      const bundles = await Promise.all(
        clients.map(async (c) => {
          try {
            const resp = await apiGet('/admin/client-members?client_id=' + encodeURIComponent(c.id));
            return (resp?.items || []).map(item => ({ ...item, client_id: item.client_id || c.id }));
          } catch {
            return [];
          }
        })
      );
      const merged = bundles.flat();
      merged.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
      setMembers(merged);
      postEmbedSize();
      setTimeout(postEmbedSize, 300);
      return;
    }
    const effectiveClientId = clientId === ALL_CLIENTS_VALUE ? '' : clientId;
    if (!effectiveClientId) { setMembers([]); postEmbedSize(); setTimeout(postEmbedSize, 300); return; }
    const m = await apiGet('/admin/client-members?client_id=' + encodeURIComponent(effectiveClientId));
    const items = (m?.items || []).map(item => ({ ...item, client_id: item.client_id || effectiveClientId }));
    setMembers(items);
    postEmbedSize();
    setTimeout(postEmbedSize, 300);
  }

  async function refreshCandidates(clientId = selectedClientId, roleId = candidateRoleFilter) {
    const isAll = clientId === ALL_CLIENTS_VALUE;
    if (isAll || !clientId) {
      setCandidates([]);
      setCandidatesMessage('Select a client to view candidates.');
      return;
    }
    setCandidatesLoading(true);
    try {
      const qs = new URLSearchParams({ client_id: clientId });
      if (roleId) qs.set('role_id', roleId);
      const resp = await apiGet('/admin/candidates?' + qs.toString());
      setCandidates(resp?.candidates || []);
      setCandidatesMessage(resp?.message || '');
    } catch (e) {
      setCandidates([]);
      setCandidatesMessage('');
      toast.error(e?.message || 'Could not load candidates', { duration: 1600 });
    } finally {
      setCandidatesLoading(false);
      postEmbedSize();
      setTimeout(postEmbedSize, 300);
    }
  }

  async function deleteCandidate(id) {
    if (!selectedClientId || selectedClientId === ALL_CLIENTS_VALUE) {
      toast.error('Select a client to perform this action.', { duration: 1500 });
      return;
    }
    if (!window.confirm('Delete this candidate? This cannot be undone.')) return;
    try {
      await apiDelete(`/admin/candidates/${encodeURIComponent(id)}?client_id=${encodeURIComponent(selectedClientId)}`);
      toast.success('Candidate deleted', { duration: 1000 });
      await refreshCandidates(selectedClientId, candidateRoleFilter);
    } catch (e) {
      toast.error(e?.message || 'Could not delete candidate.', { duration: 2000 });
    }
  }

  async function generateCandidateReport(candidate) {
    if (!selectedClientId || selectedClientId === ALL_CLIENTS_VALUE) {
      toast.error('Select a client to perform this action.', { duration: 1500 });
      return;
    }
    const candidateId = candidate?.id;
    if (!candidateId) {
      toast.error('Missing candidate id', { duration: 1500 });
      return;
    }

    const interviewId =
      candidate?.latest_interview_id ||
      candidate?.latestInterviewId ||
      candidate?.latest_interview?.id ||
      candidate?.interview_id ||
      null;

    setCandidateReportGenerating((prev) => ({ ...prev, [candidateId]: true }));
    try {
      const payload = {
        client_id: selectedClientId,
        candidate_id: candidateId,
        role_id: candidate?.role_id || null,
        interview_id: interviewId
      };

      const resp = await apiPost('/admin/reports/generate', payload);
      const url =
        resp?.signed_url ||
        resp?.url ||
        resp?.report_url ||
        resp?.latest_report_url ||
        resp?.item?.signed_url ||
        resp?.item?.url ||
        resp?.item?.report_url ||
        resp?.item?.latest_report_url ||
        null;

      if (url) {
        window.open(url, '_blank', 'noopener,noreferrer');
        toast.success('Report generated', { duration: 1200 });
      } else if (interviewId) {
        await apiDownload(
          `/reports/${encodeURIComponent(interviewId)}/download`,
          `Candidate_Report_${interviewId}.pdf`
        );
        toast.success('Report generated', { duration: 1200 });
      } else {
        toast.error('Missing interview id for PDF generation', { duration: 1800 });
      }

      await refreshCandidates(selectedClientId, candidateRoleFilter);
    } catch (e) {
      toast.error(e?.message || 'Could not generate report', { duration: 1800 });
    } finally {
      setCandidateReportGenerating((prev) => ({ ...prev, [candidateId]: false }));
      postEmbedSize();
      setTimeout(postEmbedSize, 300);
    }
  }

  async function loadRoleConfig(roleId) {
    if (!selectedClientId || selectedClientId === ALL_CLIENTS_VALUE) return;
    setRoleConfigLoading((prev) => ({ ...prev, [roleId]: true }));
    try {
      const resp = await apiGet(`/admin/roles/${encodeURIComponent(roleId)}/interview-config?client_id=${encodeURIComponent(selectedClientId)}`);
      const item = resp?.item || {};
      const prompt = typeof item.tavus_prompt === 'string' ? item.tavus_prompt : '';

      const directQuestions = Array.isArray(item.rubric_questions)
        ? item.rubric_questions
            .map((q) => (typeof q === 'string' ? q.trim() : ''))
            .filter(Boolean)
        : [];

      let questions = directQuestions;

      if (!questions.length) {
        questions = extractRubricQuestions(item.rubric);
      }

      if (!questions.length && typeof item.manual_questions === 'string' && item.manual_questions.trim()) {
        questions = item.manual_questions
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean);
      }

      setRoleConfigs((prev) => ({ ...prev, [roleId]: { prompt, questions } }));
    } catch (e) {
      toast.error(e?.message || 'Could not load role config', { duration: 1800 });
    } finally {
      setRoleConfigLoading((prev) => ({ ...prev, [roleId]: false }));
      postEmbedSize();
      setTimeout(postEmbedSize, 300);
    }
  }

  async function saveRoleConfig(roleId) {
    if (!selectedClientId || selectedClientId === ALL_CLIENTS_VALUE) {
      toast.error('Select a client to perform this action.', { duration: 1500 });
      return;
    }
    const current = roleConfigs[roleId] || { prompt: '', questions: [] };
    const cleanedPrompt = String(current.prompt || '').trim();
    const rubricQuestions = Array.isArray(current.questions)
      ? current.questions.map((q) => String(q || '').trim()).filter(Boolean)
      : [];
    setRoleConfigSaving((prev) => ({ ...prev, [roleId]: true }));
    try {
      const resp = await apiPatch(`/admin/roles/${encodeURIComponent(roleId)}/interview-config?client_id=${encodeURIComponent(selectedClientId)}`, {
        tavus_prompt: cleanedPrompt ? cleanedPrompt : null,
        rubric_questions: rubricQuestions
      });
      const item = resp?.item || {};
      const prompt = typeof item.tavus_prompt === 'string' ? item.tavus_prompt : (cleanedPrompt || '');
      const questions = Array.isArray(item.rubric_questions)
        ? item.rubric_questions
            .map((q) => (typeof q === 'string' ? q.trim() : ''))
            .filter(Boolean)
        : rubricQuestions;
      setRoleConfigs((prev) => ({ ...prev, [roleId]: { prompt, questions } }));
      toast.success('Role config saved', { duration: 1200 });
    } catch (e) {
      toast.error(e?.message || 'Could not save role config', { duration: 1800 });
    } finally {
      setRoleConfigSaving((prev) => ({ ...prev, [roleId]: false }));
    }
  }

  const openRoleConfig = async (roleId) => {
    setExpandedRoleConfigId((prev) => (prev === roleId ? null : roleId));
    if (!roleConfigs[roleId]) {
      await loadRoleConfig(roleId);
    }
  };

  async function refreshBilling() {
    if (!isAdmin) return;
    setBillingLoading(true);
    try {
      const [cust, inv] = await Promise.all([
        apiGet('/admin/billing/customers'),
        apiGet('/admin/billing/invoices')
      ]);
      setBillingCustomers(cust?.items || []);
      setBillingInvoices(inv?.items || []);
    } catch (e) {
      console.warn('[billing] fetch failed', e?.message || e);
      toast.error('Could not load billing data', { duration: 1500 });
    } finally {
      setBillingLoading(false);
      postEmbedSize();
      setTimeout(postEmbedSize, 300);
    }
  }

  async function refreshAccommodations() {
    if (!isAdmin) return;
    setAccommodationsLoading(true);
    try {
      const params = new URLSearchParams();
      if (accommodationFilter) params.set('status', accommodationFilter);
      if (selectedClientId && selectedClientId !== ALL_CLIENTS_VALUE) {
        params.set('client_id', selectedClientId);
      }
      const qs = params.toString();
      const resp = await apiGet('/admin/accommodation-requests' + (qs ? `?${qs}` : ''));
      const items = resp?.items || [];
      setAccommodations(items);
      const notes = {};
      items.forEach((item) => {
        notes[item.id] = item.admin_notes || '';
      });
      setAccommodationNotes(notes);
    } catch (e) {
      console.warn('[accommodations] fetch failed', e?.message || e);
      toast.error('Could not load accommodation requests', { duration: 1500 });
    } finally {
      setAccommodationsLoading(false);
      postEmbedSize();
      setTimeout(postEmbedSize, 300);
    }
  }

  async function refreshAuditRuns() {
    if (!isAdmin) return;
    setAuditRunsLoading(true);
    try {
      const resp = await apiGet('/admin/audit/contract-processing-runs');
      setAuditRuns(resp?.items || []);
    } catch (e) {
      console.warn('[audit-logs] fetch failed', e?.message || e);
      toast.error('Could not load audit logs', { duration: 1500 });
    } finally {
      setAuditRunsLoading(false);
      postEmbedSize();
      setTimeout(postEmbedSize, 300);
    }
  }

  async function refreshBillingReconciliation() {
    if (!isAdmin) return;
    setBillingReconciliationLoading(true);
    try {
      const resp = await apiGet('/admin/audit/billing-reconciliation');
      setBillingReconciliationItems(resp?.items || []);
    } catch (e) {
      console.warn('[audit-logs/reconciliation] fetch failed', e?.message || e);
      toast.error('Could not load billing reconciliation', { duration: 1500 });
    } finally {
      setBillingReconciliationLoading(false);
      postEmbedSize();
      setTimeout(postEmbedSize, 300);
    }
  }

  async function refreshContractCancellationRuns() {
    if (!isAdmin) return;
    setContractCancellationRunsLoading(true);
    try {
      const resp = await apiGet('/admin/audit/contract-cancellation-runs');
      setContractCancellationRuns(resp?.items || []);
    } catch (e) {
      console.warn('[audit-logs/contract-cancellations] fetch failed', e?.message || e);
      toast.error('Could not load contract cancellation runs', { duration: 1500 });
    } finally {
      setContractCancellationRunsLoading(false);
      postEmbedSize();
      setTimeout(postEmbedSize, 300);
    }
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!isAdmin) return;
      if (!alive) return;
      await refreshRoles(selectedClientId);
      if (!alive) return;
      await refreshMembers(selectedClientId);
    })();
    return () => { alive = false; };
  }, [isAdmin, selectedClientId, clients]);

  useEffect(() => {
    if (!isAdmin) return;
    if (activeTab !== 'candidates') return;
    refreshCandidates(selectedClientId, candidateRoleFilter);
  }, [isAdmin, activeTab, selectedClientId, candidateRoleFilter]);

  useEffect(() => {
    setCandidateRoleFilter('');
    setExpandedCandidateId(null);
    setExpandedRoleConfigId(null);
  }, [selectedClientId]);

  useEffect(() => {
    if (!isAdmin) return;
    if (activeTab !== 'billing') return;
    refreshBilling();
  }, [isAdmin, activeTab]);

  useEffect(() => {
    if (!isAdmin) return;
    if (activeTab !== 'accommodations') return;
    refreshAccommodations();
  }, [isAdmin, activeTab, selectedClientId, accommodationFilter]);

  useEffect(() => {
    if (!isAdmin) return;
    if (activeTab !== 'audit-logs') return;
    refreshAuditRuns();
    refreshBillingReconciliation();
    refreshContractCancellationRuns();
  }, [isAdmin, activeTab]);

  useEffect(() => {
    if (!isAdmin) return;
    const params = new URLSearchParams(window.location.search);
    const checkout = params.get('checkout');
    const client_id = params.get('client_id');
    if (checkout !== 'success' && checkout !== 'cancel') return;
    void client_id;
    refreshClients();
    if (checkout === 'success') {
      toast.success('Subscription checkout completed.', { duration: 1800 });
    } else {
      toast('Subscription checkout canceled.', { duration: 1800 });
    }
    window.history.replaceState({}, '', window.location.pathname);
  }, [isAdmin]);

  useEffect(() => {
    const onClickOutside = (e) => {
      if (customerDropdownRef.current && !customerDropdownRef.current.contains(e.target)) {
        setBillingCustomerQuery(billingSelectedCustomerLabel || '');
        setBillingCustomerMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [billingSelectedCustomerLabel]);

  async function requestSafariStorageAccess() {
    try {
      if (document.hasStorageAccess && document.requestStorageAccess) {
        const has = await document.hasStorageAccess();
        if (!has) {
          await document.requestStorageAccess();
        }
      }
    } catch (e) {}
  }

  const updateAccommodation = async (id, payload) => {
    setAccommodationSaving((prev) => ({ ...prev, [id]: true }));
    try {
      const resp = await apiPatch(`/admin/accommodation-requests/${id}`, payload);
      const item = resp?.item;
      if (item) {
        setAccommodations((prev) => prev.map((r) => (r.id === id ? { ...r, ...item } : r)));
      }
      if (payload?.status === 'approved') {
        toast.success('Request approved', { duration: 1200 });
      } else if (payload?.status === 'denied') {
        toast.success('Request denied', { duration: 1200 });
      } else {
        toast.success('Request updated', { duration: 1200 });
      }
    } catch (e) {
      toast.error('Update failed', { duration: 1500 });
    } finally {
      setAccommodationSaving((prev) => ({ ...prev, [id]: false }));
    }
  };

  const sendTextInterviewLink = async (id) => {
    setAccommodationSending((prev) => ({ ...prev, [id]: true }));
    try {
      await apiPost(`/admin/accommodation-requests/${id}/send-text-link`, {});
      toast.success('Text interview link sent', { duration: 1400 });
      await refreshAccommodations();
    } catch (e) {
      toast.error('Failed to send link', { duration: 1500 });
    } finally {
      setAccommodationSending((prev) => ({ ...prev, [id]: false }));
    }
  };

  const handleSignIn = async (e) => {
    e.preventDefault();
    if (!isValidEmail(email)) {
      setEmailError('Please enter a valid email address.');
      toast.error('Please enter a valid email address.', { duration: 1500 });
      return;
    }
    setEmailError('');
    try {
      await requestSafariStorageAccess();
    } catch {}
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      toast.error('Sign in failed: ' + error.message, { duration: 2000 });
      return;
    }
    setSession(data?.session || null);
    window.location.replace('/admin');
  };

  const startReset = async () => {
    if (!email) {
      toast.error('Enter your email above first.', { duration: 1500 });
      return;
    }
    if (!isValidEmail(email)) {
      setEmailError('Please enter a valid email address.');
      toast.error('Please enter a valid email address.', { duration: 1500 });
      return;
    }
    setEmailError('');
    const origin = window.location.origin;
    try { localStorage.setItem('pwreset_origin', 'admin'); } catch {}
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${origin}/pwreset?origin=admin`
    });
    if (error) {
      toast.error('Could not start reset: ' + error.message, { duration: 2000 });
      return;
    }
    toast.success('Check your email for a password reset link.', { duration: 1500 });
  };

  const submitReset = async (e) => {
    e.preventDefault();
    if (!newPass1 || newPass1 !== newPass2) {
      toast.error('Passwords do not match.', { duration: 1500 });
      return;
    }
    const { error } = await supabase.auth.updateUser({ password: newPass1 });
    if (error) {
      toast.error('Could not update password: ' + error.message, { duration: 2000 });
      return;
    }
    toast.success('Password updated. You can sign in now.', { duration: 1500 });
    setShowReset(false);
    setNewPass1(''); setNewPass2('');
    const url = new URL(window.location.href);
    url.searchParams.delete('pwreset');
    window.history.replaceState({}, '', url.toString());
    await supabase.auth.signOut();
    localStorage.removeItem('adm_show_clients');
    localStorage.removeItem('adm_show_roles');
    localStorage.removeItem('adm_show_members');
    window.location.replace('/admin');
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    localStorage.removeItem('adm_show_clients');
    localStorage.removeItem('adm_show_roles');
    localStorage.removeItem('adm_show_members');
    window.location.replace('/admin');
  };

  const getNiceErrorMessage = (err, status) => {
    const s = status ?? err?.status ?? err?.response?.status;
    const code = err?.data?.error || err?.data?.code || err?.response?.data?.error || err?.response?.data?.code;
    if (s === 409 || code === 'email_in_use') return 'Email address already exists';
    const detail =
      err?.data?.detail ||
      err?.data?.message ||
      err?.data?.error ||
      err?.response?.data?.detail ||
      err?.response?.data?.message ||
      err?.response?.data?.error;
    return detail || 'Something went wrong';
  };

  const startSubscriptionCheckout = async (clientId) => {
    if (!clientId) return;
    const billing_cycle = clientCheckoutCycles[clientId] === 'annual' ? 'annual' : 'monthly';
    setClientCheckoutBusy((prev) => ({ ...prev, [clientId]: true }));
    try {
      const resp = await apiPost(`/admin/clients/${encodeURIComponent(clientId)}/billing/checkout-session`, {
        billing_cycle,
        return_target: 'admin'
      });
      const url = resp?.url || null;
      if (!url) throw new Error('Missing checkout URL');
      try {
        if (window.top && window.top !== window) {
          window.top.location.href = url;
        } else {
          window.location.href = url;
        }
      } catch {
        window.location.href = url;
      }
      toast.success('Checkout opened', { duration: 1200 });
    } catch (e) {
      const code = e?.data?.code || '';
      if (code === 'ENTERPRISE_CHECKOUT_NOT_CONFIGURED') {
        toast.error('Enterprise checkout is not configured.', { duration: 1800 });
      } else {
        toast.error(e?.data?.detail || e?.message || 'Could not start checkout.', { duration: 2000 });
      }
    } finally {
      setClientCheckoutBusy((prev) => ({ ...prev, [clientId]: false }));
    }
  };

  const updateClientAutoRenew = async (clientId, nextValue) => {
    if (!clientId) return;
    setClientAutoRenewBusy((prev) => ({ ...prev, [clientId]: true }));
    try {
      const resp = await apiPatch(`/admin/clients/${encodeURIComponent(clientId)}/auto-renew`, { auto_renew: nextValue });
      const updatedValue = typeof resp?.item?.auto_renew === 'boolean' ? resp.item.auto_renew : nextValue;
      const updatedCancelAtTermEnd = typeof resp?.item?.cancel_at_term_end === 'boolean'
        ? resp.item.cancel_at_term_end
        : (updatedValue ? false : true);
      setClients((prev) => prev.map((item) => (
        item.id === clientId ? { ...item, auto_renew: updatedValue, cancel_at_term_end: updatedCancelAtTermEnd } : item
      )));
    } catch (e) {
      toast.error(e?.data?.detail || e?.message || 'Could not update auto-renew.', { duration: 1800 });
    } finally {
      setClientAutoRenewBusy((prev) => ({ ...prev, [clientId]: false }));
    }
  };

  const updateClientAccessOverride = async (clientId, nextMode) => {
    if (!clientId) return;
    const normalizedMode = String(nextMode || '').toLowerCase();
    if (!['inherit', 'force_active', 'force_inactive'].includes(normalizedMode)) return;
    setClientAccessOverrideBusy((prev) => ({ ...prev, [clientId]: true }));
    try {
      const resp = await apiPatch(`/admin/clients/${encodeURIComponent(clientId)}/access-override`, { access_override_mode: normalizedMode });
      const updatedMode = String(resp?.item?.access_override_mode || normalizedMode).toLowerCase();
      setClients((prev) => prev.map((item) => (
        item.id === clientId ? { ...item, access_override_mode: updatedMode } : item
      )));
      toast.success('Access override updated.', { duration: 1400 });
    } catch (e) {
      toast.error(e?.data?.detail || e?.message || 'Could not update access override.', { duration: 2000 });
    } finally {
      setClientAccessOverrideBusy((prev) => ({ ...prev, [clientId]: false }));
    }
  };

  const sendClientSubscriptionInvoice = async (clientId, fallbackPlanTier, fallbackBillingInterval) => {
    if (!clientId) return;
    const plan_tier = String(clientInvoicePlanTiers[clientId] || fallbackPlanTier || 'basic').toLowerCase();
    const billing_interval = String(clientInvoiceIntervals[clientId] || fallbackBillingInterval || 'monthly').toLowerCase() === 'annual' ? 'annual' : 'monthly';
    const payload = { plan_tier, billing_interval };
    if (plan_tier === 'enterprise') {
      payload.platform_fee = String(clientInvoicePlatformFees[clientId] ?? '').trim();
      payload.per_role_fee = String(clientInvoicePerRoleFees[clientId] ?? '').trim();
      payload.included_interviews_per_role = String(clientInvoiceIncludedInterviewsPerRole[clientId] ?? '').trim();
      payload.additional_interview_fee = String(clientInvoiceAdditionalInterviewFees[clientId] ?? '').trim();
    }

    setClientSubscriptionInvoiceBusy((prev) => ({ ...prev, [clientId]: true }));
    try {
      const resp = await apiPost(`/admin/clients/${encodeURIComponent(clientId)}/subscription-checkout`, payload);
      const clientEmail = String(resp?.client_email || '').trim();
      if (resp?.email_sent === true) {
        toast.success(clientEmail ? `Checkout link emailed to ${clientEmail}.` : 'Checkout link emailed.', { duration: 1800 });
      } else {
        const fallbackDetail = String(resp?.email_error || '').trim();
        toast(fallbackDetail ? `Checkout link created. Email not confirmed (${fallbackDetail}).` : 'Checkout link created. Email not confirmed.', { duration: 2200 });
      }
    } catch (e) {
      toast.error(e?.data?.detail || e?.message || 'Could not create checkout link.', { duration: 2000 });
    } finally {
      setClientSubscriptionInvoiceBusy((prev) => ({ ...prev, [clientId]: false }));
    }
  };

  const openCancelContractModal = (client) => {
    setCancelContractClientId(client?.id || '');
    setCancelContractClientName(client?.name || '');
    setCancelContractFinalInvoiceAmount('');
    setCancelContractNote('');
    setCancelContractSubmitBusy(false);
    setCancelContractModalOpen(true);
  };

  const closeCancelContractModal = () => {
    if (cancelContractSubmitBusy) return;
    setCancelContractModalOpen(false);
    setCancelContractClientId('');
    setCancelContractClientName('');
    setCancelContractFinalInvoiceAmount('');
    setCancelContractNote('');
  };

  const confirmCancelContract = async () => {
    if (!cancelContractClientId) return;
    setCancelContractSubmitBusy(true);
    try {
      const payload = {};
      const amountRaw = String(cancelContractFinalInvoiceAmount || '').trim();
      if (amountRaw) payload.final_invoice_amount = amountRaw;
      const noteRaw = String(cancelContractNote || '').trim();
      if (noteRaw) payload.note = noteRaw;
      const resp = await apiPost(`/admin/clients/${encodeURIComponent(cancelContractClientId)}/cancel-contract`, payload);
      const item = resp?.item || null;
      if (item?.id) {
        setClients((prev) => prev.map((row) => (row.id === item.id ? { ...row, ...item, subscription_status: 'canceled' } : row)));
      } else {
        await refreshClients();
      }
      setCancelContractSubmitBusy(false);
      setCancelContractModalOpen(false);
      setCancelContractClientId('');
      setCancelContractClientName('');
      setCancelContractFinalInvoiceAmount('');
      setCancelContractNote('');
      toast.success('Contract canceled.', { duration: 1800 });
    } catch (e) {
      toast.error(e?.data?.detail || e?.message || 'Could not cancel contract.', { duration: 2200 });
      setCancelContractSubmitBusy(false);
    }
  };

  const processRenewals = async () => {
    setProcessRenewalsBusy(true);
    try {
      const resp = await apiPost('/admin/contracts/process-renewals', {});
      const summary = resp?.summary || {};
      const skipped = (summary.skipped_no_action || 0) + (summary.skipped_manual_override || 0);
      await refreshClients();
      toast.success(
        `Processed: due ${summary.due || 0}, renewed ${summary.renewed || 0}, deactivated ${summary.deactivated || 0}, skipped ${skipped}, errors ${summary.errors || 0}`,
        { duration: 2200 }
      );
      if (Array.isArray(resp?.items)) {
        console.info('[admin/contracts/process-renewals] items', resp.items);
      }
    } catch (e) {
      toast.error(e?.data?.detail || e?.message || 'Could not process renewals.', { duration: 2000 });
    } finally {
      setProcessRenewalsBusy(false);
    }
  };

  const createClient = async () => {
    const name = newClientName.trim();
    const admin_name = newClientAdminName.trim();
    const admin_email = newClientAdminEmail.trim();
    const admin_role = newClientAdminRole;
    if (!name) return;
    try {
      const resp = await apiPost('/admin/clients', { name, admin_name, admin_email, admin_role });
      const item = resp?.item;
      if (item) {
        // TODO: also create billing customer for this client and seed stripe_customer_id
        await refreshClients();
        setNewClientName('');
        setNewClientAdminName('');
        setNewClientAdminEmail('');
        setNewClientAdminRole('manager');
        setSelectedClientId(item.id);
        if (resp?.seeded_member) setMembers([resp.seeded_member, ...members]);
        postEmbedSize();
        setTimeout(postEmbedSize, 300);
      }
    } catch (err) {
      const msg = getNiceErrorMessage(err, err?.status);
      toast.error(msg, { duration: 2000 });
    }
  };

  const deleteClient = async (id) => {
    try {
      await apiDelete('/admin/clients/' + id);
      await refreshClients();
      if (selectedClientId === id) setSelectedClientId(clients[0]?.id || '');
      setRoles([]);
      setMembers([]);
      toast.success('Client deleted', { duration: 1000 });
      postEmbedSize();
      setTimeout(postEmbedSize, 300);
    } catch (e) {
      toast.error(e?.message || 'Could not delete client.', { duration: 2000 });
    } finally {
      setConfirmClient({ open: false, id: null });
    }
  };

  async function safeCopy(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        toast.success('Link copied', { duration: 1000 });
        return;
      }
      throw new Error('clipboard_api_unavailable');
    } catch (err) {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.top = '-9999px';
        textarea.style.left = '-9999px';
        textarea.setAttribute('readonly', '');
        document.body.appendChild(textarea);
        textarea.select();
        textarea.setSelectionRange(0, textarea.value.length);
        const successful = document.execCommand('copy');
        document.body.removeChild(textarea);
        if (successful) {
          toast.success('Link copied', { duration: 1000 });
          return;
        }
        throw new Error('execCommand_copy_failed');
      } catch (fallbackErr) {
        toast.error('Could not copy link', { duration: 2500 });
      }
    }
  }

  const uploadJDToBackend = async (roleId, file) => {
    const form = new FormData();
    form.append('file', file);
    const qs = new URLSearchParams({ client_id: selectedClientId, role_id: roleId }).toString();
    return api.upload(`/roles-upload/upload-jd?${qs}`, form);
  };

  const handleRoleFileFromPicker = (file) => {
    setJobFile(file || null);
  };

  const createRole = async () => {
    if (!requireClientContext()) return;
    const title = newRoleTitle.trim();
    if (!title) return;
    if (!jobFile) {
      toast.error('Please choose a Job Description file (PDF or DOCX) before creating the role.', { duration: 2000 });
      return;
    }
    setRoleBusy(true);
    try {
      const payload = { client_id: selectedClientId, title, interview_type: interviewType };
      const resp = await apiPost('/admin/roles', payload);
      const role = resp?.item;
      if (!role) { toast.error('Role create failed', { duration: 2000 }); return; }
      try {
        await uploadJDToBackend(role.id, jobFile);
      } catch (e) {
        toast.error('Role created, but JD processing failed: ' + e.message, { duration: 2000 });
      }
      await refreshRoles(selectedClientId);
      setNewRoleTitle('');
      setJobFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setFileKey((k) => k + 1);
      postEmbedSize();
      setTimeout(postEmbedSize, 300);
      toast.success('Role created', { duration: 1000 });
    } finally {
      setRoleBusy(false);
    }
  };

  const deleteRole = async (id) => {
    if (!requireClientContext()) {
      setConfirmRole({ open: false, id: null });
      return;
    }
    try {
      const url = `/admin/roles?id=${encodeURIComponent(id)}&client_id=${encodeURIComponent(selectedClientId)}`;
      let ok = false;
      try {
        await apiDelete(url);
        ok = true;
      } catch (e) {
        if (e?.response?.status === 404) {
          await apiPost('/admin/roles/delete', { id, client_id: selectedClientId });
          ok = true;
        } else {
          throw e;
        }
      }

      if (ok) {
        setRoles(prev => prev.filter(r => r.id !== id));
        postEmbedSize();
        setTimeout(postEmbedSize, 300);
        toast.success('Role deleted', { duration: 1000 });
      }
    } catch (err) {
      const msg =
        (err?.response?.data?.error) ||
        (err?.message) ||
        'Could not delete role. Please refresh and try again.';
      toast.error(msg, { duration: 2000 });
    } finally {
      setConfirmRole({ open: false, id: null });
    }
  };

  const addMember = async () => {
    if (!requireClientContext()) return;
    const e = memberEmail.trim();
    const n = memberName.trim();
    if (!e || !n) return;
    try {
      const resp = await apiPost('/admin/client-members', { client_id: selectedClientId, email: e, name: n, role: memberRole });
      if (resp?.item) {
        setMembers([resp.item, ...members]);
        setMemberEmail('');
        setMemberName('');
        setMemberRole('member');
        postEmbedSize();
        setTimeout(postEmbedSize, 300);
        toast.success('Invite sent and member added', { duration: 1000 });
      }
    } catch (err) {
      const msg = getNiceErrorMessage(err, err?.status);
      toast.error(msg, { duration: 2000 });
    }
  };

  const removeMember = async (id) => {
    if (!requireClientContext()) {
      setConfirmMember({ open: false, id: null });
      return;
    }
    try {
      await apiDelete('/admin/client-members/' + id);
      setMembers(members.filter(m => m.id !== id));
      postEmbedSize();
      setTimeout(postEmbedSize, 300);
      toast.success('Member removed', { duration: 1000 });
    } catch (e) {
      toast.error(e?.message || 'Could not remove member.', { duration: 2000 });
    } finally {
      setConfirmMember({ open: false, id: null });
    }
  };

  const sendPasswordReset = async (email) => {
    if (!email) return;
    try {
      const resp = await apiPost('/admin/send-password-reset', { email });
      if (resp?.ok) {
        toast.success('Password reset email sent', { duration: 1500 });
      } else {
        toast.error('Failed to send password reset email', { duration: 2000 });
      }
    } catch (err) {
      toast.error('Failed to send password reset email', { duration: 2000 });
    }
  };

  const requireClientContext = () => {
    if (!selectedClientId || isAllClients) {
      toast.error('Select a client to perform this action.', { duration: 1500 });
      return false;
    }
    return true;
  };

  const createBillingCustomer = async () => {
    const name = billingCompanyName.trim();
    const primary_contact_name = billingContactName.trim();
    const primary_contact_email = billingContactEmail.trim();
    if (!name || !primary_contact_name || !primary_contact_email) {
      toast.error('Company, contact name, and contact email are required.', { duration: 1800 });
      return;
    }
    try {
      const payload = {
        name,
        primary_contact_name,
        primary_contact_email,
        notes: billingNotes || '',
        client_id: !isAllClients && selectedClientId ? selectedClientId : null
      };
      const resp = await apiPost('/admin/billing/customers', payload);
      if (resp?.item) {
        setBillingCustomers((prev) => [resp.item, ...prev]);
        setBillingCompanyName('');
        setBillingContactName('');
        setBillingContactEmail('');
        setBillingNotes('');
        postEmbedSize();
        setTimeout(postEmbedSize, 300);
        toast.success('Billing customer created', { duration: 1400 });
      }
    } catch (e) {
      const msg = e?.response?.data?.detail || e?.message || 'Could not create billing customer';
      toast.error(msg, { duration: 1800 });
    }
  };

  const addLineItem = () => {
    setBillingLineItems((prev) => [...prev, { id: Date.now(), description: '', quantity: 1, unitAmount: '' }]);
  };

  const updateLineItem = (id, field, value) => {
    setBillingLineItems((prev) => prev.map((item) => item.id === id ? { ...item, [field]: value } : item));
  };

  const removeLineItem = (id) => {
    setBillingLineItems((prev) => (prev.length === 1 ? prev : prev.filter((item) => item.id !== id)));
  };

  const hasValidLineItems = useMemo(() => {
    const valid = billingLineItems.filter((li) => {
      const desc = (li.description || '').trim();
      const unit = parseFloat(li.unitAmount);
      const qty = parseInt(li.quantity, 10);
      return desc && !Number.isNaN(unit) && unit > 0 && qty > 0;
    });
    return valid.length > 0;
  }, [billingLineItems]);

  const filteredCustomers = useMemo(() => {
    const q = billingCustomerQuery.trim().toLowerCase();
    if (!q) return billingCustomers;
    return billingCustomers.filter((c) => `${c.name} ${c.primary_contact_email}`.toLowerCase().includes(q));
  }, [billingCustomerQuery, billingCustomers]);

  const selectCustomer = (id, label) => {
    setBillingSelectedCustomerId(id);
    setBillingSelectedCustomerLabel(label);
    setBillingCustomerQuery(label);
    setBillingCustomerMenuOpen(false);
  };

  const sendInvoice = async () => {
    if (!billingSelectedCustomerId) return;
    const validItems = billingLineItems
      .map((li) => ({
        description: (li.description || '').trim(),
        quantity: parseInt(li.quantity, 10) || 1,
        unitAmount: parseFloat(li.unitAmount)
      }))
      .filter((li) => li.description && !Number.isNaN(li.unitAmount) && li.unitAmount > 0 && li.quantity > 0);
    if (!validItems.length) {
      toast.error('Add at least one valid line item.', { duration: 1500 });
      return;
    }
    if (!billingInvoiceTitle.trim()) {
      toast.error('Invoice title is required.', { duration: 1400 });
      return;
    }
    setBillingSending(true);
    try {
      const payload = {
        billing_customer_id: billingSelectedCustomerId,
        title: billingInvoiceTitle.trim(),
        invoice_title: billingInvoiceTitle.trim(),
        invoice_description: billingInvoiceDesc.trim() || null,
        days_until_due: billingDueDays ? parseInt(billingDueDays, 10) || 7 : 7,
        line_items: validItems.map((li) => ({
          description: li.description,
          quantity: li.quantity,
          unit_amount: li.unitAmount
        }))
      };
      const resp = await apiPost('/admin/billing/invoices/send', payload);
      if (resp?.ok) {
        toast.success('Invoice sent', { duration: 1500 });
        setBillingHostedUrl(resp?.invoice?.hosted_invoice_url || '');
        setBillingInvoiceTitle('');
        setBillingInvoiceDesc('');
        setBillingDueDays('7');
        setBillingLineItems([{ id: Date.now(), description: '', quantity: 1, unitAmount: '' }]);
        refreshBilling();
        postEmbedSize();
        setTimeout(postEmbedSize, 300);
      }
    } catch (e) {
      const msg = e?.response?.data?.detail || e?.message || 'Could not send invoice';
      toast.error(msg, { duration: 1800 });
    } finally {
      setBillingSending(false);
    }
  };

  const canSendInvoice = billingSelectedCustomerId && hasValidLineItems && billingInvoiceTitle.trim();

  if (loading) {
    return (
      <div className="alpha-theme client-auth admin-page" style={EMBEDDED ? { overflow: 'hidden' } : { minHeight: '100vh' }}>
        <div className="alpha-card auth-wrap client-card" style={{ width: '100%', maxWidth: 520 }}>
          <h2>Loading…</h2>
        </div>
      </div>
    );
  }

  if (showReset) {
    return (
      <div className="alpha-theme client-auth admin-page" style={EMBEDDED ? { overflow: 'hidden' } : { minHeight: '100vh' }}>
        <div className="alpha-card auth-wrap client-card" style={{ width: '100%', maxWidth: 520 }}>
          <h2>Reset Password</h2>
          <form onSubmit={submitReset}>
            <label>New password</label>
            <input className="alpha-input" type="password" value={newPass1} onChange={e => setNewPass1(e.target.value)} required />
            <label>Confirm new password</label>
            <input className="alpha-input" type="password" value={newPass2} onChange={e => setNewPass2(e.target.value)} required />
            <button type="submit">Update Password</button>
            <div style={{ marginTop: 8 }}>
              <button type="button" onClick={() => { setShowReset(false); window.location.replace('/admin'); }}>
                Back to sign in
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  if (!loading && !session) {
    return (
      <div className="alpha-theme client-auth admin-page" style={EMBEDDED ? { overflow: 'hidden' } : { minHeight: '100vh' }}>
        <div className="alpha-card auth-wrap client-card admin-auth" style={{ width: '100%', maxWidth: 520 }}>
          <div className="auth-head">
            <h2>Admin Sign In</h2>
          </div>
          <form onSubmit={handleSignIn}>
            <label htmlFor="admin-email">Email</label>
            <input
              id="admin-email"
              className={`alpha-input ${emailError ? 'input-error' : ''}`}
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onBlur={() => setEmailError(isValidEmail(email) ? '' : (email ? 'Please enter a valid email address.' : ''))}
              required
            />
            {emailError && <div className="input-error-text">{emailError}</div>}
            <label htmlFor="admin-password">Password</label>
            <input id="admin-password" className="alpha-input" type="password" value={password} onChange={e => setPassword(e.target.value)} required />
            <button type="submit" style={{ width: '100%' }}>Sign In</button>
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
        </div>
      </div>
    );
  }

  if (!loading && !isAdmin) {
    return (
      <div className="alpha-theme client-auth admin-page" style={EMBEDDED ? { overflow: 'hidden' } : { minHeight: '100vh' }}>
        <div className="alpha-card auth-wrap client-card" style={{ width: '100%', maxWidth: 520 }}>
          <h2>Access denied</h2>
          <p>Your account is not an admin.</p>
          <button className="signout-btn" onClick={handleSignOut}>Sign Out</button>
        </div>
      </div>
    );
  }

  return (
    <>
      <style>{`
        .dash-page.alpha-theme.client-dash.admin-page input.alpha-input.client-dash-input.billing-terms-input {
          height: 52px !important;
          min-height: 52px !important;
          max-height: 52px !important;
          box-sizing: border-box !important;
          line-height: 24px !important;
          padding: 12px 14px !important;
          display: block !important;
          flex: 0 0 auto !important;
          align-self: flex-start !important;
        }
      `}</style>
      <div className="dash-page alpha-theme client-dash admin-page">
        <div className="dash-center dash-inner">
          <div className="dash-head">
            <h1 style={{ margin: 0 }}>Admin Dashboard</h1>
            <div className="dash-actions" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <span>{me?.user?.email || me?.email}</span>
              <button className="btn lilac client-dash-pill" onClick={handleSignOut}>Sign Out</button>
            </div>
          </div>

          {activeTab !== 'billing' && (
            <div className="client-dash-card" style={{ marginBottom: 8 }}>
              <div className="client-dash-row" style={{ marginBottom: 0 }}>
                <label htmlFor="admin-client-sel" style={{ minWidth: 110 }}>Current client</label>
                <select
                  id="admin-client-sel"
                  className="alpha-input alpha-select client-dash-input"
                  value={selectedClientId}
                  onChange={e => setSelectedClientId(e.target.value)}
                >
                  <option value={ALL_CLIENTS_VALUE}>All</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <div style={{ color: '#9CA3AF' }}>
                  Viewing <strong>{currentClientName || selectedClientId || '—'}</strong>
                </div>
              </div>
            </div>
          )}
          {activeTab === 'billing' && (
            <div className="client-dash-card" style={{ marginBottom: 8, opacity: 0.6, pointerEvents: 'none' }}>
              <div className="client-dash-row" style={{ marginBottom: 0 }}>
                <label htmlFor="admin-client-sel" style={{ minWidth: 110 }}>Current client</label>
                <select
                  id="admin-client-sel"
                  className="alpha-input alpha-select client-dash-input"
                  value={selectedClientId}
                  onChange={e => setSelectedClientId(e.target.value)}
                >
                  <option value={ALL_CLIENTS_VALUE}>All</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <div style={{ color: '#9CA3AF' }}>
                  Viewing <strong>{currentClientName || selectedClientId || '—'}</strong>
                </div>
                <div style={{ color: '#9CA3AF', marginLeft: 12, fontSize: 13 }}>
                  Billing is global (not scoped to selected client).
                </div>
              </div>
            </div>
          )}

          <div className="dash-tabs">
            <button
              type="button"
              onClick={() => setActiveTab('clients')}
              className={`client-dash-tab ${activeTab === 'clients' ? 'client-dash-tab--active' : ''}`}
            >
              Clients
            </button>
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
            <button
              type="button"
              onClick={() => setActiveTab('role-config')}
              className={`client-dash-tab ${activeTab === 'role-config' ? 'client-dash-tab--active' : ''}`}
            >
              Role Config
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('members')}
              className={`client-dash-tab ${activeTab === 'members' ? 'client-dash-tab--active' : ''}`}
            >
              Members
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('accommodations')}
              className={`client-dash-tab ${activeTab === 'accommodations' ? 'client-dash-tab--active' : ''}`}
            >
              Accommodation Requests
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('billing')}
              className={`client-dash-tab ${activeTab === 'billing' ? 'client-dash-tab--active' : ''}`}
            >
              Billing
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('audit-logs')}
              className={`client-dash-tab ${activeTab === 'audit-logs' ? 'client-dash-tab--active' : ''}`}
            >
              Audit Logs
            </button>
          </div>

          <div className="dash-scroll">
            {activeTab === 'clients' && (
              <div className="client-dash-card">
                <div className="client-dash-section-head">
                  <h2>Clients</h2>
                  <button
                    className="btn lilac client-dash-pill"
                    onClick={processRenewals}
                    disabled={processRenewalsBusy}
                  >
                    {processRenewalsBusy ? 'Processing…' : 'Process Renewals'}
                  </button>
                </div>
                <div className="client-dash-row">
                  <input className="alpha-input client-dash-input" placeholder="Client name" value={newClientName} onChange={e => setNewClientName(e.target.value)} />
                  <input className="alpha-input client-dash-input" placeholder="Client admin name" value={newClientAdminName} onChange={e => setNewClientAdminName(e.target.value)} />
                  <input className="alpha-input client-dash-input" placeholder="Admin email" value={newClientAdminEmail} onChange={e => setNewClientAdminEmail(e.target.value)} />
                  <select className="alpha-input alpha-select client-dash-input" value={newClientAdminRole} onChange={e => setNewClientAdminRole(e.target.value)}>
                    <option value="manager">Manager (standard)</option>
                    <option value="tester">Tester (beta with NDA splash)</option>
                    <option value="member">Member</option>
                  </select>
                  <button className="btn lilac client-dash-pill" onClick={createClient}>Create</button>
                </div>
                <div className="card-scroll" style={{ overflowY: 'visible', maxHeight: 'none' }}>
                  <div className="client-dash-table clients-billing" style={{ overflowY: 'visible', maxHeight: 'none' }}>
                    <div className="t-head" style={{ gridTemplateColumns: '2.2fr 0.9fr 1.1fr 1.1fr 0.8fr 0.6fr', position: 'sticky', top: 0, zIndex: 5, background: '#0A1547' }}>
                      <div>Name</div>
                      <div>Plan tier</div>
                      <div>Billing status</div>
                      <div>Billing cycle</div>
                      <div>Auto-Renew</div>
                      <div>Remove</div>
                    </div>
                    <div className="t-body">
                      {clients.map(c => {
                        const expanded = expandedClientId === c.id;
                        const invoicePlanTier = String(
                          clientInvoicePlanTiers[c.id] ||
                          (['basic', 'pro', 'enterprise'].includes(String(c.plan_tier || '').toLowerCase())
                            ? String(c.plan_tier || '').toLowerCase()
                            : 'basic')
                        ).toLowerCase();
                        const invoiceBillingInterval = String(
                          clientInvoiceIntervals[c.id] ||
                          (String(c.billing_interval || '').toLowerCase() === 'annual' ? 'annual' : 'monthly')
                        ).toLowerCase() === 'annual' ? 'annual' : 'monthly';
                        return (
                          <React.Fragment key={c.id}>
                            <div className="t-row" style={{ gridTemplateColumns: '2.2fr 0.9fr 1.1fr 1.1fr 0.8fr 0.6fr' }}>
                              <div className="grow">
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <button className="btn-icon" onClick={() => setExpandedClientId(expanded ? null : c.id)} title={expanded ? 'Collapse' : 'Expand'}>
                                    <span style={{ color: '#fff', fontSize: 14 }}>{expanded ? '▾' : '▸'}</span>
                                  </button>
                                  <div>
                                    <div className="title">{c.name}</div>
                                    <div className="sub">Created {new Date(c.created_at).toLocaleString()}</div>
                                  </div>
                                </div>
                              </div>
                              <div className="muted" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
                                {String(c.billing_status || '').toLowerCase() === 'active' ? (c.plan_tier || '—') : '—'}
                              </div>
                              <div className="muted" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>{getClientBillingDisplay(c)}</div>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
                                {String(c.billing_status || '').toLowerCase() === 'active' ? (
                                  <div className="muted">
                                    {
                                      c.billing_interval === 'annual'
                                        ? 'Annual'
                                        : (c.billing_interval === 'monthly' ? 'Monthly' : '—')
                                    }
                                  </div>
                                ) : (
                                  <div className="muted">—</div>
                                )}
                              </div>
                              <div className="muted" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
                                {isLiveStripeSubscription(c) ? (
                                  <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%' }} title="Auto-Renew">
                                    <input
                                      type="checkbox"
                                      checked={c.auto_renew === true}
                                      disabled={!!clientAutoRenewBusy[c.id]}
                                      aria-label="Auto-Renew"
                                      title="Auto-Renew"
                                      style={{ width: 18, height: 18, accentColor: '#9CA3AF' }}
                                      onChange={(e) => { void updateClientAutoRenew(c.id, e.target.checked); }}
                                    />
                                  </label>
                                ) : (
                                  <div style={{ width: '100%', textAlign: 'center' }}>—</div>
                                )}
                              </div>
                              <div className="center" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <button className="btn-icon" onClick={() => setConfirmClient({ open: true, id: c.id })} title="Delete client">
                                  <IconTrash size={24} />
                                </button>
                              </div>
                            </div>
                            {expanded && (
                              <div className="t-row" style={{ gridTemplateColumns: '1fr', background: 'rgba(15,23,42,0.45)' }}>
                                <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'minmax(280px,1.3fr) minmax(240px,1fr)' }}>
                                  <div>
                                    <div><strong>Subscription details</strong></div>
                                    {isClientActivelySubscribed(c) ? (
                                      <div>
                                        <div><strong>Billing status:</strong> {getClientBillingDisplay(c)}</div>
                                        <div className="muted">
                                          Stripe subscription: {c.subscription_status || '—'}
                                        </div>
                                        <div className="muted">
                                          Billing cycle: {
                                            c.billing_interval === 'annual'
                                              ? 'Annual'
                                              : (c.billing_interval === 'monthly' ? 'Monthly' : '—')
                                          }
                                        </div>
                                        <div className="muted">
                                          Contract: {formatShortDate(c.contract_start_at)} – {formatShortDate(c.contract_end_at)}
                                        </div>
                                        <div className="muted">
                                          Current billing period ends: {formatShortDate(c.current_term_end)}
                                        </div>
                                        <div className="muted">
                                          Renewal: {c.auto_renew === true ? 'Auto-renew on' : 'Auto-renew off'}
                                        </div>
                                        {String(c.billing_interval || '').toLowerCase() === 'monthly' && c.auto_renew === false && String(c.billing_status || '').toLowerCase() !== 'inactive' && (
                                          <div className="muted">
                                            Contract: Will end at contract term
                                          </div>
                                        )}
                                        {String(c.billing_interval || '').toLowerCase() === 'annual' && c.cancel_at_term_end === true && (
                                          <div className="muted">
                                            Stripe: cancellation at billing period end
                                          </div>
                                        )}
                                      </div>
                                    ) : (
                                      <div>
                                        <div><strong>Billing status:</strong> {getClientBillingDisplay(c)}</div>
                                        <div className="muted">
                                          Stripe subscription: {c.subscription_status || '—'}
                                        </div>
                                        <div className="muted">
                                          Billing cycle: {
                                            c.billing_interval === 'annual'
                                              ? 'Annual'
                                              : (c.billing_interval === 'monthly' ? 'Monthly' : '—')
                                          }
                                        </div>
                                        <div className="muted">
                                          Contract: {formatShortDate(c.contract_start_at)} – {formatShortDate(c.contract_end_at)}
                                        </div>
                                        <div className="muted">
                                          Current billing period ends: {formatShortDate(c.current_term_end)}
                                        </div>
                                        <div className="muted">
                                          Renewal: {c.auto_renew === true ? 'Auto-renew on' : 'Auto-renew off'}
                                        </div>
                                      </div>
                                    )}
                                    {String(c.plan_tier || '').toLowerCase() === 'enterprise' && (
                                      <div style={{ marginTop: 8 }}>
                                        <div className="muted">Per-role fee: {formatCurrency(c.plan_settings_per_role_fee)}</div>
                                        <div className="muted">Additional interview fee: {formatCurrency(c.plan_settings_additional_interview_fee)}</div>
                                        <div className="muted">Included interviews per role: {c.plan_settings_included_interviews_per_role ?? '—'}</div>
                                      </div>
                                    )}
                                  </div>
                                  <div>
                                    {canCancelContractNow(c) && (
                                      <div style={{ marginTop: 8 }}>
                                        <button
                                          className="btn lilac client-dash-pill"
                                          onClick={() => openCancelContractModal(c)}
                                          disabled={cancelContractSubmitBusy && cancelContractClientId === c.id}
                                          style={{ padding: '6px 10px' }}
                                        >
                                          {cancelContractSubmitBusy && cancelContractClientId === c.id ? 'Canceling…' : 'Cancel Contract'}
                                        </button>
                                      </div>
                                    )}
                                    <div className="muted" style={{ marginTop: 8 }}>
                                      Access override: {getAccessOverrideModeLabel(c.access_override_mode)}
                                    </div>
                                    <div style={{ marginTop: 8 }}>
                                      <select
                                        className="alpha-input alpha-select client-dash-input"
                                        value={String(c.access_override_mode || 'inherit').toLowerCase()}
                                        onChange={(e) => { void updateClientAccessOverride(c.id, e.target.value); }}
                                        disabled={!!clientAccessOverrideBusy[c.id]}
                                        style={{ maxWidth: 180 }}
                                      >
                                        <option value="inherit">Inherit</option>
                                        <option value="force_active">Force Active</option>
                                        <option value="force_inactive">Force Inactive</option>
                                      </select>
                                    </div>
                                    {!isLiveStripeSubscription(c) && (
                                      <div style={{ marginTop: 12 }}>
                                        <div><strong>Subscription Checkout Link</strong></div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                                          <select
                                            className="alpha-input alpha-select client-dash-input"
                                            value={invoicePlanTier}
                                            onChange={(e) => setClientInvoicePlanTiers((prev) => ({ ...prev, [c.id]: String(e.target.value || 'basic').toLowerCase() }))}
                                            disabled={!!clientSubscriptionInvoiceBusy[c.id]}
                                            style={{ maxWidth: 130 }}
                                          >
                                            <option value="basic">Basic</option>
                                            <option value="pro">Pro</option>
                                            <option value="enterprise">Enterprise</option>
                                          </select>
                                          <select
                                            className="alpha-input alpha-select client-dash-input"
                                            value={invoiceBillingInterval}
                                            onChange={(e) => setClientInvoiceIntervals((prev) => ({ ...prev, [c.id]: e.target.value === 'annual' ? 'annual' : 'monthly' }))}
                                            disabled={!!clientSubscriptionInvoiceBusy[c.id]}
                                            style={{ maxWidth: 130 }}
                                          >
                                            <option value="monthly">Monthly</option>
                                            <option value="annual">Annual</option>
                                          </select>
                                        </div>
                                        {invoicePlanTier === 'enterprise' && (
                                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                                            <input
                                              className="alpha-input client-dash-input"
                                              type="number"
                                              min="0"
                                              step="0.01"
                                              placeholder="Platform fee"
                                              value={clientInvoicePlatformFees[c.id] ?? ''}
                                              onChange={(e) => setClientInvoicePlatformFees((prev) => ({ ...prev, [c.id]: e.target.value }))}
                                              disabled={!!clientSubscriptionInvoiceBusy[c.id]}
                                              style={{ maxWidth: 130 }}
                                            />
                                            <input
                                              className="alpha-input client-dash-input"
                                              type="number"
                                              min="0"
                                              step="0.01"
                                              placeholder="Per-role fee"
                                              value={clientInvoicePerRoleFees[c.id] ?? ''}
                                              onChange={(e) => setClientInvoicePerRoleFees((prev) => ({ ...prev, [c.id]: e.target.value }))}
                                              disabled={!!clientSubscriptionInvoiceBusy[c.id]}
                                              style={{ maxWidth: 130 }}
                                            />
                                            <input
                                              className="alpha-input client-dash-input"
                                              type="number"
                                              min="0"
                                              step="1"
                                              placeholder="Included interviews/role"
                                              value={clientInvoiceIncludedInterviewsPerRole[c.id] ?? ''}
                                              onChange={(e) => setClientInvoiceIncludedInterviewsPerRole((prev) => ({ ...prev, [c.id]: e.target.value }))}
                                              disabled={!!clientSubscriptionInvoiceBusy[c.id]}
                                              style={{ maxWidth: 180 }}
                                            />
                                            <input
                                              className="alpha-input client-dash-input"
                                              type="number"
                                              min="0"
                                              step="0.01"
                                              placeholder="Additional interview fee"
                                              value={clientInvoiceAdditionalInterviewFees[c.id] ?? ''}
                                              onChange={(e) => setClientInvoiceAdditionalInterviewFees((prev) => ({ ...prev, [c.id]: e.target.value }))}
                                              disabled={!!clientSubscriptionInvoiceBusy[c.id]}
                                              style={{ maxWidth: 180 }}
                                            />
                                          </div>
                                        )}
                                        <div style={{ marginTop: 8 }}>
                                          <button
                                            className="btn lilac client-dash-pill"
                                            onClick={() => sendClientSubscriptionInvoice(c.id, c.plan_tier, c.billing_interval)}
                                            disabled={!!clientSubscriptionInvoiceBusy[c.id]}
                                            style={{ padding: '6px 10px' }}
                                          >
                                            {clientSubscriptionInvoiceBusy[c.id] ? 'Sending…' : 'Send Checkout Link'}
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            )}
                          </React.Fragment>
                        );
                      })}
                      {clients.length === 0 && <div className="t-empty muted">No clients yet</div>}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'roles' && (
              <div className="client-dash-card">
                <div className="client-dash-section-head">
                  <h2>Roles</h2>
                </div>
                <div className="client-dash-row">
                  <input className="alpha-input client-dash-input" placeholder="Role title" value={newRoleTitle} onChange={e => setNewRoleTitle(e.target.value)} />
                  <select className="alpha-input alpha-select client-dash-input" value={interviewType} onChange={e => setInterviewType(e.target.value)}>
                    <option value="BASIC">BASIC</option>
                    <option value="DETAILED">DETAILED</option>
                    <option value="TECHNICAL">TECHNICAL</option>
                  </select>
                  <div className="client-dash-file-wrapper" style={{ flex: '1 1 240px' }}>
                    <CustomFilePicker
                      key={fileKey}
                      accept=".pdf,.doc,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                      onFileSelected={handleRoleFileFromPicker}
                      label="Drag JD file here or click to browse"
                      className="client-dash-input client-dash-file-input"
                      inputRef={fileInputRef}
                    />
                  </div>
                  {jobFile && (
                    <button
                      type="button"
                      className="btn lilac client-dash-pill"
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
                    className={`btn lilac client-dash-pill ${isAllClients ? 'is-disabled' : ''}`}
                    aria-disabled={isAllClients}
                    disabled={!selectedClientId || roleBusy || !newRoleTitle.trim() || !jobFile}
                    onClick={createRole}
                    title={isAllClients ? 'Select a client to perform this action.' : (!jobFile ? 'Choose a PDF or DOCX to enable Create' : 'Create role')}
                  >
                    {roleBusy ? 'Creating…' : 'Create'}
                  </button>
                </div>
                <div className="card-scroll">
                  <div className={`client-dash-table ${isAllClients ? 'roles-with-client' : ''}`}>
                    <div className="t-head">
                      <div>Role</div>
                      {isAllClients && <div>Client</div>}
                      <div>Created</div>
                      <div>Type</div>
                      <div className="col-center">Rubric</div>
                      <div className="col-center">JD</div>
                      <div>Link</div>
                      <div>Delete</div>
                    </div>
                    <div className="t-body">
                      {roles.map(r => {
                        const rubricQuestions = extractRubricQuestions(r.rubric);
                        const hasRubric = rubricQuestions.length > 0;
                        const hasJD = !!r.job_description_url;
                        const roleClientId = r.client_id || r.clientId || r.client?.id;
                        const roleClientName = clientNameById[roleClientId] || r.client_name || r.client?.name || '—';
                        return (
                          <div key={r.id} className="t-row">
                            <div>
                              <div className="title">{r.title}</div>
                              <div className="sub">Token: {r.slug_or_token}</div>
                            </div>
                            {isAllClients && <div>{roleClientName}</div>}
                            <div>{r.created_at ? new Date(r.created_at).toLocaleString() : '—'}</div>
                            <div>{r.interview_type || '—'}</div>
                            <div className="col-center">
                              {hasRubric ? (
                                <button
                                  className="btn-icon"
                                  onClick={() => openRubricModal({ ...r, rubric: r.rubric })}
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
                              <button className="btn lilac client-dash-pill" onClick={() => safeCopy(`${shareBase}/${r.slug_or_token}`)}>Copy link</button>
                            </div>
                            <div className="center">
                              <button
                                className={`btn-icon ${isAllClients ? 'is-disabled' : ''}`}
                                aria-disabled={isAllClients}
                                onClick={() => {
                                  if (!requireClientContext()) return;
                                  setConfirmRole({ open: true, id: r.id });
                                }}
                                title={isAllClients ? 'Select a client to perform this action.' : 'Delete role'}
                              >
                                <IconTrash size={24} />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                      {roles.length === 0 && <div className="t-empty muted">No roles yet</div>}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'candidates' && (
              <div className="client-dash-card">
                <div className="client-dash-section-head">
                  <h2>Candidates</h2>
                </div>
                <div className="client-dash-row">
                  <select
                    className="alpha-input alpha-select client-dash-input"
                    value={candidateRoleFilter}
                    onChange={(e) => setCandidateRoleFilter(e.target.value)}
                    disabled={!selectedClientId || isAllClients}
                  >
                    <option value="">All roles</option>
                    {roles.map(r => <option key={r.id} value={r.id}>{r.title}</option>)}
                  </select>
                  <button
                    className="btn lilac client-dash-pill"
                    onClick={() => refreshCandidates(selectedClientId, candidateRoleFilter)}
                    disabled={candidatesLoading}
                  >
                    {candidatesLoading ? 'Loading…' : 'Refresh'}
                  </button>
                </div>
                {!!candidatesMessage && (
                  <div className="client-dash-muted" style={{ marginTop: 8 }}>
                    {candidatesMessage}
                  </div>
                )}
                {!candidatesMessage && (
                  <div className="card-scroll">
                    <div className="client-dash-table members members-extended">
                      <div className="t-head" style={{ gridTemplateColumns: '2.2fr 1.1fr 1.1fr 0.7fr 0.7fr 0.7fr 1.2fr 0.6fr' }}>
                        <div>Candidate</div>
                        <div>Role</div>
                        <div>Created</div>
                        <div>Resume</div>
                        <div>Interview</div>
                        <div>Overall</div>
                        <div>Actions</div>
                        <div>Delete</div>
                      </div>
                      <div className="t-body">
                        {candidates.map((c) => {
                          const opened = expandedCandidateId === c.id;
                          const roleTitle = roles.find((r) => r.id === c.role_id)?.title || '—';
                          const pct = (v) => (typeof v === 'number' && isFinite(v)) ? `${Math.max(0, Math.min(100, Math.round(v)))}%` : '—';
                          return (
                            <React.Fragment key={c.id}>
                              <div className="t-row" style={{ gridTemplateColumns: '2.2fr 1.1fr 1.1fr 0.7fr 0.7fr 0.7fr 1.2fr 0.6fr' }}>
                                <div className="grow">
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <button className="btn-icon" onClick={() => setExpandedCandidateId(opened ? null : c.id)} title={opened ? 'Collapse' : 'Expand'}>
                                      <span style={{ color: '#fff', fontSize: 14 }}>{opened ? '▾' : '▸'}</span>
                                    </button>
                                    <div className="title">{c.name || '—'}</div>
                                  </div>
                                  <div className="sub">{c.email || '—'}</div>
                                </div>
                                <div>{roleTitle}</div>
                                <div>{c.created_at ? new Date(c.created_at).toLocaleString() : '—'}</div>
                                <div>{pct(c.resume_score)}</div>
                                <div>{pct(c.interview_score)}</div>
                                <div>{pct(c.overall_score)}</div>
                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                  <button
                                    className={`btn lilac client-dash-pill ${!c.resume_url ? 'is-disabled' : ''}`}
                                    onClick={() => c.resume_url && window.open(c.resume_url, '_blank', 'noopener,noreferrer')}
                                    disabled={!c.resume_url}
                                  >
                                    Resume
                                  </button>
                                  <button
                                    className={`btn lilac client-dash-pill ${candidateReportGenerating[c.id] ? 'is-disabled' : ''}`}
                                    onClick={() => generateCandidateReport(c)}
                                    disabled={!!candidateReportGenerating[c.id]}
                                  >
                                    {candidateReportGenerating[c.id] ? 'Generating…' : 'Report'}
                                  </button>
                                </div>
                                <div className="center">
                                  <button className="btn-icon" onClick={() => deleteCandidate(c.id)} title="Delete candidate">
                                    <IconTrash size={20} />
                                  </button>
                                </div>
                              </div>
                              {opened && (
                                <div className="t-row" style={{ gridTemplateColumns: '1fr', background: 'rgba(15,23,42,0.45)' }}>
                                  <div>
                                    <div className="sub">Status: {c.status || c.interview_status || '—'}</div>
                                    <div className="sub">Report generated: {c.report_generated_at ? new Date(c.report_generated_at).toLocaleString() : '—'}</div>
                                  </div>
                                </div>
                              )}
                            </React.Fragment>
                          );
                        })}
                        {candidates.length === 0 && <div className="t-empty muted">No candidates found</div>}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'role-config' && (
              <div className="client-dash-card">
                <div className="client-dash-section-head">
                  <h2>Role Config</h2>
                </div>
                {isAllClients ? (
                  <div className="client-dash-muted">Select a client to view role configs.</div>
                ) : (
                  <div className="card-scroll">
                    <div className="client-dash-table members members-extended">
                      <div className="t-head" style={{ gridTemplateColumns: '2fr 1fr 0.7fr' }}>
                        <div>Role</div>
                        <div>Type</div>
                        <div>Config</div>
                      </div>
                      <div className="t-body">
                        {roles.map((r) => {
                          const expanded = expandedRoleConfigId === r.id;
                          const cfg = roleConfigs[r.id] || { prompt: '', questions: [] };
                          return (
                            <React.Fragment key={r.id}>
                              <div className="t-row" style={{ gridTemplateColumns: '2fr 1fr 0.7fr' }}>
                                <div className="grow">
                                  <div className="title">{r.title}</div>
                                  <div className="sub">{r.slug_or_token || '—'}</div>
                                </div>
                                <div>{r.interview_type || '—'}</div>
                                <div>
                                  <button className="btn lilac client-dash-pill" onClick={() => openRoleConfig(r.id)}>
                                    {expanded ? 'Hide' : 'Edit'}
                                  </button>
                                </div>
                              </div>
                              {expanded && (
                                <div className="t-row" style={{ gridTemplateColumns: '1fr', background: 'rgba(15,23,42,0.45)' }}>
                                  {roleConfigLoading[r.id] ? (
                                    <div className="muted">Loading config…</div>
                                  ) : (
                                    <div style={{ display: 'grid', gap: 10 }}>
                                      <div>
                                        <div className="sub" style={{ marginBottom: 6 }}>Tavus Prompt</div>
                                        <textarea
                                          className="alpha-input"
                                          rows={5}
                                          value={cfg.prompt}
                                          onChange={(e) => setRoleConfigs((prev) => ({ ...prev, [r.id]: { ...(prev[r.id] || {}), prompt: e.target.value } }))}
                                        />
                                      </div>
                                      <div>
                                        <div className="sub" style={{ marginBottom: 6 }}>Rubric Questions</div>
                                        {(cfg.questions || []).map((q, idx) => (
                                          <div key={`${r.id}-q-${idx}`} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                            <textarea
                                              className="alpha-input"
                                              rows={2}
                                              value={q}
                                              onChange={(e) => setRoleConfigs((prev) => {
                                                const existing = prev[r.id] || { prompt: '', questions: [] };
                                                const nextQuestions = Array.isArray(existing.questions) ? [...existing.questions] : [];
                                                nextQuestions[idx] = e.target.value;
                                                return { ...prev, [r.id]: { ...existing, questions: nextQuestions } };
                                              })}
                                              style={{ flex: 1 }}
                                            />
                                            <button
                                              className="btn-icon"
                                              title="Remove question"
                                              onClick={() => setRoleConfigs((prev) => {
                                                const existing = prev[r.id] || { prompt: '', questions: [] };
                                                const nextQuestions = (Array.isArray(existing.questions) ? existing.questions : []).filter((_, i) => i !== idx);
                                                return { ...prev, [r.id]: { ...existing, questions: nextQuestions } };
                                              })}
                                            >
                                              <IconTrash size={18} />
                                            </button>
                                          </div>
                                        ))}
                                        <button
                                          className="btn lilac client-dash-pill"
                                          onClick={() => setRoleConfigs((prev) => {
                                            const existing = prev[r.id] || { prompt: '', questions: [] };
                                            const nextQuestions = Array.isArray(existing.questions) ? [...existing.questions, ''] : [''];
                                            return { ...prev, [r.id]: { ...existing, questions: nextQuestions } };
                                          })}
                                        >
                                          Add question
                                        </button>
                                      </div>
                                      <div>
                                        <button
                                          className="btn lilac client-dash-pill"
                                          onClick={() => saveRoleConfig(r.id)}
                                          disabled={!!roleConfigSaving[r.id]}
                                        >
                                          {roleConfigSaving[r.id] ? 'Saving…' : 'Save'}
                                        </button>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </React.Fragment>
                          );
                        })}
                        {roles.length === 0 && <div className="t-empty muted">No roles yet</div>}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'members' && (
              <div className="client-dash-card">
                <div className="client-dash-section-head">
                  <h2>Client Members</h2>
                </div>
                <div className="client-dash-row">
                  <input className="alpha-input client-dash-input" placeholder="Member name" value={memberName} onChange={e => setMemberName(e.target.value)} />
                  <input className="alpha-input client-dash-input" placeholder="Member email" value={memberEmail} onChange={e => setMemberEmail(e.target.value)} />
                  <select className="alpha-input alpha-select client-dash-input" value={memberRole} onChange={e => setMemberRole(e.target.value)}>
                    <option value="member">Member</option>
                    <option value="manager">Manager</option>
                    <option value="tester">Tester</option>
                  </select>
                  <button
                    className={`btn lilac client-dash-pill ${isAllClients ? 'is-disabled' : ''}`}
                    aria-disabled={isAllClients}
                    disabled={!selectedClientId}
                    onClick={addMember}
                    title={isAllClients ? 'Select a client to perform this action.' : undefined}
                  >
                    Add
                  </button>
                </div>
                <div className="card-scroll">
                  <div className={`client-dash-table members members-extended ${isAllClients ? 'members-with-client' : ''}`}>
                    <div className="t-head">
                      <div>Name</div>
                      {isAllClients && <div>Client</div>}
                      <div>Role</div>
                      <div>Reset</div>
                      <div>Remove</div>
                    </div>
                    <div className="t-body">
                      {members.map(m => {
                        const memberClientId = m.client_id || m.clientId;
                        const memberClientName = clientNameById[memberClientId] || '—';
                        return (
                          <div key={m.id} className="t-row">
                            <div className="grow">
                              <div className="title">{m.name}</div>
                              <div className="sub">{m.email}</div>
                            </div>
                            {isAllClients && <div>{memberClientName}</div>}
                            <div>{m.role || 'member'}</div>
                            <div className="center">
                              <button className="btn-icon" onClick={() => sendPasswordReset(m.email)} title="Send password reset">
                                <IconKey size={20} />
                              </button>
                            </div>
                            <div className="center">
                              <button
                                className={`btn-icon ${isAllClients ? 'is-disabled' : ''}`}
                                aria-disabled={isAllClients}
                                onClick={() => {
                                  if (!requireClientContext()) return;
                                  setConfirmMember({ open: true, id: m.id });
                                }}
                                title={isAllClients ? 'Select a client to perform this action.' : 'Remove member'}
                              >
                                <IconTrash size={20} />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                      {members.length === 0 && <div className="t-empty muted">{isAllClients ? 'No members found' : 'No members for this client'}</div>}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'accommodations' && (
              <div className="client-dash-card">
                <div className="client-dash-section-head">
                  <h2>Accommodation Requests</h2>
                </div>
                <div className="client-dash-row" style={{ alignItems: 'center' }}>
                  <label htmlFor="accommodation-status" style={{ minWidth: 120 }}>Status</label>
                  <select
                    id="accommodation-status"
                    className="alpha-input alpha-select client-dash-input"
                    value={accommodationFilter}
                    onChange={(e) => setAccommodationFilter(e.target.value)}
                  >
                    <option value="pending">Pending</option>
                    <option value="approved">Approved</option>
                    <option value="sent">Sent</option>
                    <option value="denied">Denied</option>
                    <option value="all">All</option>
                  </select>
                  <button className="btn lilac client-dash-pill" onClick={refreshAccommodations}>
                    Refresh
                  </button>
                </div>

                {accommodationsLoading && <div className="client-dash-muted">Loading accommodation requests…</div>}
                {!accommodationsLoading && accommodations.length === 0 && (
                  <div className="client-dash-muted">No accommodation requests found.</div>
                )}

                {!accommodationsLoading && accommodations.length > 0 && (
                  <div className="client-dash-table accommodations" style={{ marginTop: 8 }}>
                    <div className="t-head">
                      <div>Candidate</div>
                      <div>Role</div>
                      <div>Request</div>
                      <div>Status</div>
                      <div>Notes</div>
                      <div>Actions</div>
                    </div>
                    <div className="t-body">
                      {accommodations.map((req) => {
                        const roleTitle = req.role?.title || '—';
                        const statusVal = String(req.status || 'pending').toLowerCase();
                        const canSend = statusVal === 'approved';
                        const resumeUrl = req.resume_url;
                        return (
                          <div key={req.id} className="t-row accommodation-row">
                            <div className="grow">
                              <div className="title">{req.candidate_name || '—'}</div>
                              <div className="sub">{req.candidate_email || '—'}</div>
                              {req.candidate_phone && <div className="sub">{req.candidate_phone}</div>}
                              <div className="sub">Created {req.created_at ? new Date(req.created_at).toLocaleString() : '—'}</div>
                            </div>
                            <div>
                              <div className="title">{roleTitle}</div>
                              {resumeUrl ? (
                                <a href={resumeUrl} target="_blank" rel="noreferrer">Resume</a>
                              ) : (
                                <div className="muted">No resume</div>
                              )}
                            </div>
                            <div style={{ whiteSpace: 'pre-wrap' }}>{req.request_text || '—'}</div>
                            <div>
                              <select
                                className="alpha-input alpha-select client-dash-input"
                                value={statusVal}
                                onChange={(e) => updateAccommodation(req.id, { status: e.target.value })}
                                disabled={!!accommodationSaving[req.id]}
                              >
                                <option value="pending">Pending</option>
                                <option value="approved">Approved</option>
                                <option value="sent">Sent</option>
                                <option value="denied">Denied</option>
                              </select>
                              {req.approved_at && <div className="sub">Approved {new Date(req.approved_at).toLocaleString()}</div>}
                              {req.sent_at && <div className="sub">Sent {new Date(req.sent_at).toLocaleString()}</div>}
                            </div>
                            <div className="accommodation-notes">
                              <textarea
                                className="alpha-input"
                                rows={3}
                                value={accommodationNotes[req.id] ?? ''}
                                onChange={(e) => setAccommodationNotes((prev) => ({ ...prev, [req.id]: e.target.value }))}
                                placeholder="Admin notes"
                              />
                              <button
                                className="btn client-dash-pill accommodation-btn accommodation-btn-secondary"
                                style={{ marginTop: 6 }}
                                onClick={() => updateAccommodation(req.id, { admin_notes: accommodationNotes[req.id] || '' })}
                                disabled={!!accommodationSaving[req.id]}
                              >
                                {accommodationSaving[req.id] ? 'Saving…' : 'Save Notes'}
                              </button>
                            </div>
                            <div className="accommodation-actions">
                              <button
                                className="btn lilac client-dash-pill accommodation-btn"
                                onClick={() => sendTextInterviewLink(req.id)}
                                disabled={!canSend || !!accommodationSending[req.id]}
                                title={canSend ? 'Send text interview link' : 'Approve request to send'}
                              >
                                {accommodationSending[req.id] ? 'Sending…' : 'Send Link'}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'audit-logs' && (
              <>
                <div className="client-dash-card">
                  <div className="client-dash-section-head">
                    <h2>Audit Logs</h2>
                    <button
                      className="btn lilac client-dash-pill"
                      onClick={refreshAuditRuns}
                      disabled={auditRunsLoading}
                    >
                      {auditRunsLoading ? 'Loading…' : 'Refresh'}
                    </button>
                  </div>
                  {auditRunsLoading && <div className="client-dash-muted">Loading audit logs…</div>}
                  {!auditRunsLoading && auditRuns.length === 0 && (
                    <div className="client-dash-muted">No audit log runs yet</div>
                  )}
                  {!auditRunsLoading && auditRuns.length > 0 && (
                    <div className="card-scroll">
                      <div className="client-dash-table members members-extended">
                        <div className="t-head" style={{ gridTemplateColumns: '1.1fr 0.7fr 0.7fr 1.7fr 1.2fr 1.1fr 1.4fr' }}>
                          <div>Run time</div>
                          <div>Source</div>
                          <div>Status</div>
                          <div>Summary</div>
                          <div>Request ID</div>
                          <div>Triggered by</div>
                          <div>Error</div>
                        </div>
                        <div className="t-body">
                          {auditRuns.map((run) => {
                            const summary = run?.summary || {};
                            const skipped = (summary?.skipped_no_action || 0) + (summary?.skipped_manual_override || 0);
                            const summaryTitle = `due ${summary?.due || 0}, renewed ${summary?.renewed || 0}, deactivated ${summary?.deactivated || 0}, skipped ${skipped}, errors ${summary?.errors || 0}`;
                            return (
                              <div key={run.id} className="t-row" style={{ gridTemplateColumns: '1.1fr 0.7fr 0.7fr 1.7fr 1.2fr 1.1fr 1.4fr' }}>
                                <div>{run.started_at ? new Date(run.started_at).toLocaleString() : (run.created_at ? new Date(run.created_at).toLocaleString() : '—')}</div>
                                <div>{run.trigger_source || '—'}</div>
                                <div>{run.processed_ok === true ? 'success' : (run.processed_ok === false ? 'failed' : '—')}</div>
                                <div className="muted" title={summaryTitle}>errors {summary?.errors || 0}</div>
                                <div className="muted" title={run.request_id || undefined}>
                                  {run.request_id ? `.....${String(run.request_id).slice(-8)}` : '—'}
                                </div>
                                <div className="muted">{run.triggered_by_email || '—'}</div>
                                <div className="muted">{run.error || '—'}</div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="client-dash-card">
                  <div className="client-dash-section-head">
                    <h2>Billing Reconciliation</h2>
                    <button
                      className="btn lilac client-dash-pill"
                      onClick={refreshBillingReconciliation}
                      disabled={billingReconciliationLoading}
                    >
                      {billingReconciliationLoading ? 'Loading…' : 'Refresh'}
                    </button>
                  </div>
                  {billingReconciliationLoading && <div className="client-dash-muted">Loading billing reconciliation…</div>}
                  {!billingReconciliationLoading && billingReconciliationItems.length === 0 && (
                    <div className="client-dash-muted">No billing mismatches found</div>
                  )}
                  {!billingReconciliationLoading && billingReconciliationItems.length > 0 && (
                    <div className="card-scroll">
                      <div className="client-dash-table members members-extended">
                        <div className="t-head" style={{ gridTemplateColumns: '1.5fr 0.9fr 0.9fr 0.9fr 0.9fr 1.1fr 1.5fr' }}>
                          <div>Client</div>
                          <div>App status</div>
                          <div>Access override</div>
                          <div>Stripe status</div>
                          <div>Cancel at term end</div>
                          <div>Contract end</div>
                          <div>Reason</div>
                        </div>
                        <div className="t-body">
                          {billingReconciliationItems.map((item) => (
                            <div key={`${item.id}-${item.reason}`} className="t-row" style={{ gridTemplateColumns: '1.5fr 0.9fr 0.9fr 0.9fr 0.9fr 1.1fr 1.5fr' }}>
                              <div>{item.name || '—'}</div>
                              <div>{item.manual_active_override === true ? `${item.billing_status || '—'} (manual)` : (item.billing_status || '—')}</div>
                              <div>{item.access_override_mode || 'inherit'}</div>
                              <div>{item.subscription_status || '—'}</div>
                              <div>{item.cancel_at_term_end === true ? 'true' : 'false'}</div>
                              <div>{item.contract_end_at ? new Date(item.contract_end_at).toLocaleString() : '—'}</div>
                              <div className="muted">{item.reason || '—'}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="client-dash-card">
                  <div className="client-dash-section-head">
                    <h2>Contract Cancellation Runs</h2>
                    <button
                      className="btn lilac client-dash-pill"
                      onClick={refreshContractCancellationRuns}
                      disabled={contractCancellationRunsLoading}
                    >
                      {contractCancellationRunsLoading ? 'Loading…' : 'Refresh'}
                    </button>
                  </div>
                  {contractCancellationRunsLoading && <div className="client-dash-muted">Loading contract cancellation runs…</div>}
                  {!contractCancellationRunsLoading && contractCancellationRuns.length === 0 && (
                    <div className="client-dash-muted">No contract cancellation runs yet</div>
                  )}
                  {!contractCancellationRunsLoading && contractCancellationRuns.length > 0 && (
                    <div className="card-scroll">
                      <div className="client-dash-table members members-extended">
                        <div className="t-head" style={{ gridTemplateColumns: '1.2fr 0.8fr 1fr 1fr 1fr 0.9fr 1fr 1.2fr 1.2fr' }}>
                          <div>Client</div>
                          <div>Status</div>
                          <div>Triggered by</div>
                          <div>Started</div>
                          <div>Completed</div>
                          <div>Final invoice</div>
                          <div>Stripe invoice</div>
                          <div>Note</div>
                          <div>Error</div>
                        </div>
                        <div className="t-body">
                          {contractCancellationRuns.map((run) => (
                            <div key={run.id} className="t-row" style={{ gridTemplateColumns: '1.2fr 0.8fr 1fr 1fr 1fr 0.9fr 1fr 1.2fr 1.2fr' }}>
                              <div>{run.client_name || '—'}</div>
                              <div>{run.status || '—'}</div>
                              <div className="muted">{run.triggered_by_email || '—'}</div>
                              <div className="muted">{run.started_at ? new Date(run.started_at).toLocaleString() : '—'}</div>
                              <div className="muted">{run.completed_at ? new Date(run.completed_at).toLocaleString() : '—'}</div>
                              <div className="muted">{run.final_invoice_amount != null ? String(run.final_invoice_amount) : '—'}</div>
                              <div className="muted">{run.stripe_invoice_id || '—'}</div>
                              <div className="muted">{run.note || '—'}</div>
                              <div className="muted">{run.error || '—'}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}

            {activeTab === 'billing' && (
              <>
                <div className="client-dash-card">
                  <div className="client-dash-section-head">
                    <h2>Create Billing Customer</h2>
                    {billingLoading && <div className="muted">Loading…</div>}
                  </div>
                  <div className="client-dash-row">
                    <input className="alpha-input client-dash-input" placeholder="Company name" value={billingCompanyName} onChange={(e) => setBillingCompanyName(e.target.value)} />
                    <input className="alpha-input client-dash-input" placeholder="Primary contact name" value={billingContactName} onChange={(e) => setBillingContactName(e.target.value)} />
                    <input className="alpha-input client-dash-input" placeholder="Primary contact email" value={billingContactEmail} onChange={(e) => setBillingContactEmail(e.target.value)} />
                  </div>
                  <div className="client-dash-row">
                    <input className="alpha-input client-dash-input" placeholder="Notes (optional)" value={billingNotes} onChange={(e) => setBillingNotes(e.target.value)} />
                    <button className="btn lilac client-dash-pill" onClick={createBillingCustomer}>Create billing customer</button>
                  </div>
                </div>

                <div className="client-dash-card">
                  <div className="client-dash-section-head">
                    <h2>Send Invoice</h2>
                    {billingHostedUrl && (
                      <button className="btn lilac client-dash-pill" onClick={() => safeCopy(billingHostedUrl)}>Copy last invoice link</button>
                    )}
                  </div>
                  <div className="client-dash-row" ref={customerDropdownRef}>
                    <div style={{ position: 'relative', width: '100%', maxWidth: 600 }}>
                      <input
                        className="alpha-input client-dash-input"
                        placeholder="Select billing customer…"
                        value={billingCustomerQuery}
                        onChange={(e) => {
                          setBillingCustomerQuery(e.target.value);
                          setBillingSelectedCustomerId('');
                          setBillingSelectedCustomerLabel('');
                          setBillingCustomerMenuOpen(true);
                        }}
                        onFocus={() => {
                          setBillingCustomerQuery(billingCustomerQuery || billingSelectedCustomerLabel);
                          setBillingCustomerMenuOpen(true);
                        }}
                        style={{ width: '100%' }}
                      />
                      {billingCustomerMenuOpen && filteredCustomers.length > 0 && (
                        <div className="billing-customer-menu" style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#0A1547', border: '1px solid rgba(255,255,255,0.16)', borderRadius: 10, zIndex: 10, maxHeight: 260, overflowY: 'auto' }}>
                          {filteredCustomers.map((c) => {
                            const label = `${c.name} (${c.primary_contact_email})`;
                            return (
                              <button
                                key={c.id}
                                type="button"
                                className="billing-customer-option"
                                style={{ width: '100%', textAlign: 'left', padding: '8px 10px', background: 'transparent', border: 'none', color: '#EBFEFF', cursor: 'pointer' }}
                                onClick={() => selectCustomer(c.id, label)}
                              >
                                {label}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    <input
                      className="alpha-input client-dash-input"
                      placeholder="Invoice title"
                      value={billingInvoiceTitle}
                      onChange={(e) => setBillingInvoiceTitle(e.target.value)}
                      onFocus={() => setBillingCustomerMenuOpen(false)}
                    />
                    <input
                      className="alpha-input client-dash-input"
                      placeholder="Invoice description (optional)"
                      value={billingInvoiceDesc}
                      onChange={(e) => setBillingInvoiceDesc(e.target.value)}
                      onFocus={() => setBillingCustomerMenuOpen(false)}
                    />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxWidth: 200 }}>
                      <input
                        className="alpha-input client-dash-input billing-terms-input"
                        type="number"
                        min={0}
                        max={90}
                        placeholder="7"
                        value={billingDueDays}
                        onChange={(e) => setBillingDueDays(e.target.value)}
                        onFocus={() => setBillingCustomerMenuOpen(false)}
                      />
                      <div className="muted" style={{ fontSize: 12 }}>Number of days the customer has to pay after the invoice is sent.</div>
                    </div>
                  </div>
                  <div className="card-scroll" style={{ maxHeight: 320 }}>
                    <div className="client-dash-table members members-extended" style={{ marginTop: 8 }}>
                      <div className="t-head" style={{ gridTemplateColumns: '2fr 0.6fr 0.8fr 0.4fr' }}>
                        <div>Description</div>
                        <div>Qty</div>
                        <div>Unit ($)</div>
                        <div>Remove</div>
                      </div>
                      <div className="t-body">
                        {billingLineItems.map((li) => (
                          <div key={li.id} className="t-row" style={{ gridTemplateColumns: '2fr 0.6fr 0.8fr 0.4fr' }}>
                            <input
                              className="alpha-input client-dash-input"
                              placeholder="Line item description"
                              value={li.description}
                              onChange={(e) => updateLineItem(li.id, 'description', e.target.value)}
                            />
                            <input
                              className="alpha-input client-dash-input"
                              type="number"
                              min={1}
                              value={li.quantity}
                              onChange={(e) => updateLineItem(li.id, 'quantity', e.target.value)}
                            />
                            <input
                              className="alpha-input client-dash-input"
                              type="number"
                              min={0}
                              step="0.01"
                              value={li.unitAmount}
                              onChange={(e) => updateLineItem(li.id, 'unitAmount', e.target.value)}
                            />
                            <div className="center">
                              <button className="btn-icon" onClick={() => removeLineItem(li.id)} title="Remove line item">
                                <IconTrash size={20} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="client-dash-row" style={{ justifyContent: 'space-between', marginTop: 8 }}>
                    <button className="btn lilac client-dash-pill" type="button" onClick={addLineItem}>Add line item</button>
                    <button
                      className="btn lilac client-dash-pill"
                      type="button"
                      disabled={!canSendInvoice || billingSending}
                      onClick={sendInvoice}
                    >
                      {billingSending ? 'Sending…' : 'Send Invoice'}
                    </button>
                  </div>
                </div>

                <div className="client-dash-card">
                  <div className="client-dash-section-head">
                    <h2>Invoice History</h2>
                  </div>
                  <div className="card-scroll">
                    <div className="client-dash-table members members-extended">
                      <div className="t-head" style={{ gridTemplateColumns: '1.1fr 1.3fr 1.4fr 0.8fr 0.8fr 0.8fr' }}>
                        <div>Created</div>
                        <div>Customer</div>
                        <div>Title</div>
                        <div>Amount</div>
                        <div>Status</div>
                        <div>Link</div>
                      </div>
                      <div className="t-body">
                        {billingInvoices.map((inv) => {
                          const customer = billingCustomers.find((c) => c.id === inv.billing_customer_id);
                          const custName = inv.customer_name || customer?.name || inv.billing_customer_id;
                          const custEmail = inv.customer_email || customer?.primary_contact_email || '';
                          const amountDisplay = inv.amount_total_cents != null ? `$${(Number(inv.amount_total_cents) / 100).toFixed(2)}` : '$0.00';
                          const invoiceTitle = inv.title || inv.invoice_title || '—';
                          return (
                            <div key={inv.id} className="t-row" style={{ gridTemplateColumns: '1.1fr 1.3fr 1.4fr 0.8fr 0.8fr 0.8fr' }}>
                              <div>{inv.created_at ? new Date(inv.created_at).toLocaleString() : '—'}</div>
                              <div>{custName}{custEmail ? ` (${custEmail})` : ''}</div>
                              <div>{invoiceTitle}</div>
                              <div>{amountDisplay}</div>
                              <div>{inv.status || '—'}</div>
                              <div>
                                {inv.hosted_invoice_url ? (
                                  <button className="btn lilac client-dash-pill" onClick={() => window.open(inv.hosted_invoice_url, '_blank', 'noopener,noreferrer')}>
                                    Open
                                  </button>
                                ) : '—'}
                              </div>
                            </div>
                          );
                        })}
                        {billingInvoices.length === 0 && <div className="t-empty muted">No invoices yet</div>}
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {rubricModalOpen && (
        <div className="rubric-modal-overlay" role="dialog" aria-modal="true">
          <div className="rubric-modal-card">
            <div className="rubric-modal-head">
              <h2>Rubric — {rubricRole?.title || 'Role'}</h2>
            </div>
            <div className="rubric-modal-body">
              {rubricQuestions.length === 0 ? (
                <div className="muted">—</div>
              ) : (
                <ol className="rubric-list">
                  {rubricQuestions.map((q, idx) => (
                    <li key={`${idx}-${q.slice(0, 12)}`}>{q}</li>
                  ))}
                </ol>
              )}
            </div>
            <div className="rubric-modal-actions">
              <button type="button" className="btn lilac client-dash-pill" onClick={closeRubricModal}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {cancelContractModalOpen && (
        <div className="rubric-modal-overlay" role="dialog" aria-modal="true">
          <div className="rubric-modal-card" style={{ maxWidth: 560 }}>
            <div className="rubric-modal-head">
              <h2>Cancel Contract</h2>
            </div>
            <div className="rubric-modal-body">
              <div className="muted" style={{ marginBottom: 8 }}>{cancelContractClientName || 'Client'}</div>
              <p style={{ marginTop: 0 }}>
                <strong>Contract ends immediately. App access turns off immediately. Stripe subscription is canceled immediately. This action is permanent.</strong>
              </p>
              <label style={{ display: 'block', marginBottom: 6 }}>Final invoice amount</label>
              <input
                className="alpha-input client-dash-input"
                type="number"
                min="0"
                step="0.01"
                placeholder="Optional"
                value={cancelContractFinalInvoiceAmount}
                onChange={(e) => setCancelContractFinalInvoiceAmount(e.target.value)}
                disabled={cancelContractSubmitBusy}
              />
              <label style={{ display: 'block', marginTop: 10, marginBottom: 6 }}>Note</label>
              <textarea
                className="alpha-input"
                rows={3}
                placeholder="Optional"
                value={cancelContractNote}
                onChange={(e) => setCancelContractNote(e.target.value)}
                disabled={cancelContractSubmitBusy}
              />
            </div>
            <div className="rubric-modal-actions">
              <button
                type="button"
                className="btn lilac client-dash-pill"
                onClick={closeCancelContractModal}
                disabled={cancelContractSubmitBusy}
              >
                Keep Contract
              </button>
              <button
                type="button"
                className="btn lilac client-dash-pill"
                onClick={confirmCancelContract}
                disabled={cancelContractSubmitBusy}
              >
                {cancelContractSubmitBusy ? 'Canceling…' : 'Confirm Cancellation'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmClient.open}
        title="Delete client"
        message="Are you sure you want to delete this client? This cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={() => confirmClient.id && deleteClient(confirmClient.id)}
        onCancel={() => setConfirmClient({ open: false, id: null })}
      />

      <ConfirmDialog
        open={confirmRole.open}
        title="Delete role"
        message="Are you sure you want to delete this role? This action cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={() => confirmRole.id && deleteRole(confirmRole.id)}
        onCancel={() => setConfirmRole({ open: false, id: null })}
      />

      <ConfirmDialog
        open={confirmMember.open}
        title="Remove member"
        message="Remove this member from the client?"
        confirmLabel="Remove"
        cancelLabel="Cancel"
        onConfirm={() => confirmMember.id && removeMember(confirmMember.id)}
        onCancel={() => setConfirmMember({ open: false, id: null })}
      />
    </>
  );
}
