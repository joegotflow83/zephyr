import React, { useState, useEffect } from 'react';
import { Layout } from './components/Layout/Layout';
import { TabBar, TabId, Tab } from './components/TabBar/TabBar';
import { ProjectsTab } from './pages/ProjectsTab/ProjectsTab';
import { LoopsTab } from './pages/LoopsTab/LoopsTab';
import { TerminalTab } from './pages/TerminalTab/TerminalTab';
import { SettingsTab } from './pages/SettingsTab/SettingsTab';

const tabs: Tab[] = [
  { id: 'projects', label: 'Projects', icon: '📁' },
  { id: 'loops', label: 'Running Loops', icon: '🔄' },
  { id: 'terminal', label: 'Terminal', icon: '💻' },
  { id: 'settings', label: 'Settings', icon: '⚙️' },
];

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabId>('projects');

  // Keyboard shortcuts: Ctrl+1/2/3/4 for tab switching
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key >= '1' && e.key <= '4') {
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

  const renderActiveTab = () => {
    switch (activeTab) {
      case 'projects':
        return <ProjectsTab />;
      case 'loops':
        return <LoopsTab />;
      case 'terminal':
        return <TerminalTab />;
      case 'settings':
        return <SettingsTab />;
      default:
        return <ProjectsTab />;
    }
  };

  return (
    <Layout header={<TabBar tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />}>
      {renderActiveTab()}
    </Layout>
  );
};

export default App;
