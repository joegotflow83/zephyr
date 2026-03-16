import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ContainerRuntimeSection } from '../../src/renderer/pages/SettingsTab/ContainerRuntimeSection';

vi.mock('../../src/renderer/hooks/useRuntimeStatus');
vi.mock('../../src/renderer/hooks/useSettings');

const mockUseRuntimeStatus = vi.fn();
const mockUseSettings = vi.fn();

await import('../../src/renderer/hooks/useRuntimeStatus').then((mod) => {
  // @ts-ignore
  mod.useRuntimeStatus = mockUseRuntimeStatus;
});
await import('../../src/renderer/hooks/useSettings').then((mod) => {
  // @ts-ignore
  mod.useSettings = mockUseSettings;
});

describe('ContainerRuntimeSection', () => {
  const mockUpdate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });

    mockUpdate.mockResolvedValue(undefined);

    mockUseRuntimeStatus.mockReturnValue({
      available: false,
      info: undefined,
      runtimeType: 'docker',
    });

    mockUseSettings.mockReturnValue({
      settings: {
        max_concurrent_containers: 3,
        notification_enabled: true,
        theme: 'system' as const,
        log_level: 'INFO' as const,
        container_runtime: 'docker' as const,
        anthropic_auth_method: 'api_key' as const,
      },
      update: mockUpdate,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Runtime Toggle', () => {
    it('shows Docker radio as selected by default', () => {
      render(<ContainerRuntimeSection />);

      const dockerRadio = screen.getByDisplayValue('docker') as HTMLInputElement;
      const podmanRadio = screen.getByDisplayValue('podman') as HTMLInputElement;
      expect(dockerRadio.checked).toBe(true);
      expect(podmanRadio.checked).toBe(false);
    });

    it('shows Podman radio as selected when runtime is podman', () => {
      mockUseSettings.mockReturnValue({
        settings: {
          max_concurrent_containers: 3,
          notification_enabled: true,
          theme: 'system' as const,
          log_level: 'INFO' as const,
          container_runtime: 'podman' as const,
          anthropic_auth_method: 'api_key' as const,
        },
        update: mockUpdate,
      });
      mockUseRuntimeStatus.mockReturnValue({
        available: true,
        info: { version: '5.0.0', containers: 0, images: 0 },
        runtimeType: 'podman',
      });

      render(<ContainerRuntimeSection />);

      const podmanRadio = screen.getByDisplayValue('podman') as HTMLInputElement;
      expect(podmanRadio.checked).toBe(true);
    });

    it('opens confirmation dialog when switching runtime', async () => {
      const user = userEvent.setup({ delay: null });
      render(<ContainerRuntimeSection />);

      const podmanRadio = screen.getByDisplayValue('podman');
      await user.click(podmanRadio);

      expect(screen.getByText('Switch Container Runtime')).toBeInTheDocument();
    });

    it('does not open confirmation dialog when selecting same runtime', async () => {
      const user = userEvent.setup({ delay: null });
      render(<ContainerRuntimeSection />);

      const dockerRadio = screen.getByDisplayValue('docker');
      await user.click(dockerRadio);

      expect(screen.queryByText('Switch Container Runtime')).not.toBeInTheDocument();
    });

    it('saves new runtime setting on confirm', async () => {
      const user = userEvent.setup({ delay: null });
      render(<ContainerRuntimeSection />);

      const podmanRadio = screen.getByDisplayValue('podman');
      await user.click(podmanRadio);

      const switchButton = screen.getByText('Switch Runtime');
      await user.click(switchButton);

      expect(mockUpdate).toHaveBeenCalledWith({ container_runtime: 'podman' });
    });

    it('shows restart banner after confirming runtime switch', async () => {
      const user = userEvent.setup({ delay: null });
      render(<ContainerRuntimeSection />);

      const podmanRadio = screen.getByDisplayValue('podman');
      await user.click(podmanRadio);

      const switchButton = screen.getByText('Switch Runtime');
      await user.click(switchButton);

      await act(async () => {});

      expect(screen.getByText(/Runtime changed/i)).toBeInTheDocument();
    });

    it('dismisses confirmation dialog on cancel', async () => {
      const user = userEvent.setup({ delay: null });
      render(<ContainerRuntimeSection />);

      const podmanRadio = screen.getByDisplayValue('podman');
      await user.click(podmanRadio);

      expect(screen.getByText('Switch Container Runtime')).toBeInTheDocument();

      const cancelButton = screen.getByText('Cancel');
      await user.click(cancelButton);

      expect(screen.queryByText('Switch Container Runtime')).not.toBeInTheDocument();
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });

  describe('Connection Status', () => {
    it('shows unavailable status when runtime is not available', () => {
      render(<ContainerRuntimeSection />);

      expect(screen.getByText('Unavailable')).toBeInTheDocument();
      const indicator = screen.getByTestId('runtime-status-indicator');
      expect(indicator).toHaveClass('bg-red-500');
    });

    it('shows available status when runtime is available', () => {
      mockUseRuntimeStatus.mockReturnValue({
        available: true,
        info: { version: '24.0.7', containers: 5, images: 12 },
        runtimeType: 'docker',
      });

      render(<ContainerRuntimeSection />);

      expect(screen.getByText('Available')).toBeInTheDocument();
      const indicator = screen.getByTestId('runtime-status-indicator');
      expect(indicator).toHaveClass('bg-green-500');
    });

    it('shows docker unavailability warning when docker is not running', () => {
      render(<ContainerRuntimeSection />);

      expect(
        screen.getByText(/Docker is not running or not available/i)
      ).toBeInTheDocument();
    });

    it('shows podman unavailability warning when podman is not running', () => {
      mockUseSettings.mockReturnValue({
        settings: {
          max_concurrent_containers: 3,
          notification_enabled: true,
          theme: 'system' as const,
          log_level: 'INFO' as const,
          container_runtime: 'podman' as const,
          anthropic_auth_method: 'api_key' as const,
        },
        update: mockUpdate,
      });

      render(<ContainerRuntimeSection />);

      expect(
        screen.getByText(/Podman is not available/i)
      ).toBeInTheDocument();
    });
  });

  describe('Docker-specific: Max Concurrent Containers', () => {
    it('shows max containers input when Docker is selected', () => {
      render(<ContainerRuntimeSection />);

      expect(screen.getByTestId('max-containers-input')).toBeInTheDocument();
    });

    it('hides max containers input when Podman is selected', () => {
      mockUseSettings.mockReturnValue({
        settings: {
          max_concurrent_containers: 3,
          notification_enabled: true,
          theme: 'system' as const,
          log_level: 'INFO' as const,
          container_runtime: 'podman' as const,
          anthropic_auth_method: 'api_key' as const,
        },
        update: mockUpdate,
      });

      render(<ContainerRuntimeSection />);

      expect(screen.queryByTestId('max-containers-input')).not.toBeInTheDocument();
    });

    it('displays current max containers value', () => {
      render(<ContainerRuntimeSection />);

      const input = screen.getByTestId('max-containers-input') as HTMLInputElement;
      expect(input.value).toBe('3');
    });

    it('increments max containers when + button clicked', async () => {
      const user = userEvent.setup({ delay: null });
      render(<ContainerRuntimeSection />);

      const incrementButton = screen.getByLabelText('Increase max containers');
      await user.click(incrementButton);

      const input = screen.getByTestId('max-containers-input') as HTMLInputElement;
      expect(input.value).toBe('4');
    });

    it('decrements max containers when - button clicked', async () => {
      const user = userEvent.setup({ delay: null });
      render(<ContainerRuntimeSection />);

      const decrementButton = screen.getByLabelText('Decrease max containers');
      await user.click(decrementButton);

      const input = screen.getByTestId('max-containers-input') as HTMLInputElement;
      expect(input.value).toBe('2');
    });

    it('does not decrement below 1', () => {
      mockUseSettings.mockReturnValue({
        settings: {
          max_concurrent_containers: 1,
          notification_enabled: true,
          theme: 'system' as const,
          log_level: 'INFO' as const,
          container_runtime: 'docker' as const,
          anthropic_auth_method: 'api_key' as const,
        },
        update: mockUpdate,
      });

      render(<ContainerRuntimeSection />);

      const decrementButton = screen.getByLabelText('Decrease max containers');
      expect(decrementButton).toBeDisabled();
    });

    it('does not increment above 20', () => {
      mockUseSettings.mockReturnValue({
        settings: {
          max_concurrent_containers: 20,
          notification_enabled: true,
          theme: 'system' as const,
          log_level: 'INFO' as const,
          container_runtime: 'docker' as const,
          anthropic_auth_method: 'api_key' as const,
        },
        update: mockUpdate,
      });

      render(<ContainerRuntimeSection />);

      const incrementButton = screen.getByLabelText('Increase max containers');
      expect(incrementButton).toBeDisabled();
    });

    it('saves max containers after debounce', async () => {
      const user = userEvent.setup({ delay: null });
      render(<ContainerRuntimeSection />);

      const incrementButton = screen.getByLabelText('Increase max containers');
      await user.click(incrementButton);

      expect(mockUpdate).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(500);
        vi.runAllTimers();
      });

      expect(mockUpdate).toHaveBeenCalledWith({ max_concurrent_containers: 4 });
    });
  });

  describe('Podman-specific', () => {
    it('shows podman machine note when Podman is selected', () => {
      mockUseSettings.mockReturnValue({
        settings: {
          max_concurrent_containers: 3,
          notification_enabled: true,
          theme: 'system' as const,
          log_level: 'INFO' as const,
          container_runtime: 'podman' as const,
          anthropic_auth_method: 'api_key' as const,
        },
        update: mockUpdate,
      });

      render(<ContainerRuntimeSection />);

      // The text "podman machine" is in a <code> element; use selector to be specific
      expect(screen.getByText('podman machine', { selector: 'code' })).toBeInTheDocument();
    });

    it('does not show podman machine note when Docker is selected', () => {
      render(<ContainerRuntimeSection />);

      expect(screen.queryByText('podman machine', { selector: 'code' })).not.toBeInTheDocument();
    });
  });

  describe('Runtime Information', () => {
    it('displays runtime info when available', () => {
      mockUseRuntimeStatus.mockReturnValue({
        available: true,
        info: {
          version: '24.0.7',
          containers: 5,
          images: 12,
          osType: 'linux',
          architecture: 'x86_64',
        },
        runtimeType: 'docker',
      });

      render(<ContainerRuntimeSection />);

      expect(screen.getByText('24.0.7')).toBeInTheDocument();
      expect(screen.getByText('5')).toBeInTheDocument();
      expect(screen.getByText('12')).toBeInTheDocument();
      expect(screen.getByText('linux')).toBeInTheDocument();
      expect(screen.getByText('x86_64')).toBeInTheDocument();
    });

    it('does not display runtime info when unavailable', () => {
      render(<ContainerRuntimeSection />);

      expect(screen.queryByText('Docker Information')).not.toBeInTheDocument();
    });

    it('shows Podman Information label when Podman is active', () => {
      mockUseSettings.mockReturnValue({
        settings: {
          max_concurrent_containers: 3,
          notification_enabled: true,
          theme: 'system' as const,
          log_level: 'INFO' as const,
          container_runtime: 'podman' as const,
          anthropic_auth_method: 'api_key' as const,
        },
        update: mockUpdate,
      });
      mockUseRuntimeStatus.mockReturnValue({
        available: true,
        info: { version: '5.0.0', containers: 2, images: 3 },
        runtimeType: 'podman',
      });

      render(<ContainerRuntimeSection />);

      expect(screen.getByText('Podman Information')).toBeInTheDocument();
    });
  });
});
