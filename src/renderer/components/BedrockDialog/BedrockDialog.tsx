import React, { useState, useEffect } from 'react';
import type { AppSettings } from '../../../shared/models';

interface BedrockDialogProps {
  currentSettings: AppSettings;
  onSave: (fields: {
    region: string;
    model: string;
    smallFastModel: string;
    log: string;
    bearerToken: string;
  }) => Promise<void>;
  onClose: () => void;
}

/**
 * Modal form for configuring AWS Bedrock credentials and settings.
 *
 * Saves non-sensitive fields (region, model overrides, log level) via
 * settings.save() and the AWS_BEARER_TOKEN encrypted via credentials.store().
 */
export const BedrockDialog: React.FC<BedrockDialogProps> = ({
  currentSettings,
  onSave,
  onClose,
}) => {
  const [region, setRegion] = useState(currentSettings.bedrock_region ?? '');
  const [model, setModel] = useState(currentSettings.bedrock_model ?? '');
  const [smallFastModel, setSmallFastModel] = useState(currentSettings.bedrock_small_fast_model ?? '');
  const [log, setLog] = useState(currentSettings.bedrock_log ?? '');
  const [bearerToken, setBearerToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleSave = async () => {
    if (!region.trim()) {
      setError('AWS Region is required');
      return;
    }
    if (!bearerToken.trim()) {
      setError('AWS Bearer Token is required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave({ region: region.trim(), model: model.trim(), smallFastModel: smallFastModel.trim(), log: log.trim(), bearerToken: bearerToken.trim() });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save Bedrock configuration');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-gray-800 rounded-lg border border-gray-700 p-6 w-full max-w-lg shadow-xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-white font-semibold text-lg">Configure AWS Bedrock</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors text-xl leading-none"
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        {error && (
          <div className="mb-4 bg-red-900 bg-opacity-30 border border-red-700 rounded px-4 py-3 text-red-200 text-sm">
            {error}
          </div>
        )}

        <div className="space-y-4">
          {/* AWS Region */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              AWS Region <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              placeholder="us-east-1"
              className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* AWS Bearer Token */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              AWS Bearer Token <span className="text-red-400">*</span>
            </label>
            <div className="relative">
              <input
                type={showToken ? 'text' : 'password'}
                value={bearerToken}
                onChange={(e) => setBearerToken(e.target.value)}
                placeholder="Stored encrypted"
                className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 pr-20 text-white text-sm focus:outline-none focus:border-blue-500"
              />
              <button
                type="button"
                onClick={() => setShowToken((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-200"
              >
                {showToken ? 'Hide' : 'Show'}
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-1">Stored encrypted via system keychain</p>
          </div>

          {/* ANTHROPIC_MODEL */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              ANTHROPIC_MODEL <span className="text-gray-500 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="e.g. anthropic.claude-3-5-sonnet-20241022-v2:0"
              className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* ANTHROPIC_SMALL_FAST_MODEL */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              ANTHROPIC_SMALL_FAST_MODEL <span className="text-gray-500 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={smallFastModel}
              onChange={(e) => setSmallFastModel(e.target.value)}
              placeholder="e.g. anthropic.claude-3-5-haiku-20241022-v1:0"
              className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* ANTHROPIC_LOG */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              ANTHROPIC_LOG <span className="text-gray-500 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={log}
              onChange={(e) => setLog(e.target.value)}
              placeholder="e.g. debug"
              className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-300 hover:text-white transition-colors"
            disabled={saving}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm rounded transition-colors"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
};
