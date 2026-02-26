import React, { useState, useEffect } from 'react';
import { Layout } from './components/Layout/Layout';
import { TabBar, TabId, Tab } from './components/TabBar/TabBar';
import { StatusBar } from './components/StatusBar/StatusBar';
import { Toast } from './components/Toast/Toast';
import { ProjectsTab } from './pages/ProjectsTab/ProjectsTab';
import { LoopsTab } from './pages/LoopsTab/LoopsTab';
import { TerminalTab } from './pages/TerminalTab/TerminalTab';
import { SettingsTab } from './pages/SettingsTab/SettingsTab';
import { ImagesTab } from './pages/ImagesTab/ImagesTab';
import { useActiveLoops } from './hooks/useActiveLoops';
import { useToast } from './hooks/useToast';

const tabs: Tab[] = [
  { id: 'projects', label: 'Projects', icon: '📁' },
  { id: 'loops', label: 'Running Loops', icon: '🔄' },
  { id: 'terminal', label: 'Terminal', icon: '💻' },
  { id: 'images', label: 'Images', icon: '🖼️' },
  { id: 'settings', label: 'Settings', icon: '⚙️' },
];

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabId>('projects');
  const activeLoopCount = useActiveLoops();
  const { toasts, dismissToast, success, error, warning, info } = useToast();

  // Keyboard shortcuts: Ctrl+1/2/3/4/5 for tab switching
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key >= '1' && e.key <= '5') {
        e.preventDefault();
        const tabIndex = parseInt(e.key, 10) - 1;
        const newTab = tabs[tabIndex];
        if (newTab) {
          setActiveTab(newTab.id);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const toastMethods = { success, error, warning, info };

  return (
    <Layout
      header={<TabBar tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />}
      statusBar={<StatusBar activeLoopCount={activeLoopCount} />}
    >
      <div style={{ display: activeTab === 'projects' ? undefined : 'none', height: '100%' }}>
        <ProjectsTab onRunProject={() => setActiveTab('loops')} toast={toastMethods} />
      </div>
      <div style={{ display: activeTab === 'loops' ? undefined : 'none', height: '100%' }}>
        <LoopsTab />
      </div>
      <div style={{ display: activeTab === 'terminal' ? undefined : 'none', height: '100%' }}>
        <TerminalTab />
      </div>
      <div style={{ display: activeTab === 'images' ? undefined : 'none', height: '100%' }}>
        <ImagesTab />
      </div>
      <div style={{ display: activeTab === 'settings' ? undefined : 'none', height: '100%' }}>
        <SettingsTab />
      </div>
      <Toast toasts={toasts} onDismiss={dismissToast} />
    </Layout>
  );
};

export default App;
