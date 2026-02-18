import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import App from '../../src/renderer/App';

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
});
