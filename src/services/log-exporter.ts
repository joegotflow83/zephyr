/**
 * LogExporter service
 * Exports loop logs to various formats (text, JSON)
 */

import * as fs from 'fs';
import archiver from 'archiver';
import type { LoopState } from '../shared/loop-types';

export interface ExportOptions {
  format: 'text' | 'json';
  includeMetadata?: boolean;
}

export class LogExporter {
  /**
   * Export a single loop's logs to a file
   */
  async exportLoopLog(
    loopState: LoopState,
    outputPath: string,
    options: ExportOptions = { format: 'text', includeMetadata: true }
  ): Promise<void> {
    const { format, includeMetadata } = options;

    if (format === 'text') {
      await this.exportAsText(loopState, outputPath, includeMetadata);
    } else if (format === 'json') {
      await this.exportAsJson(loopState, outputPath, includeMetadata);
    } else {
      throw new Error(`Unsupported export format: ${format}`);
    }
  }

  /**
   * Export all loop logs to a zip file
   */
  async exportAllLogs(
    loopStates: LoopState[],
    outputPath: string,
    options: ExportOptions = { format: 'text', includeMetadata: true }
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(outputPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', () => resolve());
      archive.on('error', (err) => reject(err));

      archive.pipe(output);

      // Add each loop's logs to the archive
      for (const loopState of loopStates) {
        const fileName = this.generateFileName(loopState, options.format);
        const content =
          options.format === 'text'
            ? this.formatAsText(loopState, options.includeMetadata)
            : JSON.stringify(this.formatAsJson(loopState, options.includeMetadata), null, 2);

        archive.append(content, { name: fileName });
      }

      // Add summary file
      const summary = this.generateSummary(loopStates);
      archive.append(summary, { name: 'summary.txt' });

      archive.finalize();
    });
  }

  /**
   * Export logs as plain text
   */
  private async exportAsText(
    loopState: LoopState,
    outputPath: string,
    includeMetadata = true
  ): Promise<void> {
    const content = this.formatAsText(loopState, includeMetadata);
    await fs.promises.writeFile(outputPath, content, 'utf-8');
  }

  /**
   * Export logs as JSON
   */
  private async exportAsJson(
    loopState: LoopState,
    outputPath: string,
    includeMetadata = true
  ): Promise<void> {
    const data = this.formatAsJson(loopState, includeMetadata);
    await fs.promises.writeFile(outputPath, JSON.stringify(data, null, 2), 'utf-8');
  }

  /**
   * Format loop state as plain text
   */
  private formatAsText(loopState: LoopState, includeMetadata: boolean): string {
    const lines: string[] = [];

    if (includeMetadata) {
      lines.push('='.repeat(80));
      lines.push(`Project: ${loopState.projectId}`);
      lines.push(`Status: ${loopState.status}`);
      lines.push(`Mode: ${loopState.mode}`);
      lines.push(`Container: ${loopState.containerId || 'N/A'}`);
      lines.push(`Started: ${loopState.startedAt ? new Date(loopState.startedAt).toISOString() : 'N/A'}`);
      lines.push(`Completed: ${loopState.completedAt ? new Date(loopState.completedAt).toISOString() : 'N/A'}`);
      lines.push(`Iteration: ${loopState.currentIteration}`);
      lines.push(`Commits: ${loopState.commitCount}`);
      lines.push(`Errors: ${loopState.errorCount}`);
      lines.push('='.repeat(80));
      lines.push('');
    }

    // Add log lines
    lines.push(...loopState.logs);

    return lines.join('\n');
  }

  /**
   * Format loop state as JSON
   */
  private formatAsJson(loopState: LoopState, includeMetadata: boolean): object {
    if (includeMetadata) {
      return {
        projectId: loopState.projectId,
        status: loopState.status,
        mode: loopState.mode,
        containerId: loopState.containerId,
        startedAt: loopState.startedAt,
        completedAt: loopState.completedAt,
        currentIteration: loopState.currentIteration,
        commitCount: loopState.commitCount,
        errorCount: loopState.errorCount,
        logs: loopState.logs,
      };
    } else {
      return {
        logs: loopState.logs,
      };
    }
  }

  /**
   * Generate a safe filename for a loop's logs
   */
  private generateFileName(loopState: LoopState, format: 'text' | 'json'): string {
    const projectId = loopState.projectId.replace(/[^a-zA-Z0-9-_]/g, '_');
    const timestamp = loopState.startedAt
      ? new Date(loopState.startedAt).toISOString().replace(/[:.]/g, '-')
      : 'unknown';
    const ext = format === 'text' ? 'txt' : 'json';
    return `${projectId}_${timestamp}.${ext}`;
  }

  /**
   * Generate summary of all loops
   */
  private generateSummary(loopStates: LoopState[]): string {
    const lines: string[] = [];

    lines.push('='.repeat(80));
    lines.push('ZEPHYR LOOP LOGS EXPORT SUMMARY');
    lines.push('='.repeat(80));
    lines.push('');
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push(`Total Loops: ${loopStates.length}`);
    lines.push('');

    // Group by status
    const statusCounts = loopStates.reduce((acc, loop) => {
      acc[loop.status] = (acc[loop.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    lines.push('Status Breakdown:');
    for (const [status, count] of Object.entries(statusCounts)) {
      lines.push(`  ${status}: ${count}`);
    }
    lines.push('');

    // List all loops
    lines.push('Loop Details:');
    lines.push('-'.repeat(80));
    for (const loop of loopStates) {
      lines.push(`Project: ${loop.projectId}`);
      lines.push(`  Status: ${loop.status}`);
      lines.push(`  Mode: ${loop.mode}`);
      lines.push(`  Started: ${loop.startedAt ? new Date(loop.startedAt).toISOString() : 'N/A'}`);
      lines.push(`  Iteration: ${loop.currentIteration}`);
      lines.push(`  Commits: ${loop.commitCount}`);
      lines.push(`  Errors: ${loop.errorCount}`);
      lines.push(`  Log Lines: ${loop.logs.length}`);
      lines.push('');
    }

    return lines.join('\n');
  }
}
