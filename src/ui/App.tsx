import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import VideoList from './pages/VideoList';
import VideoCreator from './pages/VideoCreator';
import VideoDetails from './pages/VideoDetails';
import Layout from './components/Layout';
import DashboardHome from './pages/DashboardHome';
import JobsPage from './pages/JobsPage';
import JobDetails from './pages/JobDetails';
import SystemPage from './pages/SystemPage';
import ProvidersPage from './pages/ProvidersPage';
import BrandsPage from './pages/BrandsPage';
import TemplatesPage from './pages/TemplatesPage';
import SettingsPage from './pages/SettingsPage';
import PublishingPage from './pages/PublishingPage';
import SetupWizard from './pages/SetupWizard';
import LoginPage from './pages/LoginPage';

const App: React.FC = () => {
  return (
    <Router>
      <Layout>
        <Routes>
          <Route path="/" element={<DashboardHome />} />
          <Route path="/create" element={<VideoCreator />} />
          <Route path="/jobs" element={<JobsPage />} />
          <Route path="/jobs/:jobId" element={<JobDetails />} />
          <Route path="/videos" element={<VideoList />} />
          <Route path="/video/:videoId" element={<VideoDetails />} />
          <Route path="/publishing" element={<PublishingPage />} />
          <Route path="/brands" element={<BrandsPage />} />
          <Route path="/templates" element={<TemplatesPage />} />
          <Route path="/providers" element={<ProvidersPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/system" element={<SystemPage />} />
          <Route path="/setup" element={<SetupWizard />} />
          <Route path="/login" element={<LoginPage />} />
        </Routes>
      </Layout>
    </Router>
  );
};

export default App;
