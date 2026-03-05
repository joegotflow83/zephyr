// Extend Vitest's expect with @testing-library/jest-dom matchers.
// This gives us DOM-specific assertions like toBeInTheDocument(), toHaveClass(), etc.
import '@testing-library/jest-dom';
import { beforeEach, vi } from 'vitest';

// Ensure real timers at the start of every test so vi.useFakeTimers() from a
// previous test cannot leak and block React's MessageChannel scheduler.
// Individual tests that need fake timers call vi.useFakeTimers() in their own
// beforeEach, which runs AFTER this global one.
beforeEach(() => {
  vi.useRealTimers();
});

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
