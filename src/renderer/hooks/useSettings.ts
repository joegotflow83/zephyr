/**
 * Convenience hook for accessing app settings from the global store.
 *
 * Provides current settings and the ability to update them.
 * Changes are automatically persisted to disk and synced across the app.
 */

import { useAppStore } from '../stores/app-store';
import type { AppSettings } from '../../shared/models';

export interface UseSettingsResult {
  settings: AppSettings | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  update: (updates: Partial<AppSettings>) => Promise<void>;
}

/**
 * Hook that provides app settings and update functionality.
 * All changes are persisted via IPC and update the global store.
 */
export function useSettings(): UseSettingsResult {
  const settings = useAppStore((state) => state.settings);
  const loading = useAppStore((state) => state.settingsLoading);
  const error = useAppStore((state) => state.settingsError);
  const refresh = useAppStore((state) => state.refreshSettings);
  const update = useAppStore((state) => state.updateSettings);

  return {
    settings,
    loading,
    error,
    refresh,
    update,
  };
}
