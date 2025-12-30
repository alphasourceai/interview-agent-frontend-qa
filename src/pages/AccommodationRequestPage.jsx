// src/pages/AccommodationRequestPage.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import CustomFilePicker from '../components/CustomFilePicker';
import '../styles/agentTheme.css';

function joinUrl(base, path) {
  if (!base) return path;
  if (base.endsWith('/') && path.startsWith('/')) return base.slice(0, -1) + path;
  if (!base.endsWith('/') && !path.startsWith('/')) return base + '/' + path;
  return base + path;
}

const BK = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_BACKEND_URL)
  ? String(import.meta.env.VITE_BACKEND_URL).replace(/\/+$/, '')
  : '';

const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
const isValidPhone = (value) => /^(\d{10}|\(\d{3}\)\s?\d{3}-\d{4}|\d{3}-\d{3}-\d{4})$/.test(String(value || '').trim());

export default function AccommodationRequestPage() {
  const params = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const paramToken = params?.role_token || params?.token || params?.role || params?.id || '';

  const [roleToken, setRoleToken] = useState(paramToken || '');
  const [form, setForm] = useState({
    candidate_name: '',
    candidate_email: '',
    candidate_phone: '',
    accommodation_request_text: '',
    resume: null,
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [emailError, setEmailError] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (paramToken && paramToken !== roleToken) {
      setRoleToken(paramToken);
    }
  }, [paramToken, roleToken]);

  useEffect(() => {
    try {
      const u = new URL(window.location.href);
      const q = u.searchParams.get('role');
      if (q && !paramToken) {
        setRoleToken(q);
        navigate(`/accommodation-request/${encodeURIComponent(q)}`, { replace: true });
      }
    } catch {}
  }, [location.search, paramToken, navigate]);

  const header = useMemo(
    () => (
      <header className="alpha-header" role="banner" aria-label="AlphaSource site header">
        <div className="inner">
          <div className="brand" aria-label="AlphaSource Home">
            <img src="/alpha-logo.png" alt="AlphaSource" />
          </div>
        </div>
      </header>
    ),
    []
  );

  const onChange = (e) => {
    const { name, value, files } = e.target;
    setForm((prev) => ({ ...prev, [name]: files ? files[0] : value }));
  };

  const onResumeSelected = (file) => {
    setForm((prev) => ({ ...prev, resume: file || null }));
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!form.candidate_name.trim()) {
      setError('Please enter your full name.');
      return;
    }
    if (!isValidEmail(form.candidate_email)) {
      setEmailError('Please enter a valid email address.');
      toast.error('Please enter a valid email address.', { duration: 1500 });
      return;
    }
    setEmailError('');
    if (!isValidPhone(form.candidate_phone)) {
      setPhoneError('Enter a valid phone number: XXXXXXXXXX, (XXX) XXX-XXXX, or XXX-XXX-XXXX.');
      toast.error('Enter a valid phone number.', { duration: 1500 });
      return;
    }
    setPhoneError('');
    if (!form.accommodation_request_text.trim()) {
      setError('Please describe the accommodation you need.');
      return;
    }
    if (!roleToken) {
      setError('Missing role link. Please use the correct interview URL.');
      return;
    }

    setSubmitting(true);
    try {
      const body = new FormData();
      body.append('candidate_name', form.candidate_name.trim());
      body.append('candidate_email', form.candidate_email.trim());
      body.append('candidate_phone', String(form.candidate_phone || '').replace(/\D/g, ''));
      body.append('accommodation_request_text', form.accommodation_request_text.trim());
      body.append('role_token', roleToken);
      if (form.resume) body.append('resume', form.resume);

      const resp = await fetch(joinUrl(BK, '/api/accommodations/request'), {
        method: 'POST',
        body,
      });
      const data = await resp.json();
      if (!resp.ok) {
        if (data?.code === 'duplicate_candidate') {
          setError("Our records show you’ve already completed an interview for this role.");
        } else {
          setError(data?.error || 'Something went wrong.');
        }
        return;
      }
      setSubmitted(true);
      toast.success('Request submitted', { duration: 1200 });
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="alpha-theme alpha-page interview-access-page">
      {header}
      <div className="alpha-form">
        <div className="alpha-card" style={{ padding: 20 }}>
          <h2 className="text-xl font-semibold mb-2">Accommodation Request</h2>
          <p className="muted" style={{ marginBottom: 16 }}>
            We will respond within 48 business hours.
          </p>

          {submitted ? (
            <div className="text-green-300 text-sm">
              Thank you. Your accommodation request has been received.
            </div>
          ) : (
            <form onSubmit={onSubmit} className="alpha-form-grid accommodation-form-grid gap-y-4">
              <div className="accommodation-col-left">
                <label className="alpha-label">Full name <span className="required-asterisk">*</span></label>
                <input
                  type="text"
                  name="candidate_name"
                  value={form.candidate_name}
                  onChange={onChange}
                  required
                  className="alpha-input w-full"
                  disabled={submitting}
                />
                <div className="required-note">Required</div>
              </div>
              <div>
                <label className="alpha-label">Email <span className="required-asterisk">*</span></label>
                <input
                  type="email"
                  name="candidate_email"
                  value={form.candidate_email}
                  onChange={onChange}
                  onBlur={() => setEmailError(isValidEmail(form.candidate_email) ? '' : (form.candidate_email ? 'Please enter a valid email address.' : ''))}
                  required
                  placeholder="e.g. name@example.com"
                  className={`alpha-input w-full ${emailError ? 'input-error' : ''}`}
                  disabled={submitting}
                />
                {emailError && <div className="input-error-text">{emailError}</div>}
                <div className="required-note">Required</div>
              </div>
              <div className="accommodation-col-left">
                <label className="alpha-label">Phone <span className="required-asterisk">*</span></label>
                <input
                  type="tel"
                  name="candidate_phone"
                  value={form.candidate_phone}
                  onChange={onChange}
                  placeholder="e.g. (555) 123-4567 or 555-123-4567"
                  className={`alpha-input w-full ${phoneError ? 'input-error' : ''}`}
                  required
                  inputMode="tel"
                  autoComplete="tel"
                  disabled={submitting}
                  onBlur={() => setPhoneError(form.candidate_phone ? (isValidPhone(form.candidate_phone) ? '' : 'Enter a valid phone number: XXXXXXXXXX, (XXX) XXX-XXXX, or XXX-XXX-XXXX.') : '')}
                />
                {phoneError && <div className="input-error-text">{phoneError}</div>}
                <div className="required-note">Required</div>
              </div>
              <div className="alpha-col-span-2">
                <label className="alpha-label">Accommodation request <span className="required-asterisk">*</span></label>
                <textarea
                  name="accommodation_request_text"
                  value={form.accommodation_request_text}
                  onChange={onChange}
                  rows={5}
                  required
                  className="alpha-input w-full"
                  disabled={submitting}
                />
                <div className="required-note">Required</div>
              </div>

              <div className="accommodation-resume">
                <label className="alpha-label">Resume (optional)</label>
                <div className="client-dash-file-wrapper interview-resume-wrapper">
                  <CustomFilePicker
                    accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    onFileSelected={onResumeSelected}
                    label="Drag resume here or click to browse"
                    className="client-dash-dropzone client-dash-input client-dash-file-input"
                    inputRef={fileInputRef}
                  />
                </div>
                {form.resume && <div className="mt-1 text-xs opacity-80">{form.resume.name}</div>}
              </div>

              <div className="interview-submit-wrapper accommodation-submit">
                <button type="submit" disabled={submitting} className="btn-lg">
                  {submitting ? 'Submitting…' : 'Submit Request'}
                </button>
              </div>

              {error && <div className="alpha-col-span-2 text-red-300 text-sm">{error}</div>}
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
