// src/pages/TextInterviewPage.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
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

export default function TextInterviewPage() {
  const params = useParams();
  const token = params?.token || params?.role_token || params?.id || '';
  const fileInputRef = useRef(null);

  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);
  const [resumeFile, setResumeFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [answers, setAnswers] = useState([]);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);

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

  const loadSession = async () => {
    if (!token) {
      setError('Missing interview link.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const resp = await fetch(joinUrl(BK, '/api/text-interview/session'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setError(data?.error || 'Could not load interview.');
        setSession(null);
        return;
      }
      setSession(data);
      setSubmitted(!!data?.completed);
      const nextAnswers = (data?.questions || []).map((q, idx) => ({
        index: idx + 1,
        question: q,
        answer: '',
      }));
      setAnswers(nextAnswers);
    } catch {
      setError('Network error loading interview.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSession();
  }, [token]);

  const onResumeSelected = (file) => {
    setResumeFile(file || null);
  };

  const uploadResume = async () => {
    if (!resumeFile) return;
    setUploading(true);
    setError('');
    try {
      const body = new FormData();
      body.append('token', token);
      body.append('resume', resumeFile);
      const resp = await fetch(joinUrl(BK, '/api/text-interview/resume'), {
        method: 'POST',
        body,
      });
      const data = await resp.json();
      if (!resp.ok) {
        setError(data?.error || 'Resume upload failed.');
        return;
      }
      toast.success('Resume received', { duration: 1200 });
      setResumeFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      await loadSession();
    } catch {
      setError('Network error uploading resume.');
    } finally {
      setUploading(false);
    }
  };

  const submitAnswers = async () => {
    setSubmitting(true);
    setError('');
    try {
      const payload = {
        token,
        answers: answers.map((a) => ({ question: a.question, answer: a.answer })),
      };
      const resp = await fetch(joinUrl(BK, '/api/text-interview/answers'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setError(data?.error || 'Submission failed.');
        return;
      }
      setSubmitted(true);
      toast.success('Interview submitted', { duration: 1200 });
    } catch {
      setError('Network error submitting answers.');
    } finally {
      setSubmitting(false);
    }
  };

  const resumeRequired = !!session?.resume_required;

  return (
    <div className="alpha-theme alpha-page interview-access-page">
      {header}
      <div className="alpha-form">
        <div className="alpha-card" style={{ padding: 20 }}>
          <h2 className="text-xl font-semibold mb-2">Text Interview</h2>
          {session?.role_title && (
            <div className="muted" style={{ marginBottom: 12 }}>
              Role: <strong>{session.role_title}</strong>
            </div>
          )}

          {loading && <div className="client-dash-muted">Loading interview…</div>}
          {!loading && error && <div className="text-red-300 text-sm">{error}</div>}

          {!loading && !error && resumeRequired && (
            <div>
              <p className="muted" style={{ marginBottom: 12 }}>
                Resume required. Please upload your resume to continue.
              </p>
              <div className="client-dash-file-wrapper interview-resume-wrapper">
                <CustomFilePicker
                  accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  onFileSelected={onResumeSelected}
                  label="Drag resume here or click to browse"
                  className="client-dash-dropzone client-dash-input client-dash-file-input"
                  inputRef={fileInputRef}
                />
              </div>
              {resumeFile && <div className="mt-1 text-xs opacity-80">{resumeFile.name}</div>}
              <div style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className="btn-lg"
                  disabled={!resumeFile || uploading}
                  onClick={uploadResume}
                >
                  {uploading ? 'Uploading…' : 'Upload Resume'}
                </button>
              </div>
            </div>
          )}

          {!loading && !error && !resumeRequired && (
            <>
              {submitted ? (
                <div className="text-green-300 text-sm">
                  Interview submitted. Completed via accommodation pathway (text).
                </div>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    submitAnswers();
                  }}
                  className="alpha-form-grid gap-y-4"
                >
                  {(answers || []).map((item, idx) => (
                    <div key={item.index} className="alpha-col-span-2">
                      <label className="alpha-label">
                        {idx + 1}. {item.question}
                      </label>
                      <textarea
                        className="alpha-input w-full"
                        rows={4}
                        value={item.answer}
                        onChange={(e) => {
                          const next = [...answers];
                          next[idx] = { ...next[idx], answer: e.target.value };
                          setAnswers(next);
                        }}
                        required
                      />
                    </div>
                  ))}
                  <div className="interview-submit-wrapper">
                    <button type="submit" className="btn-lg" disabled={submitting}>
                      {submitting ? 'Submitting…' : 'Submit Interview'}
                    </button>
                  </div>
                </form>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
