import React from 'react';

const safeNumber = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);

function MetricCard({ label, value, meta, accent = 'sky' }) {
  return (
    <article className={`refresh-metric-card refresh-accent-${accent}`}>
      <div className="refresh-eyebrow">{label}</div>
      <strong>{value}</strong>
      <span>{meta}</span>
    </article>
  );
}

function EmptyOverview({ children }) {
  return <div className="refresh-overview-empty">{children}</div>;
}

export function ClientOverview({
  clientName,
  roles = [],
  candidates = [],
  canManage,
  isComplete,
  onNavigate,
}) {
  const completed = candidates.filter((row) => (typeof isComplete === 'function' ? isComplete(row) : false)).length;
  const completionRate = candidates.length ? Math.round((completed / candidates.length) * 100) : 0;
  const averagePerRole = roles.length ? (candidates.length / roles.length).toFixed(1) : '0.0';
  const recentCandidates = candidates.slice(0, 4);
  const recentRoles = roles.slice(0, 3);

  return (
    <section className="refresh-overview" aria-labelledby="client-overview-title">
      <header className="refresh-overview-heading">
        <div>
          <div className="refresh-kicker">Hiring overview</div>
          <h1 id="client-overview-title">Overview</h1>
          <p>See roles, candidate activity, and the work that needs attention for {clientName || 'your selected client'}.</p>
        </div>
        {canManage && (
          <button type="button" className="refresh-primary-button" onClick={() => onNavigate('roles')}>
            Create role
          </button>
        )}
      </header>

      <div className="refresh-metric-grid refresh-metric-grid--client">
        <MetricCard label="Roles created" value={roles.length} meta="Current client" accent="lavender" />
        <MetricCard label="Candidates screened" value={candidates.length} meta="Current client" />
        <MetricCard label="Avg candidates / role" value={averagePerRole} meta="Current client" accent="mint" />
        <MetricCard label="Screens completed" value={completed} meta={`${completionRate}% of candidate screens`} />
      </div>

      <div className="refresh-overview-pulse-grid">
        <article className="refresh-next-action">
          <div className="refresh-kicker">Next best action</div>
          <h2>{candidates.length ? `Review ${candidates.length} candidate${candidates.length === 1 ? '' : 's'}` : 'Create your first hiring role'}</h2>
          <p>{candidates.length ? 'Open candidate results, reports, transcripts, and supporting evidence.' : 'Start with a role and job description to begin screening.'}</p>
          <button type="button" onClick={() => onNavigate(candidates.length ? 'candidates' : 'roles')}>
            {candidates.length ? 'Review candidates' : 'Create role'}
          </button>
        </article>

        <article className="refresh-pipeline-card">
          <div className="refresh-eyebrow">Pipeline pulse</div>
          <strong>{completionRate}% complete</strong>
          <div className="refresh-progress" aria-label={`${completionRate}% of candidate screens completed`}>
            <span style={{ width: `${completionRate}%` }} />
          </div>
          <p>{completed} of {candidates.length} candidate screens completed</p>
        </article>
      </div>

      <div className="refresh-overview-content-grid">
        <article className="refresh-overview-card">
          <header>
            <h2>Recent candidates</h2>
            <p>Latest screening activity across your selected client.</p>
          </header>
          {recentCandidates.length ? (
            <div className="refresh-candidate-list">
              {recentCandidates.map((row) => {
                const score = safeNumber(row?.overall_score);
                const complete = typeof isComplete === 'function' ? isComplete(row) : false;
                return (
                  <button key={row?.id || `${row?.candidate?.name}-${row?.created_at}`} type="button" onClick={() => onNavigate('candidates')} className="refresh-candidate-row">
                    <span><strong>{row?.candidate?.name || 'Candidate'}</strong><small>{row?.role?.title || row?.role_name || 'Role not assigned'}</small></span>
                    <b>{score === null ? '—' : Math.round(score)}</b>
                    <em className={complete ? 'is-complete' : ''}>{complete ? 'Completed' : 'Needs review'}</em>
                  </button>
                );
              })}
            </div>
          ) : (
            <EmptyOverview>No candidate screens yet.</EmptyOverview>
          )}
          <button type="button" className="refresh-text-link" onClick={() => onNavigate('candidates')}>View all candidates →</button>
        </article>

        <article className="refresh-overview-card">
          <header>
            <h2>Recent roles</h2>
            <p>Role activity for your selected client.</p>
          </header>
          {recentRoles.length ? (
            <div className="refresh-role-list">
              {recentRoles.map((role) => (
                <button key={role?.id || role?.title} type="button" onClick={() => onNavigate('roles')}>
                  <strong>{role?.title || 'Untitled role'}</strong>
                  <span>{role?.interview_type || role?.interviewType || 'Interview role'}</span>
                </button>
              ))}
            </div>
          ) : (
            <EmptyOverview>No roles created yet.</EmptyOverview>
          )}
          <button type="button" className="refresh-text-link" onClick={() => onNavigate('roles')}>Manage roles →</button>
        </article>
      </div>
    </section>
  );
}

