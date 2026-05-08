import type { ParsedLogLine } from '../components/LogViewer/LogViewer';

/**
 * Parses a raw log string into a ParsedLogLine for LogViewer rendering.
 * Detects commit hashes, plan headings, error/exception prefixes, and ISO timestamps.
 */
// Matches a full ISO 8601 timestamp at the start of a string, including optional
// fractional seconds and timezone offset (e.g. 2026-05-07T21:18:51-04:00).
const LEADING_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:\d{2})?\s*/;

export function parseLogLine(rawLine: string): ParsedLogLine {
  // Strip one or more leading ISO timestamps (e.g. docker prefix + agent prefix)
  let line = rawLine.trim();
  while (LEADING_TIMESTAMP_RE.test(line)) {
    line = line.replace(LEADING_TIMESTAMP_RE, '');
  }

  // Extract ISO timestamp from the original raw line (before stripping) for display
  const timestampMatch = rawLine.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:\d{2})?)/);
  const timestamp = timestampMatch ? timestampMatch[1] : null;

  // Detect commit lines
  const commitShortMatch = line.match(/\[[\w/.-]+\s+([0-9a-f]{7,40})\]/);
  const commitLongMatch = line.match(/(?:^|\s)commit\s+([0-9a-f]{7,40})\b/i);
  const commitCreatingMatch = line.match(/creating\s+commit\s+([0-9a-f]{7,40})/i);

  if (commitShortMatch || commitLongMatch || commitCreatingMatch) {
    const commit_hash =
      commitShortMatch?.[1] || commitLongMatch?.[1] || commitCreatingMatch?.[1];
    return { type: 'commit', content: line, timestamp, commit_hash };
  }

  // Detect plan lines
  if (/^\s*(?:PLAN|Plan)\s*:\s*/s.test(line)) {
    return { type: 'plan', content: line, timestamp };
  }

  // Detect error lines
  if (
    /^\s*Traceback\s+\(most recent call last\)/i.test(line) ||
    /^\s*(?:\w+\.)*\w*(?:Error|Exception|Failure|Fatal|Interrupt|Warning|NotFound|Refused|Timeout)\b.*:\s*/i.test(line)
  ) {
    return { type: 'error', content: line, timestamp };
  }

  return { type: 'info', content: line, timestamp };
}
