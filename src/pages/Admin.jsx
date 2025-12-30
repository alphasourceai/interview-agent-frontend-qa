// src/pages/Admin.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { apiGet, apiPost, apiPatch, apiDelete, api } from '../lib/api';
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

  const [roles, setRoles] = useState([]);
  const [newRoleTitle, setNewRoleTitle] = useState('');
  const [interviewType, setInterviewType] = useState('BASIC');
  const [jobFile, setJobFile] = useState(null);
  const [roleBusy, setRoleBusy] = useState(false);
  const fileInputRef = useRef(null);
  const [fileKey, setFileKey] = useState(0);

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

  const shareBase = 'https://interviews.alphasourceai.com/interview-host';
  const isAllClients = selectedClientId === ALL_CLIENTS_VALUE;
  const clientNameById = useMemo(() => Object.fromEntries(clients.map((c) => [c.id, c.name])), [clients]);
  const currentClientName = useMemo(() => {
    if (isAllClients) return 'All clients';
    return clients.find((c) => c.id === selectedClientId)?.name || '';
  }, [clients, selectedClientId, isAllClients]);

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
    if (activeTab !== 'billing') return;
    refreshBilling();
  }, [isAdmin, activeTab]);

  useEffect(() => {
    if (!isAdmin) return;
    if (activeTab !== 'accommodations') return;
    refreshAccommodations();
  }, [isAdmin, activeTab, selectedClientId, accommodationFilter]);

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
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${origin}/pwreset`
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
        toast.success('Link copied to clipboard', { duration: 1000 });
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
          toast.success('Link copied to clipboard', { duration: 1000 });
          return;
        }
        throw new Error('execCommand_copy_failed');
      } catch (fallbackErr) {
        toast.error('Unable to copy link. Please right-click and copy link address.', { duration: 2500 });
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
          </div>

          <div className="dash-scroll">
            {activeTab === 'clients' && (
              <div className="client-dash-card">
                <div className="client-dash-section-head">
                  <h2>Clients</h2>
                </div>
                <div className="client-dash-row">
                  <input className="alpha-input client-dash-input" placeholder="Client name" value={newClientName} onChange={e => setNewClientName(e.target.value)} />
                  <input className="alpha-input client-dash-input" placeholder="Client admin name" value={newClientAdminName} onChange={e => setNewClientAdminName(e.target.value)} />
                  <input className="alpha-input client-dash-input" placeholder="Admin email" value={newClientAdminEmail} onChange={e => setNewClientAdminEmail(e.target.value)} />
                  <select className="alpha-input alpha-select client-dash-input" value={newClientAdminRole} onChange={e => setNewClientAdminRole(e.target.value)}>
                    <option value="manager">Manager (standard)</option>
                    <option value="tester">Tester (beta with NDA splash)</option>
                  </select>
                  <button className="btn lilac client-dash-pill" onClick={createClient}>Create</button>
                </div>
                <div className="card-scroll">
                  <div className="client-dash-table three-cols">
                    <div className="t-head">
                      <div>Name</div>
                      <div>Created</div>
                      <div>Remove</div>
                    </div>
                    <div className="t-body">
                      {clients.map(c => (
                        <div key={c.id} className="t-row">
                          <div className="grow">
                            <div className="title">{c.name}</div>
                            <div className="sub">Created {new Date(c.created_at).toLocaleString()}</div>
                          </div>
                          <div className="muted">{new Date(c.created_at).toLocaleDateString()}</div>
                          <div className="center">
                            <button className="btn-icon" onClick={() => setConfirmClient({ open: true, id: c.id })} title="Delete client">
                              <IconTrash size={24} />
                            </button>
                          </div>
                        </div>
                      ))}
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
                      <div>KB</div>
                      <div>JD</div>
                      <div>Link</div>
                      <div>Delete</div>
                    </div>
                    <div className="t-body">
                      {roles.map(r => {
                        const hasKB = !!r.kb_document_id;
                        const hasJD = !!r.job_description_url || !!r.description;
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
                            <div className="center">{hasKB ? '✓' : '—'}</div>
                            <div className="center">{hasJD ? '✓' : '—'}</div>
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
