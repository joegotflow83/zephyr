import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { CredentialsSection } from '../../src/renderer/pages/SettingsTab/CredentialsSection';
import type { AppSettings } from '../../src/shared/models';

const defaultSettings: AppSettings = {
  max_concurrent_containers: 5,
  notification_enabled: true,
  theme: 'system',
  log_level: 'INFO',
  anthropic_auth_method: 'api_key',
};

// Mock window.api
const mockCredentials = {
  list: vi.fn(),
  get: vi.fn(),
  store: vi.fn(),
  delete: vi.fn(),
  login: vi.fn(),
  checkAuth: vi.fn(),
};

const mockSettings = {
  load: vi.fn(),
  save: vi.fn(),
};

// @ts-expect-error - mocking window.api
globalThis.window.api = {
  ...globalThis.window.api,
  credentials: mockCredentials,
  settings: mockSettings,
};

describe('CredentialsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCredentials.list.mockResolvedValue([]);
    mockCredentials.get.mockResolvedValue(null);
    mockCredentials.store.mockResolvedValue(undefined);
    mockCredentials.delete.mockResolvedValue(undefined);
    mockCredentials.login.mockResolvedValue({ success: true, service: 'claude-code' });
    mockCredentials.checkAuth.mockResolvedValue({
      api_key: false,
      browser_session: false,
      aws_bedrock: false,
    });
    mockSettings.load.mockResolvedValue(defaultSettings);
    mockSettings.save.mockResolvedValue(undefined);
  });

  it('renders Anthropic API Access section heading', async () => {
    render(<CredentialsSection />);
    await waitFor(() => {
      expect(screen.getByText('Anthropic API Access')).toBeInTheDocument();
    });
  });

  it('renders all three auth method cards', async () => {
    render(<CredentialsSection />);
    await waitFor(() => {
      expect(screen.getByText('API Key')).toBeInTheDocument();
      expect(screen.getByText('Browser Session')).toBeInTheDocument();
      expect(screen.getByText('AWS Bedrock')).toBeInTheDocument();
    });
  });

  it('renders GitHub section', async () => {
    render(<CredentialsSection />);
    await waitFor(() => {
      expect(screen.getByText('GitHub')).toBeInTheDocument();
    });
  });

  it('shows loading state initially', async () => {
    mockSettings.load.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(defaultSettings), 100))
    );

    render(<CredentialsSection />);
    expect(screen.getByText('Loading credentials...')).toBeInTheDocument();

    await waitFor(
      () => expect(screen.queryByText('Loading credentials...')).not.toBeInTheDocument(),
      { timeout: 1000 }
    );
  });

  it('shows "Not configured" status when no credentials stored', async () => {
    render(<CredentialsSection />);

    await waitFor(() => {
      // All three Anthropic auth methods should show not configured
      const notConfigured = screen.getAllByText('Not configured');
      expect(notConfigured.length).toBeGreaterThanOrEqual(3);
    });
  });

  it('shows "Key stored" when API key is configured', async () => {
    mockCredentials.checkAuth.mockResolvedValue({
      api_key: true,
      browser_session: false,
      aws_bedrock: false,
    });

    render(<CredentialsSection />);

    await waitFor(() => {
      expect(screen.getByText('Key stored')).toBeInTheDocument();
    });
  });

  it('shows "Session stored" when browser session is configured', async () => {
    mockCredentials.checkAuth.mockResolvedValue({
      api_key: false,
      browser_session: true,
      aws_bedrock: false,
    });

    render(<CredentialsSection />);

    await waitFor(() => {
      expect(screen.getByText('Session stored')).toBeInTheDocument();
    });
  });

  it('shows "Configured" for Bedrock when aws_bedrock is stored', async () => {
    mockCredentials.checkAuth.mockResolvedValue({
      api_key: false,
      browser_session: false,
      aws_bedrock: true,
    });

    render(<CredentialsSection />);

    await waitFor(() => {
      expect(screen.getByText(/Configured/)).toBeInTheDocument();
    });
  });

  it('opens CredentialDialog when API Key Configure is clicked', async () => {
    render(<CredentialsSection />);

    await waitFor(() => screen.getByText('API Key'));

    // Click the Configure button next to API Key
    const configureButton = screen.getAllByText('Configure')[0];
    fireEvent.click(configureButton);

    await waitFor(() => {
      expect(screen.getByText('Configure Anthropic Credentials')).toBeInTheDocument();
    });
  });

  it('opens BedrockDialog when Bedrock Configure is clicked', async () => {
    render(<CredentialsSection />);

    await waitFor(() => screen.getByText('AWS Bedrock'));

    // Configure buttons order: [API Key, Bedrock, GitHub] — index 1 is Bedrock
    const configureButtons = screen.getAllByText('Configure');
    fireEvent.click(configureButtons[1]);

    await waitFor(() => {
      expect(screen.getByText('Configure AWS Bedrock')).toBeInTheDocument();
    });
  });

  it('triggers browser login when "Login via Browser" is clicked', async () => {
    render(<CredentialsSection />);

    await waitFor(() => screen.getByText('Login via Browser'));

    const loginButton = screen.getByText('Login via Browser');
    fireEvent.click(loginButton);

    await waitFor(() => {
      expect(mockCredentials.login).toHaveBeenCalledWith('claude-code');
    });
  });

  it('shows error when browser login fails', async () => {
    mockCredentials.login.mockResolvedValue({
      success: false,
      service: 'claude-code',
      error: 'Login window closed',
    });

    render(<CredentialsSection />);

    await waitFor(() => screen.getByText('Login via Browser'));

    fireEvent.click(screen.getByText('Login via Browser'));

    await waitFor(() => {
      expect(screen.getByText('Login window closed')).toBeInTheDocument();
    });
  });

  it('saves auth method to settings when a card is clicked', async () => {
    render(<CredentialsSection />);

    await waitFor(() => screen.getByText('Browser Session'));

    const browserCard = screen.getByText('Browser Session').closest('div[class*="bg-gray-900"]');
    fireEvent.click(browserCard!);

    await waitFor(() => {
      expect(mockSettings.save).toHaveBeenCalledWith(
        expect.objectContaining({ anthropic_auth_method: 'browser_session' })
      );
    });
  });

  it('shows GitHub and GitLab sections with Not Set status initially', async () => {
    render(<CredentialsSection />);

    await waitFor(() => {
      expect(screen.getByText('GitHub')).toBeInTheDocument();
      expect(screen.getByText('GitLab')).toBeInTheDocument();
      const notSetBadges = screen.getAllByText('Not Set');
      expect(notSetBadges.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('shows GitHub delete button when GitHub credential stored', async () => {
    mockCredentials.list.mockResolvedValue(['github']);
    mockCredentials.get.mockImplementation((service: string) => {
      if (service === 'github') return Promise.resolve('ghp_****5678');
      return Promise.resolve(null);
    });

    render(<CredentialsSection />);

    await waitFor(() => {
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });
  });

  it('deletes GitHub credential when Delete clicked', async () => {
    mockCredentials.list.mockResolvedValue(['github']);
    mockCredentials.get.mockResolvedValue('ghp_****5678');

    render(<CredentialsSection />);

    await waitFor(() => screen.getByText('Delete'));

    fireEvent.click(screen.getByText('Delete'));

    await waitFor(() => {
      expect(mockCredentials.delete).toHaveBeenCalledWith('github');
    });
  });

  it('displays error when settings load fails', async () => {
    mockSettings.load.mockRejectedValue(new Error('Settings error'));

    render(<CredentialsSection />);

    await waitFor(() => {
      expect(screen.getByText('Settings error')).toBeInTheDocument();
    });
  });

  it('saves Bedrock bearer token via credentials.store', async () => {
    render(<CredentialsSection />);

    await waitFor(() => screen.getByText('AWS Bedrock'));

    // Configure buttons order: [API Key, Bedrock, GitHub] — index 1 is Bedrock
    const configureButtons = screen.getAllByText('Configure');
    fireEvent.click(configureButtons[1]);

    await waitFor(() => screen.getByText('Configure AWS Bedrock'));

    // Fill in required fields
    const regionInput = screen.getByPlaceholderText('us-east-1');
    fireEvent.change(regionInput, { target: { value: 'us-west-2' } });

    const tokenInputs = screen.getAllByPlaceholderText('Stored encrypted');
    fireEvent.change(tokenInputs[0], { target: { value: 'my-bearer-token' } });

    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(mockCredentials.store).toHaveBeenCalledWith('anthropic_bedrock', 'my-bearer-token');
      expect(mockSettings.save).toHaveBeenCalledWith(
        expect.objectContaining({ bedrock_region: 'us-west-2' })
      );
    });
  });
});
