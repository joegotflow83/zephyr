// Extend Vitest's expect with @testing-library/jest-dom matchers.
// This gives us DOM-specific assertions like toBeInTheDocument(), toHaveClass(), etc.
import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock window.matchMedia — not implemented in jsdom (guard for Node.js test environments)
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}
