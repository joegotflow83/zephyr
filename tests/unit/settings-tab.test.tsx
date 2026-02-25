import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsTab } from '../../src/renderer/pages/SettingsTab/SettingsTab';
import * as useSettingsModule from '../../src/renderer/hooks/useSettings';
import * as useDockerStatusModule from '../../src/renderer/hooks/useDockerStatus';
import type { AppSettings } from '../../src/shared/models';

// Mock the useSettings hook
vi.mock('../../src/renderer/hooks/useSettings');

// Mock the useDockerStatus hook
vi.mock('../../src/renderer/hooks/useDockerStatus');

// Mock window.api.credentials for CredentialsSection
const mockCredentials = {
  list: vi.fn().mockResolvedValue([]),
  get: vi.fn().mockResolvedValue(null),
  store: vi.fn().mockResolvedValue(undefined),
  delete: vi.fn().mockResolvedValue(undefined),
  login: vi.fn().mockResolvedValue({ success: true, service: 'claude-code' }),
  checkAuth: vi.fn().mockResolvedValue({ api_key: false, browser_session: false, aws_bedrock: false }),
};

// Mock window.api.docker for DockerSection
const mockDocker = {
  status: vi.fn().mockResolvedValue({ available: false, info: undefined }),
  onStatusChanged: vi.fn().mockReturnValue(() => {}),
};

const mockSettingsApi = {
  load: vi.fn().mockResolvedValue({
    max_concurrent_containers: 3,
    notification_enabled: true,
    theme: 'dark',
    log_level: 'INFO',
    anthropic_auth_method: 'api_key',
  }),
  save: vi.fn().mockResolvedValue(undefined),
};

// @ts-expect-error - mocking window.api
globalThis.window.api = {
  ...globalThis.window.api,
  credentials: mockCredentials,
  docker: mockDocker,
  settings: mockSettingsApi,
};

