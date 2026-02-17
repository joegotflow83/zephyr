import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import App from '../../src/renderer/App';

// Smoke test: verify the App component renders without crashing and displays
// the expected heading. This validates the Vitest + jsdom + React testing stack.
describe('App', () => {
  it('renders the Zephyr Desktop heading', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: /zephyr desktop/i })).toBeInTheDocument();
  });

  it('renders the subtitle text', () => {
    render(<App />);
    expect(screen.getByText(/ai loop execution manager/i)).toBeInTheDocument();
  });
});
