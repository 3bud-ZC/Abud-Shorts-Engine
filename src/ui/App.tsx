import React from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import VideoList from "./pages/VideoList";
import VideoCreator from "./pages/VideoCreator";
import VideoDetails from "./pages/VideoDetails";
import Layout from "./components/Layout";
import DashboardHome from "./pages/DashboardHome";
import JobsPage from "./pages/JobsPage";
import JobDetails from "./pages/JobDetails";
import SystemPage from "./pages/SystemPage";
import ProvidersPage from "./pages/ProvidersPage";
import BrandsPage from "./pages/BrandsPage";
import TemplatesPage from "./pages/TemplatesPage";
import SettingsPage from "./pages/SettingsPage";
import PublishingPage from "./pages/PublishingPage";
import SetupWizard from "./pages/SetupWizard";
import LoginPage from "./pages/LoginPage";
import { ErrorBoundary } from "./components/v2";

import { Navigate, useLocation } from "react-router-dom";
import { getSessionToken } from "./utils/auth";

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const token = getSessionToken();
  const location = useLocation();

  if (!token) {
    try {
      localStorage.setItem("abud_auth_return_to", `${location.pathname}${location.search}`);
    } catch {
      // Ignore storage errors
    }
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

const App: React.FC = () => {
  return (
    <Router>
      <Layout>
        <ErrorBoundary>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/setup" element={<SetupWizard />} />

            <Route path="/" element={<ProtectedRoute><DashboardHome /></ProtectedRoute>} />
            <Route path="/create" element={<ProtectedRoute><VideoCreator /></ProtectedRoute>} />
            <Route path="/jobs" element={<ProtectedRoute><JobsPage /></ProtectedRoute>} />
            <Route path="/jobs/:jobId" element={<ProtectedRoute><JobDetails /></ProtectedRoute>} />
            <Route path="/jobs/:id" element={<ProtectedRoute><JobDetails /></ProtectedRoute>} />
            <Route path="/videos" element={<ProtectedRoute><VideoList /></ProtectedRoute>} />
            <Route path="/video/:videoId" element={<ProtectedRoute><VideoDetails /></ProtectedRoute>} />
            <Route path="/publishing" element={<ProtectedRoute><PublishingPage /></ProtectedRoute>} />
            <Route path="/brands" element={<ProtectedRoute><BrandsPage /></ProtectedRoute>} />
            <Route path="/templates" element={<ProtectedRoute><TemplatesPage /></ProtectedRoute>} />
            <Route path="/providers" element={<ProtectedRoute><ProvidersPage /></ProtectedRoute>} />
            <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
            <Route path="/system" element={<ProtectedRoute><SystemPage /></ProtectedRoute>} />
          </Routes>
        </ErrorBoundary>
      </Layout>
    </Router>
  );
};

export default App;
