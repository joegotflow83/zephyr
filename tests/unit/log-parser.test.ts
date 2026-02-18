/**
 * Unit tests for LogParser service.
 * Ported from Python test_log_parser.py (commit cbe143e).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { LogParser, ParsedLogLine } from '../../src/services/log-parser';

describe('LogParser', () => {
  let parser: LogParser;

  beforeEach(() => {
    parser = new LogParser();
  });

  // =============================================================================
  // Commit Detection Tests
  // =============================================================================

  describe('parseLine - commit detection', () => {
    it('should detect git commit short format', () => {
      const line = '[master abc1234] Add feature X';
      const result = parser.parseLine(line);

      expect(result.type).toBe('commit');
      expect(result.commit_hash).toBe('abc1234');
      expect(result.content).toBe(line);
      expect(result.timestamp).toBeNull();
    });

    it('should detect git commit with full 40-char hash', () => {
      const line = 'commit a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
      const result = parser.parseLine(line);

      expect(result.type).toBe('commit');
      expect(result.commit_hash).toBe('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2');
      expect(result.content).toBe(line);
      expect(result.timestamp).toBeNull();
    });

    it('should detect git commit with branch containing slash', () => {
      const line = '[feature/new-ui 9f8e7d6] Implement settings tab';
      const result = parser.parseLine(line);

      expect(result.type).toBe('commit');
      expect(result.commit_hash).toBe('9f8e7d6');
      expect(result.content).toBe(line);
    });

    it('should detect "Creating commit" pattern', () => {
      const line = 'Creating commit deadbeef in branch main';
      const result = parser.parseLine(line);

      expect(result.type).toBe('commit');
      expect(result.commit_hash).toBe('deadbeef');
      expect(result.content).toBe(line);
    });

    it('should preserve full line as content for commits', () => {
      const line = '  [master 1a2b3c4] Commit message with spaces  ';
      const result = parser.parseLine(line);

      expect(result.type).toBe('commit');
      expect(result.content).toBe('[master 1a2b3c4] Commit message with spaces');
    });

    it('should extract timestamp from commit line', () => {
      const line = '2025-03-15T10:30:00 commit abcdef1234567';
      const result = parser.parseLine(line);

      expect(result.type).toBe('commit');
      expect(result.commit_hash).toBe('abcdef1234567');
      expect(result.timestamp).toBe('2025-03-15T10:30:00');
    });

    it('should handle commit without timestamp', () => {
      const line = '[main f00bae7] No timestamp here';
      const result = parser.parseLine(line);

      expect(result.type).toBe('commit');
      expect(result.timestamp).toBeNull();
    });

    it('should require minimum 7-char hash', () => {
      const line = '[master abc1234] Seven char hash';
      const result = parser.parseLine(line);

      expect(result.type).toBe('commit');
      expect(result.commit_hash).toBe('abc1234');
    });
  });

  // =============================================================================
  // Plan Detection Tests
  // =============================================================================

  describe('parseLine - plan detection', () => {
    it('should detect plan with uppercase prefix', () => {
      const line = 'PLAN: Refactor the authentication module';
      const result = parser.parseLine(line);

      expect(result.type).toBe('plan');
      expect(result.content).toBe('Refactor the authentication module');
      expect(result.timestamp).toBeNull();
    });

    it('should detect plan with title case prefix', () => {
      const line = 'Plan: Add validation to user input';
      const result = parser.parseLine(line);

      expect(result.type).toBe('plan');
      expect(result.content).toBe('Add validation to user input');
    });

    it('should handle plan with leading whitespace', () => {
      const line = '   PLAN: Implement caching layer';
      const result = parser.parseLine(line);

      expect(result.type).toBe('plan');
      expect(result.content).toBe('Implement caching layer');
    });

    it('should handle plan with empty content', () => {
      const line = 'PLAN:';
      const result = parser.parseLine(line);

      expect(result.type).toBe('plan');
      expect(result.content).toBe('PLAN:');
    });

    it('should handle plan with colon but no space', () => {
      const line = 'PLAN:do something';
      const result = parser.parseLine(line);

      expect(result.type).toBe('plan');
      expect(result.content).toBe('do something');
    });

    it('should extract timestamp from plan line', () => {
      const line = 'PLAN: 2025-03-15 14:30:45 Update dependencies';
      const result = parser.parseLine(line);

      expect(result.type).toBe('plan');
      expect(result.timestamp).toBe('2025-03-15 14:30:45');
    });
  });

  // =============================================================================
  // Error Detection Tests
  // =============================================================================

  describe('parseLine - error detection', () => {
    it('should detect Python traceback', () => {
      const line = 'Traceback (most recent call last):';
      const result = parser.parseLine(line);

      expect(result.type).toBe('error');
      expect(result.content).toBe(line);
    });

    it('should detect named exception', () => {
      const line = 'ValueError: invalid literal for int() with base 10';
      const result = parser.parseLine(line);

      expect(result.type).toBe('error');
      expect(result.content).toBe(line);
    });

    it('should detect module-qualified exception', () => {
      const line = 'docker.errors.NotFound: 404 Client Error: container not found';
      const result = parser.parseLine(line);

      expect(result.type).toBe('error');
      expect(result.content).toBe(line);
    });

    it('should detect ERROR prefix with colon', () => {
      const line = 'ERROR: container failed to start';
      const result = parser.parseLine(line);

      expect(result.type).toBe('error');
      expect(result.content).toBe(line);
    });

    it('should detect ERROR prefix with bracket', () => {
      const line = 'ERROR[2025-01-01] something went wrong';
      const result = parser.parseLine(line);

      expect(result.type).toBe('error');
      expect(result.content).toBe(line);
    });

    it('should detect pytest FAILED', () => {
      const line = 'FAILED tests/test_foo.py::test_bar - AssertionError';
      const result = parser.parseLine(line);

      expect(result.type).toBe('error');
      expect(result.content).toBe(line);
    });

    it('should detect RuntimeError', () => {
      const line = 'RuntimeError: event loop is closed';
      const result = parser.parseLine(line);

      expect(result.type).toBe('error');
      expect(result.content).toBe(line);
    });

    it('should detect OSError', () => {
      const line = 'OSError: [Errno 28] No space left on device';
      const result = parser.parseLine(line);

      expect(result.type).toBe('error');
      expect(result.content).toBe(line);
    });

    it('should detect Fatal error', () => {
      const line = 'Fatal: repository not found';
      const result = parser.parseLine(line);

      expect(result.type).toBe('error');
      expect(result.content).toBe(line);
    });

    it('should detect indented traceback', () => {
      const line = '  Traceback (most recent call last):';
      const result = parser.parseLine(line);

      expect(result.type).toBe('error');
      expect(result.content).toBe('Traceback (most recent call last):');
    });

    it('should detect AssertionError', () => {
      const line = 'AssertionError: expected 5 but got 3';
      const result = parser.parseLine(line);

      expect(result.type).toBe('error');
      expect(result.content).toBe(line);
    });

    it('should detect KeyboardInterrupt', () => {
      const line = 'KeyboardInterrupt: ';
      const result = parser.parseLine(line);

      expect(result.type).toBe('error');
      expect(result.content).toBe('KeyboardInterrupt:');
    });
  });

  // =============================================================================
  // Info/Default Classification Tests
  // =============================================================================

  describe('parseLine - info/default classification', () => {
    it('should classify plain text as info', () => {
      const line = 'This is just regular output';
      const result = parser.parseLine(line);

      expect(result.type).toBe('info');
      expect(result.content).toBe(line);
      expect(result.timestamp).toBeNull();
    });

    it('should classify empty line as info', () => {
      const line = '';
      const result = parser.parseLine(line);

      expect(result.type).toBe('info');
      expect(result.content).toBe('');
    });

    it('should classify whitespace-only line as info', () => {
      const line = '   \t  ';
      const result = parser.parseLine(line);

      expect(result.type).toBe('info');
      expect(result.content).toBe('');
    });

    it('should classify docker output as info', () => {
      const line = 'Step 1/5 : FROM ubuntu:20.04';
      const result = parser.parseLine(line);

      expect(result.type).toBe('info');
      expect(result.content).toBe(line);
    });

    it('should classify progress bar as info', () => {
      const line = '[=====>    ] 50% complete';
      const result = parser.parseLine(line);

      expect(result.type).toBe('info');
      expect(result.content).toBe(line);
    });

    it('should classify separator line as info', () => {
      const line = '----------------------------------------';
      const result = parser.parseLine(line);

      expect(result.type).toBe('info');
      expect(result.content).toBe(line);
    });
  });

  // =============================================================================
  // Timestamp Extraction Tests
  // =============================================================================

  describe('parseLine - timestamp extraction', () => {
    it('should extract ISO timestamp with T separator', () => {
      const line = '2025-03-15T14:30:45 some log message';
      const result = parser.parseLine(line);

      expect(result.timestamp).toBe('2025-03-15T14:30:45');
    });

    it('should extract ISO timestamp with space separator', () => {
      const line = '2025-03-15 14:30:45 some log message';
      const result = parser.parseLine(line);

      expect(result.timestamp).toBe('2025-03-15 14:30:45');
    });

    it('should return null when no timestamp present', () => {
      const line = 'No timestamp in this line';
      const result = parser.parseLine(line);

      expect(result.timestamp).toBeNull();
    });

    it('should extract timestamp embedded in middle of line', () => {
      const line = 'prefix 2025-03-15T14:30:45 suffix';
      const result = parser.parseLine(line);

      expect(result.timestamp).toBe('2025-03-15T14:30:45');
    });
  });

  // =============================================================================
  // Iteration Boundary Detection Tests
  // =============================================================================

  describe('parseIterationBoundary', () => {
    it('should detect bedrock_loop.sh format', () => {
      const line = '======================== LOOP 3 ========================';
      const result = parser.parseIterationBoundary(line);

      expect(result).toBe(3);
    });

    it('should detect LOOP 1', () => {
      const line = '======================== LOOP 1 ========================';
      const result = parser.parseIterationBoundary(line);

      expect(result).toBe(1);
    });

    it('should detect large loop numbers', () => {
      const line = '======================== LOOP 999 ========================';
      const result = parser.parseIterationBoundary(line);

      expect(result).toBe(999);
    });

    it('should detect loop with fewer equals signs', () => {
      const line = '==== LOOP 5 ====';
      const result = parser.parseIterationBoundary(line);

      expect(result).toBe(5);
    });

    it('should detect "Running iteration" format', () => {
      const line = 'Running iteration 7...';
      const result = parser.parseIterationBoundary(line);

      expect(result).toBe(7);
    });

    it('should detect "iteration:" with colon', () => {
      const line = 'iteration: 12';
      const result = parser.parseIterationBoundary(line);

      expect(result).toBe(12);
    });

    it('should detect "Iteration" with space', () => {
      const line = 'Iteration 4';
      const result = parser.parseIterationBoundary(line);

      expect(result).toBe(4);
    });

    it('should return null for non-boundary text', () => {
      const line = 'Just some regular log output';
      const result = parser.parseIterationBoundary(line);

      expect(result).toBeNull();
    });

    it('should return null for empty line', () => {
      const line = '';
      const result = parser.parseIterationBoundary(line);

      expect(result).toBeNull();
    });

    it('should return null for partial match', () => {
      const line = 'LOOPING forever';
      const result = parser.parseIterationBoundary(line);

      expect(result).toBeNull();
    });

    it('should be case insensitive for LOOP keyword', () => {
      const line = '======================== loop 2 ========================';
      const result = parser.parseIterationBoundary(line);

      expect(result).toBe(2);
    });

    it('should handle leading whitespace', () => {
      const line = '   Running iteration 8...';
      const result = parser.parseIterationBoundary(line);

      expect(result).toBe(8);
    });

    it('should handle trailing newline', () => {
      const line = '======================== LOOP 10 ========================\n';
      const result = parser.parseIterationBoundary(line);

      expect(result).toBe(10);
    });
  });

  // =============================================================================
  // Edge Cases & Integration Tests
  // =============================================================================

  describe('edge cases and integration', () => {
    it('should prioritize commit over info', () => {
      const line = '[main abc1234] Some message';
      const result = parser.parseLine(line);

      expect(result.type).toBe('commit');
      expect(result.commit_hash).toBe('abc1234');
    });

    it('should prioritize commit over error patterns', () => {
      const line = '[main deadbeef] ERROR: fixed bug in error handling';
      const result = parser.parseLine(line);

      expect(result.type).toBe('commit');
      expect(result.commit_hash).toBe('deadbeef');
    });

    it('should prioritize plan over error keywords', () => {
      const line = 'PLAN: Fix the error handling module';
      const result = parser.parseLine(line);

      expect(result.type).toBe('plan');
    });

    it('should handle multiline simulation sequence', () => {
      const lines = [
        '======================== LOOP 1 ========================',
        'PLAN: Implement authentication',
        'Running tests...',
        '[main abc1234] Add auth module',
        'ERROR: test_auth failed',
        'PLAN: Fix auth tests',
        '[main def5678] Fix auth tests',
        'All tests passed',
      ];

      const results = lines.map((line) => parser.parseLine(line));

      expect(results[0].type).toBe('info'); // boundary is not classified by parseLine
      expect(results[1].type).toBe('plan');
      expect(results[2].type).toBe('info');
      expect(results[3].type).toBe('commit');
      expect(results[4].type).toBe('error');
      expect(results[5].type).toBe('plan');
      expect(results[6].type).toBe('commit');
      expect(results[7].type).toBe('info');
    });

    it('should not treat random hex as commit', () => {
      const line = 'deadbeef is a hex word';
      const result = parser.parseLine(line);

      expect(result.type).toBe('info');
      expect(result.commit_hash).toBeUndefined();
    });

    it('should handle very long lines', () => {
      const line = 'x'.repeat(10000);
      const result = parser.parseLine(line);

      expect(result.type).toBe('info');
      expect(result.content).toBe(line);
    });

    it('should only include commit_hash field on commit types', () => {
      const commitResult = parser.parseLine('[main abc1234] Commit message');
      const infoResult = parser.parseLine('Regular info line');

      expect(commitResult.commit_hash).toBeDefined();
      expect(infoResult.commit_hash).toBeUndefined();
    });

    it('should always return dict with required keys', () => {
      const lines = [
        '[main abc1234] Commit',
        'PLAN: Do something',
        'ERROR: Something failed',
        'Regular info',
      ];

      lines.forEach((line) => {
        const result = parser.parseLine(line);
        expect(result).toHaveProperty('type');
        expect(result).toHaveProperty('content');
        expect(result).toHaveProperty('timestamp');
        expect(['commit', 'plan', 'error', 'info']).toContain(result.type);
      });
    });

    it('should properly strip and preserve newlines', () => {
      const line = '  [main abc1234] Message  \n';
      const result = parser.parseLine(line);

      expect(result.content).toBe('[main abc1234] Message');
    });
  });
});
