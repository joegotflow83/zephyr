import React, { useState, useEffect, useCallback } from 'react';
import type { AnthropicAuthMethod, AppSettings } from '../../../shared/models';
import { CredentialDialog } from '../../components/CredentialDialog/CredentialDialog';
import { BedrockDialog } from '../../components/BedrockDialog/BedrockDialog';

/**
 * Credentials management section for the Settings tab.
 *
 * Section 1 — Anthropic API Access:
 *   Three selectable auth methods: API Key, Browser Session, AWS Bedrock.
 *   Selecting a method auto-saves anthropic_auth_method to settings.
 *
 * Section 2 — GitHub:
 *   Standard API key credential management.
 */
export const CredentialsSection: React.FC = () => {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [authStatus, setAuthStatus] = useState<{
    api_key: boolean;
    browser_session: boolean;
    aws_bedrock: boolean;
  }>({ api_key: false, browser_session: false, aws_bedrock: false });
  const [githubStored, setGithubStored] = useState(false);
  const [githubMaskedKey, setGithubMaskedKey] = useState<string | null>(null);
  const [gitlabStored, setGitlabStored] = useState(false);
  const [gitlabMaskedKey, setGitlabMaskedKey] = useState<string | null>(null);
  const [awsQStored, setAwsQStored] = useState(false);
  const [awsQMaskedKey, setAwsQMaskedKey] = useState<string | null>(null);
  const [awsKiroStored, setAwsKiroStored] = useState(false);
  const [awsKiroMaskedKey, setAwsKiroMaskedKey] = useState<string | null>(null);

  // Dialog visibility
  const [showApiKeyDialog, setShowApiKeyDialog] = useState(false);
  const [showBedrockDialog, setShowBedrockDialog] = useState(false);
  const [showGithubDialog, setShowGithubDialog] = useState(false);
  const [showGitlabDialog, setShowGitlabDialog] = useState(false);
  const [showAwsQDialog, setShowAwsQDialog] = useState(false);
  const [showAwsKiroDialog, setShowAwsKiroDialog] = useState(false);

  const [loginInProgress, setLoginInProgress] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadAll = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [loadedSettings, status, services] = await Promise.all([
        window.api.settings.load(),
        window.api.credentials.checkAuth(),
        window.api.credentials.list(),
      ]);
      setSettings(loadedSettings);
      setAuthStatus(status);
      setGithubStored(services.includes('github'));
      const githubKey = services.includes('github')
        ? await window.api.credentials.get('github')
        : null;
      setGithubMaskedKey(githubKey);
      setGitlabStored(services.includes('gitlab'));
      const gitlabKey = services.includes('gitlab')
        ? await window.api.credentials.get('gitlab')
        : null;
      setGitlabMaskedKey(gitlabKey);
      setAwsQStored(services.includes('aws_q_developer'));
      const awsQKey = services.includes('aws_q_developer')
        ? await window.api.credentials.get('aws_q_developer')
        : null;
      setAwsQMaskedKey(awsQKey);
      setAwsKiroStored(services.includes('aws_kiro'));
      const awsKiroKey = services.includes('aws_kiro')
        ? await window.api.credentials.get('aws_kiro')
        : null;
      setAwsKiroMaskedKey(awsKiroKey);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load credentials');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const saveAuthMethod = async (method: AnthropicAuthMethod) => {
    if (!settings) return;
    try {
      setError(null);
      const updated = { ...settings, anthropic_auth_method: method };
      await window.api.settings.save(updated);
      setSettings(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save auth method');
    }
  };

  const handleBrowserLogin = async () => {
    try {
      setLoginInProgress(true);
      setError(null);
      const result = await window.api.credentials.login('claude-code');
      if (result.success) {
        await loadAll();
      } else {
        setError(result.error ?? 'Login failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoginInProgress(false);
    }
  };

  const handleSaveApiKey = async (_service: string, key: string) => {
    await window.api.credentials.store('anthropic', key);
    setShowApiKeyDialog(false);
    await loadAll();
  };

  const handleSaveBedrockConfig = async (fields: {
    region: string;
    model: string;
    smallFastModel: string;
    log: string;
    bearerToken: string;
  }) => {
    if (!settings) return;
    // Save bearer token encrypted
    await window.api.credentials.store('anthropic_bedrock', fields.bearerToken);
    // Save non-sensitive fields in settings
    const updated: AppSettings = {
      ...settings,
      bedrock_region: fields.region || undefined,
      bedrock_model: fields.model || undefined,
      bedrock_small_fast_model: fields.smallFastModel || undefined,
      bedrock_log: fields.log || undefined,
    };
    await window.api.settings.save(updated);
    setSettings(updated);
    setShowBedrockDialog(false);
    await loadAll();
  };

  const handleSaveGithubKey = async (_service: string, key: string) => {
    await window.api.credentials.store('github', key);
    setShowGithubDialog(false);
    await loadAll();
  };

  const handleDeleteGithub = async () => {
    try {
      await window.api.credentials.delete('github');
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete credential');
    }
  };

  const handleSaveGitlabKey = async (_service: string, key: string) => {
    await window.api.credentials.store('gitlab', key);
    setShowGitlabDialog(false);
    await loadAll();
  };

  const handleDeleteGitlab = async () => {
    try {
      await window.api.credentials.delete('gitlab');
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete credential');
    }
  };

  const handleSaveAwsQKey = async (_service: string, key: string) => {
    await window.api.credentials.store('aws_q_developer', key);
    setShowAwsQDialog(false);
    await loadAll();
  };

  const handleDeleteAwsQ = async () => {
    try {
      await window.api.credentials.delete('aws_q_developer');
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete credential');
    }
  };

  const handleSaveAwsKiroKey = async (_service: string, key: string) => {
    await window.api.credentials.store('aws_kiro', key);
    setShowAwsKiroDialog(false);
    await loadAll();
  };

  const handleDeleteAwsKiro = async () => {
    try {
      await window.api.credentials.delete('aws_kiro');
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete credential');
    }
  };

  if (loading) {
    return <div className="text-gray-500 dark:text-gray-400 text-center py-4">Loading credentials...</div>;
  }

  const activeMethod = settings?.anthropic_auth_method ?? 'api_key';

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-900 bg-opacity-30 border border-red-700 rounded px-4 py-3 text-red-200 text-sm">
          {error}
        </div>
      )}

      {/* ── Section 1: Anthropic API Access ─────────────────────────────── */}
      <div>
        <h3 className="text-gray-900 dark:text-white font-semibold mb-1">Anthropic API Access</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
          Choose how Claude Code inside containers authenticates with Anthropic.
          The selected method is automatically injected at loop start.
        </p>

        <div className="space-y-3">
          {/* API Key card */}
          <AuthMethodCard
            active={activeMethod === 'api_key'}
            onClick={() => saveAuthMethod('api_key')}
            title="API Key"
            description="Use ANTHROPIC_API_KEY injected as an environment variable"
            statusLabel={authStatus.api_key ? 'Key stored' : 'Not configured'}
            statusOk={authStatus.api_key}
            action={
              <button
                onClick={(e) => { e.stopPropagation(); setShowApiKeyDialog(true); }}
                className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded transition-colors"
              >
                {authStatus.api_key ? 'Update Key' : 'Configure'}
              </button>
            }
          />

          {/* Browser Session card */}
          <AuthMethodCard
            active={activeMethod === 'browser_session'}
            onClick={() => saveAuthMethod('browser_session')}
            title="Browser Session"
            description="Login via claude.ai; session cookies are written to ~/.claude.json inside the container"
            statusLabel={authStatus.browser_session ? 'Session stored' : 'Not configured'}
            statusOk={authStatus.browser_session}
            action={
              <button
                onClick={(e) => { e.stopPropagation(); handleBrowserLogin(); }}
                disabled={loginInProgress}
                className="px-3 py-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs rounded transition-colors"
              >
                {loginInProgress ? 'Opening...' : 'Login via Browser'}
              </button>
            }
          />

          {/* AWS Bedrock card */}
          <AuthMethodCard
            active={activeMethod === 'aws_bedrock'}
            onClick={() => saveAuthMethod('aws_bedrock')}
            title="AWS Bedrock"
            description="Use AWS Bedrock with CLAUDE_CODE_USE_BEDROCK=1 and your AWS credentials"
            statusLabel={
              authStatus.aws_bedrock
                ? `Configured${settings?.bedrock_region ? ` · ${settings.bedrock_region}` : ''}`
                : 'Not configured'
            }
            statusOk={authStatus.aws_bedrock}
            action={
              <button
                onClick={(e) => { e.stopPropagation(); setShowBedrockDialog(true); }}
                className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded transition-colors"
              >
                {authStatus.aws_bedrock ? 'Update' : 'Configure'}
              </button>
            }
          />
        </div>
      </div>

      {/* ── Section 2: GitHub ────────────────────────────────────────────── */}
      <div>
        <h3 className="text-gray-900 dark:text-white font-semibold mb-1">GitHub</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
          Repository access for cloning and pushing commits.
        </p>

        <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <span className="text-2xl">🐙</span>
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Personal access token</p>
              {githubMaskedKey && (
                <p className="text-xs text-gray-500 font-mono mt-1">{githubMaskedKey}</p>
              )}
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <span
              className={`px-2 py-1 rounded text-xs font-medium ${
                githubStored
                  ? 'bg-green-900 bg-opacity-30 text-green-400 border border-green-700'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
              }`}
            >
              {githubStored ? 'Configured' : 'Not Set'}
            </span>
            <button
              onClick={() => setShowGithubDialog(true)}
              className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded transition-colors"
            >
              {githubStored ? 'Update' : 'Configure'}
            </button>
            {githubStored && (
              <button
                onClick={handleDeleteGithub}
                className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-xs rounded transition-colors"
              >
                Delete
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Section 3: GitLab ────────────────────────────────────────────── */}
      <div>
        <h3 className="text-gray-900 dark:text-white font-semibold mb-1">GitLab</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
          Repository access for cloning and pushing commits.
        </p>

        <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <span className="text-2xl">🦊</span>
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Personal access token</p>
              {gitlabMaskedKey && (
                <p className="text-xs text-gray-500 font-mono mt-1">{gitlabMaskedKey}</p>
              )}
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <span
              className={`px-2 py-1 rounded text-xs font-medium ${
                gitlabStored
                  ? 'bg-green-900 bg-opacity-30 text-green-400 border border-green-700'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
              }`}
            >
              {gitlabStored ? 'Configured' : 'Not Set'}
            </span>
            <button
              onClick={() => setShowGitlabDialog(true)}
              className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded transition-colors"
            >
              {gitlabStored ? 'Update' : 'Configure'}
            </button>
            {gitlabStored && (
              <button
                onClick={handleDeleteGitlab}
                className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-xs rounded transition-colors"
              >
                Delete
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Section 4: AWS Q Developer ───────────────────────────────────── */}
      <div>
        <h3 className="text-gray-900 dark:text-white font-semibold mb-1">AWS Q Developer</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
          Bearer token for AWS Q Developer (Amazon Q) coding assistant access.
        </p>

        <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <span className="text-2xl">☁️</span>
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Bearer token</p>
              {awsQMaskedKey && (
                <p className="text-xs text-gray-500 font-mono mt-1">{awsQMaskedKey}</p>
              )}
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <span
              className={`px-2 py-1 rounded text-xs font-medium ${
                awsQStored
                  ? 'bg-green-900 bg-opacity-30 text-green-400 border border-green-700'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
              }`}
            >
              {awsQStored ? 'Configured' : 'Not Set'}
            </span>
            <button
              onClick={() => setShowAwsQDialog(true)}
              className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded transition-colors"
            >
              {awsQStored ? 'Update' : 'Configure'}
            </button>
            {awsQStored && (
              <button
                onClick={handleDeleteAwsQ}
                className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-xs rounded transition-colors"
              >
                Delete
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Section 5: AWS Kiro ───────────────────────────────────────────── */}
      <div>
        <h3 className="text-gray-900 dark:text-white font-semibold mb-1">AWS Kiro</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
          Bearer token for AWS Kiro AI-powered development assistant access.
        </p>

        <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <span className="text-2xl">☁️</span>
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Bearer token</p>
              {awsKiroMaskedKey && (
                <p className="text-xs text-gray-500 font-mono mt-1">{awsKiroMaskedKey}</p>
              )}
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <span
              className={`px-2 py-1 rounded text-xs font-medium ${
                awsKiroStored
                  ? 'bg-green-900 bg-opacity-30 text-green-400 border border-green-700'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
              }`}
            >
              {awsKiroStored ? 'Configured' : 'Not Set'}
            </span>
            <button
              onClick={() => setShowAwsKiroDialog(true)}
              className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded transition-colors"
            >
              {awsKiroStored ? 'Update' : 'Configure'}
            </button>
            {awsKiroStored && (
              <button
                onClick={handleDeleteAwsKiro}
                className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-xs rounded transition-colors"
              >
                Delete
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Dialogs ──────────────────────────────────────────────────────── */}
      {showApiKeyDialog && (
        <CredentialDialog
          service="anthropic"
          currentKey={null}
          onSave={(key) => handleSaveApiKey('anthropic', key)}
          onClose={() => setShowApiKeyDialog(false)}
        />
      )}

      {showBedrockDialog && settings && (
        <BedrockDialog
          currentSettings={settings}
          onSave={handleSaveBedrockConfig}
          onClose={() => setShowBedrockDialog(false)}
        />
      )}

      {showGithubDialog && (
        <CredentialDialog
          service="github"
          currentKey={githubMaskedKey}
          onSave={(key) => handleSaveGithubKey('github', key)}
          onClose={() => setShowGithubDialog(false)}
        />
      )}

      {showGitlabDialog && (
        <CredentialDialog
          service="gitlab"
          currentKey={gitlabMaskedKey}
          onSave={(key) => handleSaveGitlabKey('gitlab', key)}
          onClose={() => setShowGitlabDialog(false)}
        />
      )}

      {showAwsQDialog && (
        <CredentialDialog
          service="aws_q_developer"
          currentKey={awsQMaskedKey}
          onSave={(key) => handleSaveAwsQKey('aws_q_developer', key)}
          onClose={() => setShowAwsQDialog(false)}
        />
      )}

      {showAwsKiroDialog && (
        <CredentialDialog
          service="aws_kiro"
          currentKey={awsKiroMaskedKey}
          onSave={(key) => handleSaveAwsKiroKey('aws_kiro', key)}
          onClose={() => setShowAwsKiroDialog(false)}
        />
      )}
    </div>
  );
};

// ── AuthMethodCard ────────────────────────────────────────────────────────────

interface AuthMethodCardProps {
  active: boolean;
  onClick: () => void;
  title: string;
  description: string;
  statusLabel: string;
  statusOk: boolean;
  action: React.ReactNode;
}

const AuthMethodCard: React.FC<AuthMethodCardProps> = ({
  active,
  onClick,
  title,
  description,
  statusLabel,
  statusOk,
  action,
}) => (
  <div
    onClick={onClick}
    className={`bg-white dark:bg-gray-900 rounded-lg border p-4 flex items-center justify-between cursor-pointer transition-colors ${
      active ? 'border-blue-500' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
    }`}
  >
    <div className="flex items-center space-x-3 flex-1 min-w-0">
      {/* Radio indicator */}
      <div
        className={`w-4 h-4 rounded-full border-2 flex-shrink-0 ${
          active ? 'border-blue-500 bg-blue-500' : 'border-gray-500 bg-transparent'
        }`}
      />
      <div className="min-w-0">
        <h4 className="text-gray-900 dark:text-white font-medium text-sm">{title}</h4>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">{description}</p>
      </div>
    </div>

    <div className="flex items-center space-x-2 ml-4 flex-shrink-0">
      <span
        className={`px-2 py-1 rounded text-xs font-medium ${
          statusOk
            ? 'bg-green-900 bg-opacity-30 text-green-400 border border-green-700'
            : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
        }`}
      >
        {statusLabel}
      </span>
      {action}
    </div>
  </div>
);
