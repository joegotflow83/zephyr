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
import { useAppStore } from './stores/app-store';

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
  const settings = useAppStore((s) => s.settings);

  // Apply theme class to <html> element whenever settings.theme changes
  useEffect(() => {
    const theme = settings?.theme ?? 'system';
    const root = document.documentElement;

    const applyDark = (dark: boolean) => {
      root.classList.toggle('dark', dark);
    };

    if (theme === 'dark') {
      applyDark(true);
    } else if (theme === 'light') {
      applyDark(false);
    } else {
      // 'system' — follow OS preference
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      applyDark(mq.matches);
      const handler = (e: MediaQueryListEvent) => applyDark(e.matches);
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
  }, [settings?.theme]);

  // Factory startup toasts
  useEffect(() => {
    info('The factory is starting... you will see a message when fully up and running.', 10000);
    const cleanup = window.api.app.onReady(() => {
      success('The factory is up and running!', 10000);
    });
    return cleanup;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        <TerminalTab isActive={activeTab === 'terminal'} />
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
