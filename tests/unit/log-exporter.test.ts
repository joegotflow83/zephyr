/**
 * @vitest-environment node
 * Tests for LogExporter service
 * Uses node environment for proper file system operations
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LogExporter } from '../../src/services/log-exporter';
import { LoopStatus, LoopMode, createLoopState } from '../../src/shared/loop-types';
import type { LoopState } from '../../src/shared/loop-types';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import AdmZip from 'adm-zip';

describe('LogExporter', () => {
  let exporter: LogExporter;
  let tempDir: string;

  beforeEach(() => {
    exporter = new LogExporter();
    // Create temp directory for test outputs
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'log-exporter-test-'));
  });

  afterEach(() => {
    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // Helper to create a mock LoopState
  function createMockLoopState(
    projectId: string,
    logs: string[] = [],
    overrides: Partial<LoopState> = {}
  ): LoopState {
    return {
      ...createLoopState(projectId),
      logs,
      startedAt: new Date().toISOString(),
      status: LoopStatus.RUNNING,
      mode: LoopMode.CONTINUOUS,
      ...overrides,
    };
  }

  describe('exportLoopLog - text format', () => {
    it('should export logs as plain text with metadata', async () => {
      const loopState = createMockLoopState('test-project', [
        'Line 1: Starting loop',
        'Line 2: Processing...',
        'Line 3: Completed',
      ]);

      const outputPath = path.join(tempDir, 'test-export.txt');
      await exporter.exportLoopLog(loopState, outputPath, { format: 'text', includeMetadata: true });

      expect(fs.existsSync(outputPath)).toBe(true);

      const content = fs.readFileSync(outputPath, 'utf-8');
      expect(content).toContain('Project: test-project');
      expect(content).toContain('Status: running');
      expect(content).toContain('Mode: continuous');
      expect(content).toContain('Line 1: Starting loop');
      expect(content).toContain('Line 2: Processing...');
      expect(content).toContain('Line 3: Completed');
    });

    it('should export logs without metadata when includeMetadata is false', async () => {
      const loopState = createMockLoopState('test-project', ['Log line 1', 'Log line 2']);

      const outputPath = path.join(tempDir, 'test-no-metadata.txt');
      await exporter.exportLoopLog(loopState, outputPath, {
        format: 'text',
        includeMetadata: false,
      });

      const content = fs.readFileSync(outputPath, 'utf-8');
      expect(content).not.toContain('Project:');
      expect(content).not.toContain('Status:');
      expect(content).toContain('Log line 1');
      expect(content).toContain('Log line 2');
    });

    it('should handle empty logs', async () => {
      const loopState = createMockLoopState('empty-project', []);

      const outputPath = path.join(tempDir, 'empty-logs.txt');
      await exporter.exportLoopLog(loopState, outputPath, { format: 'text' });

      expect(fs.existsSync(outputPath)).toBe(true);
      const content = fs.readFileSync(outputPath, 'utf-8');
      expect(content).toContain('Project: empty-project');
    });

    it('should handle special characters in logs', async () => {
      const loopState = createMockLoopState('special-chars', [
        'Line with "quotes"',
        "Line with 'apostrophes'",
        'Line with <HTML> tags',
        'Line with emoji 🚀',
      ]);

      const outputPath = path.join(tempDir, 'special-chars.txt');
      await exporter.exportLoopLog(loopState, outputPath, { format: 'text' });

      const content = fs.readFileSync(outputPath, 'utf-8');
      expect(content).toContain('Line with "quotes"');
      expect(content).toContain("Line with 'apostrophes'");
      expect(content).toContain('Line with <HTML> tags');
      expect(content).toContain('Line with emoji 🚀');
    });

    it('should include iteration, commit, and error counts', async () => {
      const loopState = createMockLoopState('metrics-project', ['log line'], {
        iteration: 5,
        commits: ['abc1234', 'def5678', 'ghi9012'],
        errors: 2,
      });

      const outputPath = path.join(tempDir, 'metrics.txt');
      await exporter.exportLoopLog(loopState, outputPath, { format: 'text' });

      const content = fs.readFileSync(outputPath, 'utf-8');
      expect(content).toContain('Iteration: 5');
      expect(content).toContain('Commits: 3');
      expect(content).toContain('Errors: 2');
    });
  });

  describe('exportLoopLog - JSON format', () => {
    it('should export logs as JSON with metadata', async () => {
      const loopState = createMockLoopState('json-project', ['Log 1', 'Log 2']);

      const outputPath = path.join(tempDir, 'test-export.json');
      await exporter.exportLoopLog(loopState, outputPath, { format: 'json', includeMetadata: true });

      expect(fs.existsSync(outputPath)).toBe(true);

      const content = fs.readFileSync(outputPath, 'utf-8');
      const parsed = JSON.parse(content);
      expect(parsed.projectId).toBe('json-project');
      expect(parsed.status).toBe(LoopStatus.RUNNING);
      expect(parsed.mode).toBe(LoopMode.CONTINUOUS);
      expect(parsed.logs).toEqual(['Log 1', 'Log 2']);
    });

    it('should export JSON without metadata when includeMetadata is false', async () => {
      const loopState = createMockLoopState('json-minimal', ['Log A', 'Log B']);

      const outputPath = path.join(tempDir, 'minimal.json');
      await exporter.exportLoopLog(loopState, outputPath, {
        format: 'json',
        includeMetadata: false,
      });

      const content = fs.readFileSync(outputPath, 'utf-8');
      const parsed = JSON.parse(content);
      expect(parsed).toEqual({ logs: ['Log A', 'Log B'] });
      expect(parsed.projectId).toBeUndefined();
      expect(parsed.status).toBeUndefined();
    });

    it('should produce valid JSON with proper formatting', async () => {
      const loopState = createMockLoopState('formatted-json', ['Line 1']);

      const outputPath = path.join(tempDir, 'formatted.json');
      await exporter.exportLoopLog(loopState, outputPath, { format: 'json' });

      const content = fs.readFileSync(outputPath, 'utf-8');
      // Should be pretty-printed (indented)
      expect(content).toContain('\n');
      expect(content).toContain('  '); // Indentation
      expect(() => JSON.parse(content)).not.toThrow();
    });
  });

  describe('exportAllLogs', () => {
    it('should export multiple logs to a zip file', async () => {
      const loopStates: LoopState[] = [
        createMockLoopState('project-1', ['Log 1A', 'Log 1B']),
        createMockLoopState('project-2', ['Log 2A', 'Log 2B']),
        createMockLoopState('project-3', ['Log 3A']),
      ];

      const outputPath = path.join(tempDir, 'all-logs.zip');
      await exporter.exportAllLogs(loopStates, outputPath, { format: 'text' });

      expect(fs.existsSync(outputPath)).toBe(true);

      // Verify zip contents
      const zip = new AdmZip(outputPath);
      const entries = zip.getEntries();
      expect(entries.length).toBeGreaterThanOrEqual(4); // 3 logs + 1 summary

      // Check for summary.txt
      const summaryEntry = entries.find((e) => e.entryName === 'summary.txt');
      expect(summaryEntry).toBeDefined();
      const summaryContent = summaryEntry!.getData().toString('utf-8');
      expect(summaryContent).toContain('ZEPHYR LOOP LOGS EXPORT SUMMARY');
      expect(summaryContent).toContain('Total Loops: 3');

      // Check for individual log files
      const logEntries = entries.filter((e) => e.entryName.endsWith('.txt') && e.entryName !== 'summary.txt');
      expect(logEntries.length).toBe(3);
    });

    it('should export all logs in JSON format', async () => {
      const loopStates: LoopState[] = [
        createMockLoopState('json-project-1', ['JSON Log 1']),
        createMockLoopState('json-project-2', ['JSON Log 2']),
      ];

      const outputPath = path.join(tempDir, 'all-logs-json.zip');
      await exporter.exportAllLogs(loopStates, outputPath, { format: 'json' });

      expect(fs.existsSync(outputPath)).toBe(true);

      const zip = new AdmZip(outputPath);
      const entries = zip.getEntries();
      const jsonEntries = entries.filter((e) => e.entryName.endsWith('.json'));
      expect(jsonEntries.length).toBe(2);

      // Verify each JSON file is valid
      jsonEntries.forEach((entry) => {
        const content = entry.getData().toString('utf-8');
        expect(() => JSON.parse(content)).not.toThrow();
      });
    });

    it('should generate safe filenames from project IDs', async () => {
      const loopStates: LoopState[] = [
        createMockLoopState('project-with-spaces and/slashes', ['Log']),
        createMockLoopState('project@#$%special', ['Log']),
      ];

      const outputPath = path.join(tempDir, 'safe-names.zip');
      await exporter.exportAllLogs(loopStates, outputPath, { format: 'text' });

      const zip = new AdmZip(outputPath);
      const entries = zip.getEntries();
      const logEntries = entries.filter((e) => e.entryName.endsWith('.txt') && e.entryName !== 'summary.txt');

      // All filenames should be safe (no spaces, slashes, special chars)
      logEntries.forEach((entry) => {
        expect(entry.entryName).toMatch(/^[a-zA-Z0-9_-]+\.txt$/);
      });
    });

    it('should include status breakdown in summary', async () => {
      const loopStates: LoopState[] = [
        createMockLoopState('project-1', ['log'], { status: LoopStatus.RUNNING }),
        createMockLoopState('project-2', ['log'], { status: LoopStatus.COMPLETED }),
        createMockLoopState('project-3', ['log'], { status: LoopStatus.FAILED }),
        createMockLoopState('project-4', ['log'], { status: LoopStatus.RUNNING }),
      ];

      const outputPath = path.join(tempDir, 'summary-test.zip');
      await exporter.exportAllLogs(loopStates, outputPath, { format: 'text' });

      const zip = new AdmZip(outputPath);
      const summaryEntry = zip.getEntry('summary.txt');
      const summaryContent = summaryEntry!.getData().toString('utf-8');

      expect(summaryContent).toContain('Status Breakdown:');
      expect(summaryContent).toContain('running: 2');
      expect(summaryContent).toContain('completed: 1');
      expect(summaryContent).toContain('failed: 1');
    });

    it('should list all loop details in summary', async () => {
      const loopStates: LoopState[] = [
        createMockLoopState('detailed-project-1', ['log1', 'log2'], {
          iteration: 3,
          commits: ['a', 'b', 'c', 'd', 'e'],
          errors: 1,
        }),
        createMockLoopState('detailed-project-2', ['log'], {
          iteration: 1,
          commits: [],
          errors: 2,
        }),
      ];

      const outputPath = path.join(tempDir, 'details-test.zip');
      await exporter.exportAllLogs(loopStates, outputPath, { format: 'text' });

      const zip = new AdmZip(outputPath);
      const summaryEntry = zip.getEntry('summary.txt');
      const summaryContent = summaryEntry!.getData().toString('utf-8');

      expect(summaryContent).toContain('Loop Details:');
      expect(summaryContent).toContain('Project: detailed-project-1');
      expect(summaryContent).toContain('Iteration: 3');
      expect(summaryContent).toContain('Commits: 5');
      expect(summaryContent).toContain('Errors: 1');
      expect(summaryContent).toContain('Log Lines: 2');
      expect(summaryContent).toContain('Project: detailed-project-2');
    });
  });

  describe('error handling', () => {
    it('should throw error for unsupported format', async () => {
      const loopState = createMockLoopState('test', ['log']);
      const outputPath = path.join(tempDir, 'unsupported.txt');

      await expect(
        exporter.exportLoopLog(loopState, outputPath, { format: 'xml' as any })
      ).rejects.toThrow('Unsupported export format: xml');
    });

    it('should handle invalid output path gracefully', async () => {
      const loopState = createMockLoopState('test', ['log']);
      const invalidPath = '/nonexistent/directory/file.txt';

      await expect(
        exporter.exportLoopLog(loopState, invalidPath, { format: 'text' })
      ).rejects.toThrow();
    });
  });

  describe('timestamp formatting', () => {
    it('should format timestamps correctly in exported files', async () => {
      const now = Date.now();
      const loopState = createMockLoopState('timestamp-test', ['log'], {
        startedAt: now,
        completedAt: now + 60000, // 1 minute later
      });

      const outputPath = path.join(tempDir, 'timestamps.txt');
      await exporter.exportLoopLog(loopState, outputPath, { format: 'text' });

      const content = fs.readFileSync(outputPath, 'utf-8');
      expect(content).toContain('Started:');
      expect(content).toContain('Completed:');
      expect(content).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/); // ISO format
    });

    it('should handle missing timestamps', async () => {
      const loopState = createMockLoopState('no-timestamps', ['log'], {
        startedAt: undefined,
        completedAt: undefined,
      });

      const outputPath = path.join(tempDir, 'no-timestamps.txt');
      await exporter.exportLoopLog(loopState, outputPath, { format: 'text' });

      const content = fs.readFileSync(outputPath, 'utf-8');
      expect(content).toContain('Started: N/A');
      expect(content).toContain('Completed: N/A');
    });
  });
});
