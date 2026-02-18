import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import App from '../../src/renderer/App';

beforeEach(() => {
  // Mock window.api for StatusBar, useActiveLoops, and useProjects
  global.window.api = {
    docker: {
      status: vi.fn().mockResolvedValue({
        available: true,
        info: { version: '24.0.7', containers: 0, images: 0 },
      }),
      onStatusChanged: vi.fn(() => vi.fn()),
    },
    loops: {
      list: vi.fn().mockResolvedValue([]),
      onStateChanged: vi.fn(() => vi.fn()),
    },
    projects: {
      list: vi.fn().mockResolvedValue([]),
    },
    settings: {
      load: vi.fn().mockResolvedValue({
        max_concurrent_containers: 5,
        notification_enabled: true,
        theme: 'system',
        log_level: 'INFO',
      }),
    },
  } as any;
});

// Smoke test: verify the App component renders without crashing and displays
// the expected tab navigation. This validates the Vitest + jsdom + React testing stack.
describe('App', () => {
  it('renders the tab navigation', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: /projects/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /running loops/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /terminal/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /settings/i })).toBeInTheDocument();
  });

  it('renders the Projects tab content by default', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: /projects/i })).toBeInTheDocument();
  });

  it('renders the StatusBar component', () => {
    render(<App />);
    // StatusBar should be present (check for Docker status text - always shown)
    expect(screen.getByText(/Docker (Connected|Disconnected)/i)).toBeInTheDocument();
  });
});
