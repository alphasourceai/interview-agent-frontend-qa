import React from 'react';
import { Routes, Route } from 'react-router-dom';

import SignIn from './pages/SignIn';                  // ⬅ add
import InterviewAccessPage from './pages/InterviewAccessPage';
import AccommodationRequestPage from './pages/AccommodationRequestPage';
import TextInterviewPage from './pages/TextInterviewPage';
import VerifyOtp from './pages/VerifyOtp';
import ClientDashboard from './pages/ClientDashboard';
import RoleCreator from './pages/RoleCreator';
import RoleReports from './pages/RoleReports';
import RoleCandidates from './pages/RoleCandidates';
import AcceptInvite from './pages/AcceptInvite';

function InterviewComplete() {
  return (
    <div style={{ padding: 24, display: 'grid', placeItems: 'center' }}>
      <div style={{ maxWidth: 640, width: '100%', textAlign: 'center' }}>
        <h1 style={{ marginBottom: 12 }}>Interview complete</h1>
        <p style={{ marginBottom: 18 }}>
          Thank you for completing your interview. You may now close this window.
        </p>
        <a href="/interview-access" className="btn lilac">Back to interview page</a>
      </div>
    </div>
  );
}

function App() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/signin" element={<SignIn />} />    {/* ⬅ add */}
      <Route path="/accept-invite" element={<AcceptInvite />} />
      <Route path="/interview-access/:role_token" element={<InterviewAccessPage />} />
      <Route path="/accommodation-request/:role_token" element={<AccommodationRequestPage />} />
      <Route path="/accommodation-request" element={<AccommodationRequestPage />} />
      <Route path="/text-interview/:token" element={<TextInterviewPage />} />
      <Route path="/verify-otp" element={<VerifyOtp />} />
      <Route path="/interview-complete" element={<InterviewComplete />} />

      {/* Legacy single-page dashboard & role views */}
      <Route path="/dashboard" element={<ClientDashboard />} />
      <Route path="/create-role" element={<RoleCreator />} />
      <Route path="/reports/:roleId" element={<RoleReports />} />
      <Route path="/candidates/:roleId" element={<RoleCandidates />} />
    </Routes>
  );
}

export default App;
