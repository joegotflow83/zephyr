import React from 'react';

export type TabId = 'projects' | 'loops' | 'terminal' | 'images' | 'settings';

export interface Tab {
  id: TabId;
  label: string;
  icon: string;
  badge?: number;
}

export interface TabBarProps {
  tabs: Tab[];
  activeTab: TabId;
  onTabChange: (tabId: TabId) => void;
}

export const TabBar: React.FC<TabBarProps> = ({ tabs, activeTab, onTabChange }) => {
  return (
    <div className="flex border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={`
            px-6 py-3 text-sm font-medium transition-colors relative
            ${
              activeTab === tab.id
                ? 'text-blue-500 dark:text-blue-400 border-b-2 border-blue-500 dark:border-blue-400 bg-gray-100 dark:bg-gray-800'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'
            }
          `}
          aria-current={activeTab === tab.id ? 'page' : undefined}
        >
          <span className="flex items-center gap-2">
            <span className="text-lg">{tab.icon}</span>
            <span>{tab.label}</span>
            {tab.badge !== undefined && tab.badge > 0 && (
              <span className="ml-1 px-2 py-0.5 text-xs bg-blue-600 text-white rounded-full">
                {tab.badge}
              </span>
            )}
          </span>
        </button>
      ))}
    </div>
  );
};
