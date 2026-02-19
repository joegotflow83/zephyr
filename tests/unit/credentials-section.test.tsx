import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { CredentialsSection } from '../../src/renderer/pages/SettingsTab/CredentialsSection';

// Mock window.api.credentials
const mockCredentials = {
  list: vi.fn(),
  get: vi.fn(),
  store: vi.fn(),
  delete: vi.fn(),
  login: vi.fn(),
};

// @ts-expect-error - mocking window.api
globalThis.window.api = {
  ...globalThis.window.api,
  credentials: mockCredentials,
};

describe('CredentialsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCredentials.list.mockResolvedValue([]);
    mockCredentials.get.mockResolvedValue(null);
    mockCredentials.store.mockResolvedValue(undefined);
    mockCredentials.delete.mockResolvedValue(undefined);
    mockCredentials.login.mockResolvedValue({ success: true, service: 'anthropic' });
  });

  it('renders all three services', async () => {
    render(<CredentialsSection />);

    await waitFor(() => {
      expect(screen.getByText('Anthropic')).toBeInTheDocument();
      expect(screen.getByText('OpenAI')).toBeInTheDocument();
      expect(screen.getByText('GitHub')).toBeInTheDocument();
    });
  });

  it('displays service descriptions', async () => {
    render(<CredentialsSection />);

    await waitFor(() => {
      expect(screen.getByText('Claude API access')).toBeInTheDocument();
      expect(screen.getByText('GPT API access')).toBeInTheDocument();
      expect(screen.getByText('Repository access')).toBeInTheDocument();
    });
  });

  it('shows "Not Set" status when no credentials stored', async () => {
    mockCredentials.list.mockResolvedValue([]);

    render(<CredentialsSection />);

    await waitFor(() => {
      const notSetBadges = screen.getAllByText('Not Set');
      expect(notSetBadges).toHaveLength(3);
    });
  });

  it('shows "Configured" status when credentials stored', async () => {
    mockCredentials.list.mockResolvedValue(['anthropic', 'openai']);

    render(<CredentialsSection />);

    await waitFor(() => {
      const configuredBadges = screen.getAllByText('Configured');
      expect(configuredBadges).toHaveLength(2);
      expect(screen.getByText('Not Set')).toBeInTheDocument();
    });
  });

  it('displays masked keys for configured services', async () => {
    mockCredentials.list.mockResolvedValue(['anthropic']);
    mockCredentials.get.mockImplementation((service) => {
      if (service === 'anthropic') return Promise.resolve('sk_t**********cdef');
      return Promise.resolve(null);
    });

    render(<CredentialsSection />);

    await waitFor(() => {
      expect(screen.getByText('sk_t**********cdef')).toBeInTheDocument();
    });
  });

  it('shows Configure button for services without credentials', async () => {
    mockCredentials.list.mockResolvedValue([]);

    render(<CredentialsSection />);

    await waitFor(() => {
      const configureButtons = screen.getAllByText('Configure');
      expect(configureButtons).toHaveLength(3);
    });
  });

  it('shows Update button for services with credentials', async () => {
    mockCredentials.list.mockResolvedValue(['anthropic']);

    render(<CredentialsSection />);

    await waitFor(() => {
      expect(screen.getByText('Update')).toBeInTheDocument();
      expect(screen.getAllByText('Configure')).toHaveLength(2);
    });
  });

  it('shows Delete button only for configured services', async () => {
    mockCredentials.list.mockResolvedValue(['anthropic']);

    render(<CredentialsSection />);

    await waitFor(() => {
      const deleteButtons = screen.getAllByText('Delete');
      expect(deleteButtons).toHaveLength(1);
    });
  });

  it('opens CredentialDialog when Configure clicked', async () => {
    render(<CredentialsSection />);

    await waitFor(() => screen.getByText('Anthropic'));

    const configureButtons = screen.getAllByText('Configure');
    fireEvent.click(configureButtons[0]);

    expect(screen.getByText('Configure Anthropic Credentials')).toBeInTheDocument();
  });

  it('opens CredentialDialog when Update clicked', async () => {
    mockCredentials.list.mockResolvedValue(['openai']);

    render(<CredentialsSection />);

    await waitFor(() => screen.getByText('Update'));

    const updateButton = screen.getByText('Update');
    fireEvent.click(updateButton);

    expect(screen.getByText('Configure OpenAI Credentials')).toBeInTheDocument();
  });

  it('closes dialog when Cancel clicked', async () => {
    render(<CredentialsSection />);

    await waitFor(() => screen.getByText('Anthropic'));

    const configureButtons = screen.getAllByText('Configure');
    fireEvent.click(configureButtons[0]);

    const cancelButton = screen.getByText('Cancel');
    fireEvent.click(cancelButton);

    await waitFor(() => {
      expect(screen.queryByText('Configure Anthropic Credentials')).not.toBeInTheDocument();
    });
  });

  it('saves API key and refreshes when Save clicked', async () => {
    mockCredentials.store.mockResolvedValue(undefined);

    render(<CredentialsSection />);

    await waitFor(() => screen.getByText('Anthropic'));

    // Open dialog
    const configureButtons = screen.getAllByText('Configure');
    fireEvent.click(configureButtons[0]);

    // Enter key
    const input = screen.getByPlaceholderText(/Enter your Anthropic API key/);
    fireEvent.change(input, { target: { value: 'sk_test_key_12345' } });

    // Save
    const saveButton = screen.getByText('Save API Key');
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mockCredentials.store).toHaveBeenCalledWith('anthropic', 'sk_test_key_12345');
      expect(mockCredentials.list).toHaveBeenCalledTimes(2); // Initial + after save
    });
  });

  it('handles login mode and refreshes', async () => {
    mockCredentials.login.mockResolvedValue({ success: true, service: 'github' });

    render(<CredentialsSection />);

    await waitFor(() => screen.getByText('GitHub'));

    // Open dialog
    const configureButtons = screen.getAllByText('Configure');
    fireEvent.click(configureButtons[2]); // GitHub is third

    // Click login mode
    const loginButton = screen.getByText('Use Browser Login');
    fireEvent.click(loginButton);

    await waitFor(() => {
      expect(mockCredentials.login).toHaveBeenCalledWith('github');
      expect(mockCredentials.list).toHaveBeenCalledTimes(2); // Initial + after login
    });
  });

  it('displays error when login fails', async () => {
    mockCredentials.login.mockResolvedValue({
      success: false,
      service: 'anthropic',
      error: 'Login window closed',
    });

    render(<CredentialsSection />);

    await waitFor(() => screen.getByText('Anthropic'));

    const configureButtons = screen.getAllByText('Configure');
    fireEvent.click(configureButtons[0]);

    const loginButton = screen.getByText('Use Browser Login');
    fireEvent.click(loginButton);

    await waitFor(() => {
      expect(screen.getByText('Login window closed')).toBeInTheDocument();
    });
  });

  it('deletes credential when Delete clicked', async () => {
    mockCredentials.list.mockResolvedValue(['anthropic']);
    mockCredentials.delete.mockResolvedValue(undefined);

    render(<CredentialsSection />);

    await waitFor(() => screen.getByText('Delete'));

    const deleteButton = screen.getByText('Delete');
    fireEvent.click(deleteButton);

    await waitFor(() => {
      expect(mockCredentials.delete).toHaveBeenCalledWith('anthropic');
      expect(mockCredentials.list).toHaveBeenCalledTimes(2); // Initial + after delete
    });
  });

  it('displays error when store fails', async () => {
    mockCredentials.store.mockRejectedValue(new Error('Encryption failed'));

    render(<CredentialsSection />);

    await waitFor(() => screen.getByText('Anthropic'));

    const configureButtons = screen.getAllByText('Configure');
    fireEvent.click(configureButtons[0]);

    const input = screen.getByPlaceholderText(/Enter your Anthropic API key/);
    fireEvent.change(input, { target: { value: 'sk_test' } });

    const saveButton = screen.getByText('Save API Key');
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(screen.getByText('Encryption failed')).toBeInTheDocument();
    });
  });

  it('displays error when delete fails', async () => {
    mockCredentials.list.mockResolvedValue(['openai']);
    mockCredentials.delete.mockRejectedValue(new Error('Delete failed'));

    render(<CredentialsSection />);

    await waitFor(() => screen.getByText('Delete'));

    const deleteButton = screen.getByText('Delete');
    fireEvent.click(deleteButton);

    await waitFor(() => {
      expect(screen.getByText('Delete failed')).toBeInTheDocument();
    });
  });

  it('displays error when load fails', async () => {
    mockCredentials.list.mockRejectedValue(new Error('Network error'));

    render(<CredentialsSection />);

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });

  it('shows loading state initially', async () => {
    mockCredentials.list.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve([]), 100))
    );

    render(<CredentialsSection />);

    expect(screen.getByText('Loading credentials...')).toBeInTheDocument();

    await waitFor(
      () => {
        expect(screen.queryByText('Loading credentials...')).not.toBeInTheDocument();
      },
      { timeout: 200 }
    );
  });

  it('displays description text', async () => {
    render(<CredentialsSection />);

    await waitFor(() => {
      expect(
        screen.getByText(/Store API keys or use browser login to authenticate/)
      ).toBeInTheDocument();
    });
  });

  it('passes masked key to dialog', async () => {
    mockCredentials.list.mockResolvedValue(['anthropic']);
    mockCredentials.get.mockImplementation((service) => {
      if (service === 'anthropic') return Promise.resolve('sk_t**********cdef');
      return Promise.resolve(null);
    });

    render(<CredentialsSection />);

    await waitFor(() => screen.getByText('Update'));

    const updateButton = screen.getByText('Update');
    fireEvent.click(updateButton);

    await waitFor(() => {
      expect(screen.getByText('Current key:')).toBeInTheDocument();
      expect(screen.getAllByText('sk_t**********cdef')).toHaveLength(2); // In list and dialog
    });
  });

  it('clears error on successful operation', async () => {
    mockCredentials.list.mockRejectedValueOnce(new Error('Network error'));

    render(<CredentialsSection />);

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });

    // Retry should clear error
    mockCredentials.list.mockResolvedValue([]);
    mockCredentials.store.mockResolvedValue(undefined);

    const configureButtons = await screen.findAllByText('Configure');
    fireEvent.click(configureButtons[0]);

    const input = screen.getByPlaceholderText(/Enter your Anthropic API key/);
    fireEvent.change(input, { target: { value: 'sk_test' } });

    const saveButton = screen.getByText('Save API Key');
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(screen.queryByText('Network error')).not.toBeInTheDocument();
    });
  });
});
