/**
 * Log parsing and commit detection for Zephyr Desktop.
 *
 * Classifies container log lines into types (commit, plan, error, info),
 * extracts commit hashes, and detects iteration boundaries from Ralph
 * loop output (e.g. bedrock_loop.sh).
 */

/**
 * Parsed log line result.
 */
export interface ParsedLogLine {
  /** Line type classification */
  type: 'commit' | 'plan' | 'error' | 'info';
  /** The meaningful content extracted from the line (stripped) */
  content: string;
  /** ISO timestamp found in the line, or null */
  timestamp: string | null;
  /** Commit hash (only present when type is 'commit') */
  commit_hash?: string;
}

/**
 * Parses individual log lines from Ralph loop container output.
 *
 * Classifies each line by type and extracts structured data such as
 * commit hashes, plan content, and iteration numbers.
 */
export class LogParser {
  // -- Commit patterns ----------------------------------------------------------
  // Match `git commit` short output: [branch hash] message
  private static readonly RE_COMMIT_SHORT = /\[[\w/.-]+\s+([0-9a-f]{7,40})\]/;
  // Match lines containing a bare 40-char or 7+ char hex hash after "commit"
  private static readonly RE_COMMIT_LONG = /(?:^|\s)commit\s+([0-9a-f]{7,40})\b/i;
  // Match "Creating commit <hash>" or similar Claude output
  private static readonly RE_COMMIT_CREATING = /creating\s+commit\s+([0-9a-f]{7,40})/i;

  private static readonly COMMIT_PATTERNS = [
    LogParser.RE_COMMIT_SHORT,
    LogParser.RE_COMMIT_LONG,
    LogParser.RE_COMMIT_CREATING,
  ];

  // -- Plan patterns ------------------------------------------------------------
  private static readonly RE_PLAN_PREFIX = /^\s*(?:PLAN|Plan)\s*:\s*(.*)/s;

  // -- Error patterns -----------------------------------------------------------
  private static readonly RE_TRACEBACK = /^\s*Traceback\s+\(most recent call last\)/i;
  private static readonly RE_EXCEPTION =
    /^\s*(?:\w+\.)*\w*(?:Error|Exception|Failure|Fatal|Interrupt|Warning|NotFound|Refused|Timeout)\b.*:\s*/i;
  private static readonly RE_ERROR_PREFIX = /^\s*(?:ERROR|Error|error)\s*[:\[]/i;
  private static readonly RE_PYTEST_FAIL = /^\s*(?:FAILED|ERRORS?)\s+/i;

  private static readonly ERROR_PATTERNS = [
    LogParser.RE_TRACEBACK,
    LogParser.RE_EXCEPTION,
    LogParser.RE_ERROR_PREFIX,
    LogParser.RE_PYTEST_FAIL,
  ];

  // -- Iteration boundary patterns ----------------------------------------------
  // bedrock_loop.sh: "======================== LOOP 3 ========================"
  private static readonly RE_LOOP_BOUNDARY = /^=+\s*LOOP\s+(\d+)\s*=+$/i;
  // Alternative: "iteration 3" or "Iteration: 3"
  private static readonly RE_ITERATION_BOUNDARY = /^\s*iteration\s*[:\s]+(\d+)/i;
  // "Running iteration 3..." (from bedrock_loop.sh line 51)
  private static readonly RE_RUNNING_ITERATION = /^\s*Running\s+iteration\s+(\d+)/i;

  // -- Timestamp extraction -----------------------------------------------------
  private static readonly RE_ISO_TIMESTAMP = /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/;

  /**
   * Classify a single log line and extract structured data.
   *
   * @param line - The raw log line to parse
   * @returns Parsed log line with type, content, timestamp, and optional commit_hash
   */
  parseLine(line: string): ParsedLogLine {
    const stripped = line.trim();
    const timestamp = this.extractTimestamp(line);

    // 1. Check for commit patterns
    for (const pattern of LogParser.COMMIT_PATTERNS) {
      const match = pattern.exec(stripped);
      if (match) {
        return {
          type: 'commit',
          content: stripped,
          timestamp,
          commit_hash: match[1],
        };
      }
    }

    // 2. Check for plan lines
    const planMatch = LogParser.RE_PLAN_PREFIX.exec(stripped);
    if (planMatch) {
      return {
        type: 'plan',
        content: planMatch[1].trim() || stripped,
        timestamp,
      };
    }

    // 3. Check for error patterns
    for (const pattern of LogParser.ERROR_PATTERNS) {
      if (pattern.test(stripped)) {
        return {
          type: 'error',
          content: stripped,
          timestamp,
        };
      }
    }

    // 4. Default to info
    return {
      type: 'info',
      content: stripped,
      timestamp,
    };
  }

  /**
   * Detect loop iteration boundary markers.
   *
   * Recognizes formats emitted by bedrock_loop.sh:
   * - `======================== LOOP 3 ========================`
   * - `Running iteration 3...`
   * - `iteration 3` / `Iteration: 3`
   *
   * @param line - The raw log line to check
   * @returns The iteration number if the line is a boundary, else null
   */
  parseIterationBoundary(line: string): number | null {
    const stripped = line.trim();

    for (const pattern of [
      LogParser.RE_LOOP_BOUNDARY,
      LogParser.RE_RUNNING_ITERATION,
      LogParser.RE_ITERATION_BOUNDARY,
    ]) {
      const match = pattern.exec(stripped);
      if (match) {
        return parseInt(match[1], 10);
      }
    }

    return null;
  }

  // -- Helpers ------------------------------------------------------------------

  /**
   * Extract the first ISO-8601-ish timestamp from a log line.
   *
   * @param line - The raw log line
   * @returns The timestamp string or null if not found
   */
  private extractTimestamp(line: string): string | null {
    const match = LogParser.RE_ISO_TIMESTAMP.exec(line);
    return match ? match[0] : null;
  }
}
