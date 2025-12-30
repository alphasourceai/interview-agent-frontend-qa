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
  const chatEndRef = useRef(null);
  const answerInputRef = useRef(null);

  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);
  const [resumeFile, setResumeFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [answers, setAnswers] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [closeAttempted, setCloseAttempted] = useState(false);
  const [blocked, setBlocked] = useState(null);

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
        if (data?.code === 'duplicate_candidate') {
          setBlocked({
            message: data?.error || "Our records show you’ve already completed an interview for this role.",
          });
          setError('');
          setSession(null);
          return;
        }
        setError(data?.error || 'Could not load interview.');
        setSession(null);
        return;
      }
      setSession(data);
      setBlocked(null);
      setSubmitted(!!data?.completed);
      const nextAnswers = (data?.questions || []).map((q, idx) => ({
        index: idx + 1,
        question: q,
        answer: '',
      }));
      setAnswers(nextAnswers);
      setCurrentIndex(0);
    } catch {
      setError('Network error loading interview.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSession();
  }, [token]);

  const resumeRequired = !!session?.resume_required;
  const chatActive = !loading && !error && !blocked && !resumeRequired && !submitted;

  useEffect(() => {
    if (!chatActive) return;
    const raf = requestAnimationFrame(() => {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    });
    return () => cancelAnimationFrame(raf);
  }, [chatActive, currentIndex, answers.length]);

  useEffect(() => {
    if (!chatActive) return;
    const raf = requestAnimationFrame(() => {
      answerInputRef.current?.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [chatActive, currentIndex]);

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

  const current = answers[currentIndex] || null;
  const totalQuestions = answers.length || 0;

  const handleNext = () => {
    if (!current) return;
    if (!current.answer.trim()) {
      setError('Please enter your response before continuing.');
      return;
    }
    setError('');
    if (currentIndex < totalQuestions - 1) {
      setCurrentIndex((idx) => idx + 1);
    } else {
      submitAnswers();
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      setError('');
      setCurrentIndex((idx) => idx - 1);
    }
  };

  const handleClose = () => {
    setCloseAttempted(true);
    try {
      window.close();
    } catch {}
  };

  return (
    <div className="alpha-theme alpha-page interview-access-page">
      <div className="space-y-6">
        {header}
        <div className="alpha-hero fullbleed">
          <div className="tavus-stage text-interview-stage">
            <div className="tavus-slot text-interview-slot" aria-label="Text interview area">
              <div className="text-interview-shell">
                <div className="text-interview-title">
                  <h2 className="text-xl font-semibold">Text Interview</h2>
                  {session?.role_title && (
                    <div className="muted">
                      Role: <strong>{session.role_title}</strong>
                    </div>
                  )}
                </div>

                {loading && <div className="client-dash-muted">Loading interview…</div>}
                {!loading && error && <div className="text-red-300 text-sm">{error}</div>}

                {!loading && !error && blocked && (
                  <div>
                    <div className="text-yellow-200 text-sm" style={{ marginBottom: 10 }}>
                      {blocked.message}
                    </div>
                    <div className="muted">
                      If you believe this is an error, please contact support at <strong>info@alphasourceai.com</strong>.
                    </div>
                  </div>
                )}

                {!loading && !error && !blocked && resumeRequired && (
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

                {!loading && !error && !blocked && !resumeRequired && submitted && (
                  <div>
                    <div className="text-green-300 text-sm" style={{ marginBottom: 12 }}>
                      Thanks for completing your text interview. We’ve received your responses and will follow up soon.
                    </div>
                    <button type="button" className="btn-lg" onClick={handleClose}>
                      Close window
                    </button>
                    {closeAttempted && (
                      <div className="muted" style={{ marginTop: 10 }}>
                        If this window didn’t close automatically, you can safely close it now.
                      </div>
                    )}
                  </div>
                )}

                {!loading && !error && !blocked && !resumeRequired && !submitted && (
                  <div className="text-interview-chat text-interview-chat--full">
                    <div className="text-interview-progress">
                      Question {Math.min(currentIndex + 1, totalQuestions)} of {totalQuestions}
                    </div>
                    <div className="text-chat-window text-chat-window--full">
                      {(answers || []).slice(0, currentIndex).map((item) => (
                        <div key={item.index} className="text-chat-thread">
                          <div className="chat-bubble chat-question">
                            {item.index}. {item.question}
                          </div>
                          <div className="chat-bubble chat-answer">
                            {item.answer || ''}
                          </div>
                        </div>
                      ))}
                      {current && (
                        <div className="chat-bubble chat-question">
                          {current.index}. {current.question}
                        </div>
                      )}
                      <div ref={chatEndRef} />
                    </div>
                    <div className="text-chat-input">
                      <label className="alpha-label">Your response</label>
                      <textarea
                        ref={answerInputRef}
                        className="alpha-input w-full"
                        rows={4}
                        value={current?.answer || ''}
                        onChange={(e) => {
                          const next = [...answers];
                          next[currentIndex] = { ...next[currentIndex], answer: e.target.value };
                          setAnswers(next);
                        }}
                        required
                      />
                      <div className="text-chat-actions">
                        <button
                          type="button"
                          className="btn lilac client-dash-pill"
                          onClick={handlePrev}
                          disabled={currentIndex === 0}
                        >
                          Back
                        </button>
                        <button type="button" className="btn-lg" disabled={submitting} onClick={handleNext}>
                          {submitting ? 'Submitting…' : (currentIndex === totalQuestions - 1 ? 'Submit Interview' : 'Next')}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      <style>{`
        .text-interview-stage { width: 100%; }
        .text-interview-slot {
          position: relative;
          width: 100%;
          border-radius: 16px;
          border: 1px solid rgba(255,255,255,0.1);
          background: rgba(0,0,0,0.85);
          overflow: hidden;
          margin: 0 auto;
          max-width: 1200px;
        }
        @media (min-width: 768px) {
          .text-interview-slot { height: 520px; }
        }
        @media (max-width: 767px) {
          .text-interview-slot { aspect-ratio: 16 / 9; }
        }
        .text-interview-shell{
          display: flex;
          flex-direction: column;
          height: 100%;
          gap: 12px;
          padding: 24px;
          box-sizing: border-box;
        }
        .text-interview-title{
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .text-interview-chat.text-interview-chat--full{
          flex: 1;
          min-height: 0;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .text-chat-window.text-chat-window--full{
          flex: 1;
          min-height: 0;
          max-height: none;
        }
        @media (max-width: 640px) {
          .text-interview-shell{ padding: 16px; }
        }
      `}</style>
    </div>
  );
}