describe('SettingsTab', () => {
  const mockRefresh = vi.fn();
  const mockUpdate = vi.fn();

  const mockSettings: AppSettings = {
    max_concurrent_containers: 3,
    notification_enabled: true,
    theme: 'dark',
    log_level: 'INFO',
    anthropic_auth_method: 'api_key',
  };

  const defaultUseSettingsReturn = {
    settings: mockSettings,
    loading: false,
    error: null,
    refresh: mockRefresh,
    update: mockUpdate,
  };

  beforeEach(() => {
    // Reset credential mocks
    vi.clearAllMocks();
    mockCredentials.list.mockResolvedValue([]);
    mockCredentials.get.mockResolvedValue(null);
    mockCredentials.checkAuth.mockResolvedValue({ api_key: false, browser_session: false, aws_bedrock: false });
    mockSettingsApi.load.mockResolvedValue({ ...mockSettings });
    mockSettingsApi.save.mockResolvedValue(undefined);
    mockDocker.status.mockResolvedValue({ available: false, info: undefined });
    mockDocker.onStatusChanged.mockReturnValue(() => {});
    vi.clearAllMocks();
    vi.spyOn(useSettingsModule, 'useSettings').mockReturnValue(
      defaultUseSettingsReturn
    );
    vi.spyOn(useDockerStatusModule, 'useDockerStatus').mockReturnValue({
      isConnected: false,
      dockerInfo: undefined,
    });
  });

  describe('Basic Rendering', () => {
    it('should render the settings page with title', () => {
      render(<SettingsTab />);
      expect(screen.getByText('Settings')).toBeInTheDocument();
      expect(
        screen.getByText(
          /Configure credentials, Docker, application preferences, and updates/i
        )
      ).toBeInTheDocument();
    });

    it('should call refresh on mount', () => {
      render(<SettingsTab />);
      expect(mockRefresh).toHaveBeenCalledTimes(1);
    });

    it('should render all four section headers', () => {
      render(<SettingsTab />);
      expect(screen.getByText('Credentials')).toBeInTheDocument();
      expect(screen.getByText('Docker')).toBeInTheDocument();
      expect(screen.getByText('General')).toBeInTheDocument();
      expect(screen.getByText('Updates')).toBeInTheDocument();
    });

    it('should render section descriptions', () => {
      render(<SettingsTab />);
      expect(
        screen.getByText('Manage API keys and login sessions for AI services')
      ).toBeInTheDocument();
      expect(
        screen.getByText('Configure Docker connection and container settings')
      ).toBeInTheDocument();
      expect(
        screen.getByText('Application preferences and appearance')
      ).toBeInTheDocument();
      expect(
        screen.getByText('Check for and install application updates')
      ).toBeInTheDocument();
    });
  });

  describe('Section Collapsing', () => {
    it('should render Credentials section expanded by default', async () => {
      render(<SettingsTab />);
      // Wait for async data to load
      await waitFor(() => {
        expect(
          screen.getByText('Anthropic API Access')
        ).toBeInTheDocument();
      });
    });

    it('should render other sections collapsed by default', () => {
      render(<SettingsTab />);
      // Docker section content should not be visible
      expect(screen.queryByText('Connection Status')).not.toBeInTheDocument();
      // General section content should not be visible
      expect(screen.queryByText('Desktop Notifications')).not.toBeInTheDocument();
      // Updates section content should not be visible
      expect(screen.queryByText('Update management coming soon...')).not.toBeInTheDocument();
    });

    it('should expand a section when clicked', async () => {
      const user = userEvent.setup();
      render(<SettingsTab />);

      // Docker section should be collapsed initially
      expect(screen.queryByText('Connection Status')).not.toBeInTheDocument();

      // Click the Docker section header
      const dockerHeader = screen.getByText('Docker').closest('button');
      expect(dockerHeader).toBeInTheDocument();
      await user.click(dockerHeader!);

      // Docker section should now be visible
      expect(screen.getByText('Connection Status')).toBeInTheDocument();
    });

    it('should collapse an expanded section when clicked', async () => {
      const user = userEvent.setup();
      render(<SettingsTab />);

      // Credentials section should be expanded initially (wait for async load)
      await waitFor(() => {
        expect(
          screen.getByText('Anthropic API Access')
        ).toBeInTheDocument();
      });

      // Click the Credentials section header
      const credentialsHeader = screen.getByText('Credentials').closest('button');
      expect(credentialsHeader).toBeInTheDocument();
      await user.click(credentialsHeader!);

      // Credentials section should now be collapsed
      expect(
        screen.queryByText('Anthropic API Access')
      ).not.toBeInTheDocument();
    });

    it('should allow multiple sections to be expanded simultaneously', async () => {
      const user = userEvent.setup();
      render(<SettingsTab />);

      // Expand Docker section
      const dockerHeader = screen.getByText('Docker').closest('button');
      await user.click(dockerHeader!);

      // Expand General section
      const generalHeader = screen.getByText('General').closest('button');
      await user.click(generalHeader!);

      // Both should be visible along with initially expanded Credentials
      expect(
        screen.getByText('Anthropic API Access')
      ).toBeInTheDocument();
      expect(screen.getByText('Connection Status')).toBeInTheDocument();
      expect(screen.getByText('Desktop Notifications')).toBeInTheDocument();
    });

    it('should have correct aria-expanded attribute', async () => {
      const user = userEvent.setup();
      render(<SettingsTab />);

      const dockerHeader = screen.getByText('Docker').closest('button');
      expect(dockerHeader).toHaveAttribute('aria-expanded', 'false');

      await user.click(dockerHeader!);
      expect(dockerHeader).toHaveAttribute('aria-expanded', 'true');

      await user.click(dockerHeader!);
      expect(dockerHeader).toHaveAttribute('aria-expanded', 'false');
    });
  });

  describe('Settings Data Display', () => {
    it('should display Docker section content when expanded', async () => {
      const user = userEvent.setup();
      render(<SettingsTab />);

      // Expand Docker section
      const dockerHeader = screen.getByText('Docker').closest('button');
      await user.click(dockerHeader!);

      // Check that Docker section content is displayed
      expect(screen.getByText('Connection Status')).toBeInTheDocument();
      expect(screen.getByText('Max Concurrent Containers')).toBeInTheDocument();
    });

    it('should display General section content when expanded', async () => {
      const user = userEvent.setup();
      render(<SettingsTab />);

      // Expand General section
      const generalHeader = screen.getByText('General').closest('button');
      await user.click(generalHeader!);

      // Check that General section content is displayed
      expect(screen.getByText('Desktop Notifications')).toBeInTheDocument();
      expect(screen.getByText('Log Level')).toBeInTheDocument();
      expect(screen.getByText('Theme')).toBeInTheDocument();
      expect(screen.getByText('Application Version')).toBeInTheDocument();
    });
  });

  describe('Loading States', () => {
    it('should show loading state when loading and no settings', () => {
      vi.spyOn(useSettingsModule, 'useSettings').mockReturnValue({
        ...defaultUseSettingsReturn,
        settings: null,
        loading: true,
      });

      render(<SettingsTab />);
      expect(screen.getByText('Loading settings...')).toBeInTheDocument();
      expect(screen.queryByText('Settings')).not.toBeInTheDocument();
    });

    it('should not show loading state when loading but settings exist', () => {
      vi.spyOn(useSettingsModule, 'useSettings').mockReturnValue({
        ...defaultUseSettingsReturn,
        loading: true,
      });

      render(<SettingsTab />);
      expect(screen.queryByText('Loading settings...')).not.toBeInTheDocument();
      expect(screen.getByText('Settings')).toBeInTheDocument();
    });
  });

  describe('Error Handling', () => {
    it('should show error state when error occurs', () => {
      vi.spyOn(useSettingsModule, 'useSettings').mockReturnValue({
        ...defaultUseSettingsReturn,
        error: 'Failed to load settings',
      });

      render(<SettingsTab />);
      expect(
        screen.getByText(/Error loading settings: Failed to load settings/i)
      ).toBeInTheDocument();
      expect(screen.queryByText('Settings')).not.toBeInTheDocument();
    });

    it('should not show error when error is null', () => {
      render(<SettingsTab />);
      expect(
        screen.queryByText(/Error loading settings/i)
      ).not.toBeInTheDocument();
      expect(screen.getByText('Settings')).toBeInTheDocument();
    });
  });

  describe('Section Icons', () => {
    it('should render chevron icon for each section', () => {
      render(<SettingsTab />);
      const sectionButtons = screen.getAllByRole('button').filter(
        (btn) => btn.getAttribute('aria-expanded') !== null
      );
      // We have 4 section headers
      expect(sectionButtons).toHaveLength(4);
      sectionButtons.forEach((button) => {
        const svg = button.querySelector('svg');
        expect(svg).toBeInTheDocument();
      });
    });

    it('should rotate chevron icon when section is expanded', async () => {
      const user = userEvent.setup();
      render(<SettingsTab />);

      const dockerHeader = screen.getByText('Docker').closest('button');
      const svg = dockerHeader!.querySelector('svg');

      // Should not have rotate-180 initially
      expect(svg).not.toHaveClass('rotate-180');

      await user.click(dockerHeader!);

      // Should have rotate-180 when expanded
      expect(svg).toHaveClass('rotate-180');
    });
  });

  describe('Scrolling', () => {
    it('should have scrollable container', () => {
      const { container } = render(<SettingsTab />);
      const scrollableDiv = container.querySelector('.overflow-y-auto');
      expect(scrollableDiv).toBeInTheDocument();
    });

    it('should have max-width constraint for content', () => {
      const { container } = render(<SettingsTab />);
      const contentDiv = container.querySelector('.max-w-4xl');
      expect(contentDiv).toBeInTheDocument();
    });
  });
});