export function AdminOverview({ clients = [], roles = [], members = [], onNavigate }) {
  const activeClients = clients.filter((client) => {
    const subscription = String(client?.subscription_status || '').toLowerCase();
    return client?.manual_active_override === true || subscription === 'active' || subscription === 'trialing';
  }).length;
  const inactiveClients = Math.max(0, clients.length - activeClients);
  const cancelingClients = clients.filter((client) => client?.cancel_at_term_end === true).length;
  const recentClients = clients.slice(0, 4);

  return (
    <section className="refresh-overview" aria-labelledby="admin-overview-title">
      <header className="refresh-overview-heading">
        <div>
          <div className="refresh-kicker">Platform overview</div>
          <h1 id="admin-overview-title">Admin overview</h1>
          <p>Monitor client activity and move directly into the existing administrative workflows.</p>
        </div>
      </header>

      <div className="refresh-metric-grid refresh-metric-grid--admin">
        <MetricCard label="Client accounts" value={clients.length} meta={`${activeClients} currently active`} accent="lavender" />
        <MetricCard label="Roles" value={roles.length} meta="Across the selected scope" />
        <MetricCard label="Members" value={members.length} meta="Across the selected scope" accent="mint" />
        <MetricCard label="Inactive clients" value={inactiveClients} meta="Review access or billing" accent="info" />
        <MetricCard label="Canceling" value={cancelingClients} meta="Ending at term close" accent="warning" />
        <MetricCard label="Admin workflows" value="8" meta="Existing tools remain available" accent="lavender" />
      </div>

      <article className="refresh-admin-banner">
        <div>
          <div className="refresh-status-dot" />
          <span><strong>Admin workspace</strong><small>Access, role, billing, accommodation, and audit tools are available from the navigation.</small></span>
        </div>
        <button type="button" onClick={() => onNavigate('audit-logs')}>Open audit logs</button>
      </article>

      <div className="refresh-overview-content-grid refresh-overview-content-grid--admin">
        <article className="refresh-overview-card">
          <header>
            <h2>Client activity</h2>
            <p>Current client accounts and membership state.</p>
          </header>
          {recentClients.length ? (
            <div className="refresh-admin-client-list">
              {recentClients.map((client) => (
                <button key={client?.id || client?.name} type="button" onClick={() => onNavigate('clients')}>
                  <span className="refresh-client-initial">{String(client?.name || 'C').trim().slice(0, 1).toUpperCase()}</span>
                  <strong>{client?.name || 'Unnamed client'}</strong>
                  <small>{client?.plan_tier || 'No active plan'}</small>
                  <em>{client?.billing_status || client?.subscription_status || 'inactive'}</em>
                </button>
              ))}
            </div>
          ) : (
            <EmptyOverview>No client accounts are available.</EmptyOverview>
          )}
          <button type="button" className="refresh-text-link" onClick={() => onNavigate('clients')}>View all clients →</button>
        </article>

        <article className="refresh-overview-card">
          <header>
            <h2>Needs attention</h2>
            <p>Shortcuts into the current administrator queue.</p>
          </header>
          <div className="refresh-attention-list">
            <button type="button" onClick={() => onNavigate('clients')}><b>{inactiveClients}</b><span>Client access reviews</span></button>
            <button type="button" onClick={() => onNavigate('billing')}><b>{cancelingClients}</b><span>Memberships ending at term close</span></button>
            <button type="button" onClick={() => onNavigate('accommodations')}><b>—</b><span>Accommodation requests</span></button>
            <button type="button" onClick={() => onNavigate('audit-logs')}><b>→</b><span>Audit and reconciliation logs</span></button>
          </div>
        </article>
      </div>
    </section>
  );
}
