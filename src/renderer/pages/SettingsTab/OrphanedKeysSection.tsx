import React, { useState, useEffect, useCallback } from 'react';
import type { DeployKeyRecord } from '../../../services/deploy-key-store';

/**
 * Displays a table of orphaned GitHub deploy keys — keys that were registered
 * during a loop run but never removed (e.g. because the app crashed or was
 * force-quit). Users are prompted to delete these keys manually from GitHub.
 *
 * Renders nothing when there are no orphaned keys.
 */
export const OrphanedKeysSection: React.FC = () => {
  const [keys, setKeys] = useState<DeployKeyRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchKeys = useCallback(async () => {
    setLoading(true);
    try {
      const orphaned = await window.api.deployKeys.listOrphaned();
      setKeys(orphaned);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const handleViewOnService = async (repo: string, service?: 'github' | 'gitlab') => {
    const url = await window.api.deployKeys.getUrl(repo, service);
    await window.api.shell.openExternal(url);
  };

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  };

  if (loading) {
    return <div className="text-sm text-gray-500 dark:text-gray-400">Checking for orphaned keys...</div>;
  }

  if (keys.length === 0) {
    return <div className="text-sm text-gray-500 dark:text-gray-400">No orphaned deploy keys found.</div>;
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-yellow-400">
        The following deploy keys were registered on GitHub or GitLab but were never removed
        — likely because the app crashed or was force-quit. Please delete them manually from
        the respective service to keep your repositories secure.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
              <th className="pb-2 pr-4 font-medium">Project</th>
              <th className="pb-2 pr-4 font-medium">Repository</th>
              <th className="pb-2 pr-4 font-medium">Service</th>
              <th className="pb-2 pr-4 font-medium">Created</th>
              <th className="pb-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {keys.map((key) => (
              <tr key={`${key.repo}-${key.key_id}`} className="border-b border-gray-200/50 dark:border-gray-700/50">
                <td className="py-2 pr-4 text-gray-900 dark:text-white">{key.project_name}</td>
                <td className="py-2 pr-4 text-gray-700 dark:text-gray-300 font-mono text-xs">{key.repo}</td>
                <td className="py-2 pr-4 text-gray-500 dark:text-gray-400 capitalize">{key.service ?? 'github'}</td>
                <td className="py-2 pr-4 text-gray-500 dark:text-gray-400">{formatDate(key.created_at)}</td>
                <td className="py-2">
                  <button
                    onClick={() => handleViewOnService(key.repo, key.service)}
                    className="px-3 py-1 text-xs bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-900 dark:text-white rounded border border-gray-200 dark:border-gray-600 transition-colors"
                  >
                    View on {key.service === 'gitlab' ? 'GitLab' : 'GitHub'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
