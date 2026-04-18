import React, { useState } from 'react';

/**
 * Service type for credential management
 */
export type CredentialService = 'anthropic' | 'github' | 'gitlab';

export interface CredentialDialogProps {
  /** The service to configure */
  service: CredentialService;
  /** Current masked API key (if any) */
  currentKey?: string | null;
  /** Called when user saves the API key */
  onSave: (key: string) => void;
  /** Called when user chooses browser login mode */
  onLoginMode?: () => void;
  /** Called when dialog should close */
  onClose: () => void;
}

/**
 * Display names for each service
 */
const SERVICE_NAMES: Record<CredentialService, string> = {
  anthropic: 'Anthropic',
  github: 'GitHub',
  gitlab: 'GitLab',
};

/**
 * Modal dialog for entering or updating API credentials
 *
 * Features:
 * - Password-masked input for API keys
 * - Validation for non-empty keys
 * - Keyboard shortcuts (Enter to save, Esc to cancel)
 */
export const CredentialDialog: React.FC<CredentialDialogProps> = ({
  service,
  currentKey,
  onSave,
  onLoginMode,
  onClose,
}) => {
  const [apiKey, setApiKey] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const serviceName = SERVICE_NAMES[service];

  const handleSave = () => {
    const trimmedKey = apiKey.trim();
    if (trimmedKey.length === 0) {
      return;
    }
    onSave(trimmedKey);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-gray-50 dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            Configure {serviceName} Credentials
          </h2>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-4">
          {/* Current Key Display */}
          {currentKey && (
            <div className="text-sm">
              <span className="text-gray-500 dark:text-gray-400">Current key: </span>
              <span className="text-gray-700 dark:text-gray-300 font-mono">{currentKey}</span>
            </div>
          )}

          {/* API Key Input */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              API Key
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={`Enter your ${serviceName} API key`}
                className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                tabIndex={-1}
              >
                {showPassword ? (
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
                    />
                  </svg>
                ) : (
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                    />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* OR divider + browser login */}
        {onLoginMode && (
          <div className="px-6 pb-4 space-y-3">
            <div className="flex items-center">
              <div className="flex-1 border-t border-gray-200 dark:border-gray-700" />
              <span className="mx-3 text-xs text-gray-500 dark:text-gray-400">OR</span>
              <div className="flex-1 border-t border-gray-200 dark:border-gray-700" />
            </div>
            <div>
              <button
                type="button"
                onClick={onLoginMode}
                className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors text-sm"
              >
                Use Browser Login
              </button>
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                Login via browser to capture your session cookies and authenticate automatically.
              </p>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end space-x-3">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-900 dark:text-white rounded transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={apiKey.trim().length === 0}
            className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-100 dark:disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed text-white rounded transition-colors"
          >
            Save API Key
          </button>
        </div>
      </div>
    </div>
  );
};
