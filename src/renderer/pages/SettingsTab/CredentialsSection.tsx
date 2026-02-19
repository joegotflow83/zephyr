import React, { useState, useEffect } from 'react';
import {
  CredentialDialog,
  CredentialService,
} from '../../components/CredentialDialog/CredentialDialog';

/**
 * Service configuration metadata
 */
interface ServiceConfig {
  id: CredentialService;
  name: string;
  description: string;
  icon: string;
}

/**
 * Supported services for credential management
 */
const SERVICES: ServiceConfig[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    description: 'Claude API access',
    icon: '🤖',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'GPT API access',
    icon: '🧠',
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'Repository access',
    icon: '🐙',
  },
];

/**
 * Credentials management section for Settings tab
 *
 * Features:
 * - Lists all supported AI services (Anthropic, OpenAI, GitHub)
 * - Shows status for each service (key stored / not set)
 * - "Update Key" button per service opens CredentialDialog
 * - Supports both API key entry and browser-based login
 * - Real-time status updates after credential changes
 */
export const CredentialsSection: React.FC = () => {
  const [storedServices, setStoredServices] = useState<string[]>([]);
  const [maskedKeys, setMaskedKeys] = useState<
    Record<CredentialService, string | null>
  >({
    anthropic: null,
    openai: null,
    github: null,
  });
  const [selectedService, setSelectedService] =
    useState<CredentialService | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Load stored credentials on mount
   */
  useEffect(() => {
    loadCredentials();
  }, []);

  /**
   * Fetch list of services with stored credentials and their masked keys
   */
  const loadCredentials = async () => {
    try {
      setLoading(true);
      setError(null);

      // Get list of services with credentials
      const services = await window.api.credentials.list();
      setStoredServices(services);

      // Get masked keys for each service
      const keys: Record<CredentialService, string | null> = {
        anthropic: null,
        openai: null,
        github: null,
      };

      for (const service of SERVICES) {
        const maskedKey = await window.api.credentials.get(service.id);
        keys[service.id] = maskedKey;
      }

      setMaskedKeys(keys);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load credentials');
    } finally {
      setLoading(false);
    }
  };

  /**
   * Handle saving an API key
   */
  const handleSaveKey = async (service: CredentialService, key: string) => {
    try {
      setError(null);
      await window.api.credentials.store(service, key);
      setSelectedService(null);
      await loadCredentials();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to store credential');
    }
  };

  /**
   * Handle browser-based login
   */
  const handleLoginMode = async (service: CredentialService) => {
    try {
      setError(null);
      setSelectedService(null);

      const result = await window.api.credentials.login(service);

      if (result.success) {
        await loadCredentials();
      } else {
        setError(result.error || 'Login failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    }
  };

  /**
   * Handle deleting a credential
   */
  const handleDelete = async (service: CredentialService) => {
    try {
      setError(null);
      await window.api.credentials.delete(service);
      await loadCredentials();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete credential');
    }
  };

  if (loading && storedServices.length === 0) {
    return (
      <div className="text-gray-400 text-center py-4">
        Loading credentials...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Error Display */}
      {error && (
        <div className="bg-red-900 bg-opacity-30 border border-red-700 rounded px-4 py-3 text-red-200">
          {error}
        </div>
      )}

      {/* Description */}
      <p className="text-sm text-gray-400">
        Store API keys or use browser login to authenticate with AI services.
        Credentials are encrypted and stored securely.
      </p>

      {/* Service List */}
      <div className="space-y-3">
        {SERVICES.map((service) => {
          const hasCredential = storedServices.includes(service.id);
          const maskedKey = maskedKeys[service.id];

          return (
            <div
              key={service.id}
              className="bg-gray-900 rounded-lg border border-gray-700 p-4 flex items-center justify-between"
            >
              {/* Service Info */}
              <div className="flex items-center space-x-3 flex-1">
                <span className="text-2xl">{service.icon}</span>
                <div>
                  <h3 className="text-white font-medium">{service.name}</h3>
                  <p className="text-sm text-gray-400">{service.description}</p>
                  {maskedKey && (
                    <p className="text-xs text-gray-500 font-mono mt-1">
                      {maskedKey}
                    </p>
                  )}
                </div>
              </div>

              {/* Status Badge */}
              <div className="flex items-center space-x-3">
                <span
                  className={`px-3 py-1 rounded text-xs font-medium ${
                    hasCredential
                      ? 'bg-green-900 bg-opacity-30 text-green-400 border border-green-700'
                      : 'bg-gray-700 text-gray-400'
                  }`}
                >
                  {hasCredential ? 'Configured' : 'Not Set'}
                </span>

                {/* Action Buttons */}
                <button
                  onClick={() => setSelectedService(service.id)}
                  className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded transition-colors"
                >
                  {hasCredential ? 'Update' : 'Configure'}
                </button>

                {hasCredential && (
                  <button
                    onClick={() => handleDelete(service.id)}
                    className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-sm rounded transition-colors"
                    title="Delete credential"
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Credential Dialog */}
      {selectedService && (
        <CredentialDialog
          service={selectedService}
          currentKey={maskedKeys[selectedService]}
          onSave={(key) => handleSaveKey(selectedService, key)}
          onLoginMode={() => handleLoginMode(selectedService)}
          onClose={() => setSelectedService(null)}
        />
      )}
    </div>
  );
};
