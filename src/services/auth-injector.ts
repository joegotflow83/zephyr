/**
 * AuthInjector — reads the configured Anthropic auth method and returns
 * the env vars / volume mounts to inject into Docker containers at start time.
 *
 * Runs in the Electron main process.
 *
 * Auth modes:
 * - api_key: ANTHROPIC_API_KEY env var
 * - browser_session: no env vars (session JSON is exec-written to container after start)
 * - aws_bedrock: CLAUDE_CODE_USE_BEDROCK=1 + AWS_REGION + AWS_BEARER_TOKEN + optional overrides
 */

import type { ConfigManager } from './config-manager';
import type { CredentialManager } from './credential-manager';
import type { AppSettings } from '../shared/models';
import { getLogger } from './logging';

export interface ContainerAuthConfig {
  envVars: Record<string, string>;
  volumeMounts: string[];
  authMethod: 'api_key' | 'browser_session' | 'aws_bedrock' | 'unknown';
}

export class AuthInjector {
  private readonly configManager: ConfigManager;
  private readonly credentialManager: CredentialManager;
  private readonly logger = getLogger('auth-injector');

  constructor(configManager: ConfigManager, credentialManager: CredentialManager) {
    this.configManager = configManager;
    this.credentialManager = credentialManager;
  }

  /**
   * Returns env vars and volume mounts to inject based on the current auth method.
   * Never throws — returns empty config on any error so loop start isn't blocked.
   */
  async getContainerAuthConfig(): Promise<ContainerAuthConfig> {
    const empty: ContainerAuthConfig = { envVars: {}, volumeMounts: [], authMethod: 'unknown' };

    try {
      const settings = this.configManager.loadJson<AppSettings>('settings.json');
      const authMethod = settings?.anthropic_auth_method ?? 'api_key';

      switch (authMethod) {
        case 'api_key':
          return this.buildApiKeyConfig();

        case 'browser_session':
          // Session JSON is written to the container via exec after start.
          // No env vars or volume mounts needed at container creation time.
          return { envVars: {}, volumeMounts: [], authMethod: 'browser_session' };

        case 'aws_bedrock':
          return this.buildBedrockConfig(settings ?? null);

        default:
          this.logger.warn(`Unknown auth method: ${authMethod as string}, skipping injection`);
          return empty;
      }
    } catch (err) {
      this.logger.error('Failed to build container auth config', { err });
      return empty;
    }
  }

  private async buildApiKeyConfig(): Promise<ContainerAuthConfig> {
    const key = await this.credentialManager.getApiKey('anthropic');
    if (!key) {
      this.logger.warn('api_key auth method selected but no ANTHROPIC_API_KEY stored');
      return { envVars: {}, volumeMounts: [], authMethod: 'api_key' };
    }
    return {
      envVars: { ANTHROPIC_API_KEY: key },
      volumeMounts: [],
      authMethod: 'api_key',
    };
  }

  private async buildBedrockConfig(settings: AppSettings | null): Promise<ContainerAuthConfig> {
    const bearerToken = await this.credentialManager.getApiKey('anthropic_bedrock');
    if (!bearerToken) {
      this.logger.warn('aws_bedrock auth method selected but no AWS_BEARER_TOKEN stored');
    }

    const envVars: Record<string, string> = {
      CLAUDE_CODE_USE_BEDROCK: '1',
    };

    if (settings?.bedrock_region) {
      envVars['AWS_REGION'] = settings.bedrock_region;
    }
    if (bearerToken) {
      envVars['AWS_BEARER_TOKEN'] = bearerToken;
    }
    if (settings?.bedrock_model) {
      envVars['ANTHROPIC_MODEL'] = settings.bedrock_model;
    }
    if (settings?.bedrock_small_fast_model) {
      envVars['ANTHROPIC_SMALL_FAST_MODEL'] = settings.bedrock_small_fast_model;
    }
    if (settings?.bedrock_log) {
      envVars['ANTHROPIC_LOG'] = settings.bedrock_log;
    }

    return { envVars, volumeMounts: [], authMethod: 'aws_bedrock' };
  }
}
