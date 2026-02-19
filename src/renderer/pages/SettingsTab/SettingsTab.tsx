import React, { useState, useEffect } from 'react';
import { useSettings } from '../../hooks/useSettings';
import { CredentialsSection } from './CredentialsSection';

interface SettingsSectionProps {
  title: string;
  description?: string;
  defaultExpanded?: boolean;
  children: React.ReactNode;
}

/**
 * Collapsible card section for settings categories
 */
const SettingsSection: React.FC<SettingsSectionProps> = ({
  title,
  description,
  defaultExpanded = false,
  children,
}) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
      {/* Section Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-750 transition-colors"
        aria-expanded={isExpanded}
      >
        <div className="text-left">
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          {description && (
            <p className="text-sm text-gray-400 mt-1">{description}</p>
          )}
        </div>
        <svg
          className={`w-5 h-5 text-gray-400 transition-transform ${
            isExpanded ? 'rotate-180' : ''
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {/* Section Content */}
      {isExpanded && (
        <div className="px-6 py-4 border-t border-gray-700">{children}</div>
      )}
    </div>
  );
};

/**
 * Main Settings page component
 *
 * Provides a sectioned settings interface with collapsible cards for:
 * - Credentials (API keys, login sessions)
 * - Docker (connection, container limits)
 * - General (notifications, logging, theme)
 * - Updates (version checking, self-update)
 */
export const SettingsTab: React.FC = () => {
  const { settings, loading, error, refresh } = useSettings();

  // Load settings on mount
  useEffect(() => {
    refresh();
  }, [refresh]);

  if (loading && !settings) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-400">Loading settings...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-red-400">Error loading settings: {error}</div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto p-6 space-y-4">
        {/* Page Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-white mb-2">Settings</h1>
          <p className="text-gray-400">
            Configure credentials, Docker, application preferences, and updates
          </p>
        </div>

        {/* Credentials Section */}
        <SettingsSection
          title="Credentials"
          description="Manage API keys and login sessions for AI services"
          defaultExpanded={true}
        >
          <CredentialsSection />
        </SettingsSection>

        {/* Docker Section */}
        <SettingsSection
          title="Docker"
          description="Configure Docker connection and container settings"
        >
          <div className="text-gray-400">
            <p>Docker settings coming soon...</p>
            <p className="text-sm mt-2">
              Will show: connection status, max concurrent containers, Docker
              daemon info.
            </p>
          </div>
        </SettingsSection>

        {/* General Section */}
        <SettingsSection
          title="General"
          description="Application preferences and appearance"
        >
          <div className="text-gray-400">
            <p>General settings coming soon...</p>
            {settings && (
              <div className="mt-2 space-y-1 text-sm">
                <p>Current theme: {settings.theme}</p>
                <p>Log level: {settings.log_level}</p>
                <p>
                  Notifications:{' '}
                  {settings.notification_enabled ? 'enabled' : 'disabled'}
                </p>
              </div>
            )}
          </div>
        </SettingsSection>

        {/* Updates Section */}
        <SettingsSection
          title="Updates"
          description="Check for and install application updates"
        >
          <div className="text-gray-400">
            <p>Update management coming soon...</p>
            <p className="text-sm mt-2">
              Will support: version checking, self-update with progress display.
            </p>
          </div>
        </SettingsSection>
      </div>
    </div>
  );
};
