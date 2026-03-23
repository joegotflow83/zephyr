import React, { useState, useEffect } from 'react';
import { useSettings } from '../../hooks/useSettings';
import type { AppSettings } from '../../../shared/models';
import { version } from '../../../../package.json';

/**
 * GeneralSection component for Settings tab
 *
 * Displays:
 * - Notifications toggle
 * - Log level dropdown (DEBUG, INFO, WARNING, ERROR)
 * - Theme selector (system, light, dark)
 * - App version display
 *
 * Changes are debounced and saved via window.api.settings.save()
 */
export const GeneralSection: React.FC = () => {
  const { settings, update } = useSettings();
  const [notificationsEnabled, setNotificationsEnabled] = useState(
    settings?.notification_enabled ?? true
  );
  const [logLevel, setLogLevel] = useState<AppSettings['log_level']>(
    settings?.log_level ?? 'INFO'
  );
  const [theme, setTheme] = useState<AppSettings['theme']>(
    settings?.theme ?? 'system'
  );
  const [isSaving, setIsSaving] = useState(false);

  // Sync with settings when they change
  useEffect(() => {
    if (settings) {
      setNotificationsEnabled(settings.notification_enabled);
      setLogLevel(settings.log_level);
      setTheme(settings.theme);
    }
  }, [settings]);

  // Debounced save handler for notifications
  useEffect(() => {
    if (settings && notificationsEnabled !== settings.notification_enabled) {
      setIsSaving(true);
      const timer = setTimeout(() => {
        update({ notification_enabled: notificationsEnabled })
          .catch((err) => {
            console.error('Failed to save notifications setting:', err);
          })
          .finally(() => {
            setIsSaving(false);
          });
      }, 500);

      return () => clearTimeout(timer);
    }
  }, [notificationsEnabled, settings, update]);

  // Debounced save handler for log level
  useEffect(() => {
    if (settings && logLevel !== settings.log_level) {
      setIsSaving(true);
      const timer = setTimeout(() => {
        update({ log_level: logLevel })
          .catch((err) => {
            console.error('Failed to save log level setting:', err);
          })
          .finally(() => {
            setIsSaving(false);
          });
      }, 500);

      return () => clearTimeout(timer);
    }
  }, [logLevel, settings, update]);

  // Debounced save handler for theme
  useEffect(() => {
    if (settings && theme !== settings.theme) {
      setIsSaving(true);
      const timer = setTimeout(() => {
        update({ theme: theme })
          .catch((err) => {
            console.error('Failed to save theme setting:', err);
          })
          .finally(() => {
            setIsSaving(false);
          });
      }, 500);

      return () => clearTimeout(timer);
    }
  }, [theme, settings, update]);

  const handleNotificationsToggle = () => {
    setNotificationsEnabled(!notificationsEnabled);
  };

  const handleLogLevelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setLogLevel(e.target.value as AppSettings['log_level']);
  };

  const handleThemeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setTheme(e.target.value as AppSettings['theme']);
  };

  const appVersion = version;

  return (
    <div className="space-y-6">
      {/* Notifications Toggle */}
      <div className="flex items-center justify-between">
        <div>
          <label
            htmlFor="notifications-toggle"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            Desktop Notifications
          </label>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Show OS-native notifications for loop events and errors
          </p>
        </div>
        <button
          id="notifications-toggle"
          type="button"
          role="switch"
          aria-checked={notificationsEnabled}
          onClick={handleNotificationsToggle}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-800 ${
            notificationsEnabled ? 'bg-blue-600' : 'bg-gray-600'
          }`}
          data-testid="notifications-toggle"
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              notificationsEnabled ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {/* Log Level Dropdown */}
      <div>
        <label
          htmlFor="log-level"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
        >
          Log Level
        </label>
        <select
          id="log-level"
          value={logLevel}
          onChange={handleLogLevelChange}
          className="w-full px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          data-testid="log-level-select"
        >
          <option value="DEBUG">DEBUG - Detailed debugging information</option>
          <option value="INFO">INFO - General informational messages</option>
          <option value="WARNING">WARNING - Warning messages only</option>
          <option value="ERROR">ERROR - Error messages only</option>
        </select>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          Controls verbosity of application logs
        </p>
      </div>

      {/* Theme Selector */}
      <div>
        <label
          htmlFor="theme"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
        >
          Theme
        </label>
        <select
          id="theme"
          value={theme}
          onChange={handleThemeChange}
          className="w-full px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          data-testid="theme-select"
        >
          <option value="system">System - Follow OS preference</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          UI color theme preference (system follows OS setting)
        </p>
      </div>

      {/* Saving Indicator */}
      {isSaving && (
        <div className="text-sm text-gray-500 dark:text-gray-400">Saving changes...</div>
      )}

      {/* App Version */}
      <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Application Version
        </label>
        <div className="text-gray-800 dark:text-gray-200" data-testid="app-version">
          Zephyr Desktop v{appVersion}
        </div>
      </div>
    </div>
  );
};
