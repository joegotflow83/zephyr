/**
 * Loop scheduling service for Zephyr Desktop.
 *
 * LoopScheduler manages recurring loop executions based on schedule expressions.
 * Supports minute-based intervals, hourly intervals, and daily fixed-time schedules.
 */

import type { LoopRunner } from './loop-runner';
import type { LoopStartOpts } from '../shared/loop-types';
import { LoopMode } from '../shared/loop-types';

/**
 * Parsed schedule configuration.
 */
export interface ScheduleConfig {
  /** Interval in milliseconds, or null for daily fixed-time schedules */
  intervalMs: number | null;

  /** For daily schedules: hour (0-23) */
  dailyHour?: number;

  /** For daily schedules: minute (0-59) */
  dailyMinute?: number;

  /** Original expression string */
  expression: string;
}

/**
 * Active scheduled loop entry.
 */
export interface ScheduledLoop {
  /** Project ID being scheduled */
  projectId: string;

  /** Schedule configuration */
  schedule: ScheduleConfig;

  /** Loop start options used for each trigger */
  loopOpts: Omit<LoopStartOpts, 'mode'>;

  /** Timer ID (NodeJS.Timeout or NodeJS.Timer) */
  timerId: NodeJS.Timeout | null;

  /** ISO 8601 timestamp of next scheduled run */
  nextRun: string | null;
}

/**
 * Manages scheduled loop executions.
 *
 * Responsibilities:
 * - Parse schedule expressions into timer configurations
 * - Schedule loops to run at intervals or fixed times
 * - Trigger LoopRunner.startLoop() with mode=SINGLE at scheduled times
 * - Manage active timers and cancellation
 */
export class LoopScheduler {
  private loopRunner: LoopRunner;
  private schedules: Map<string, ScheduledLoop> = new Map();

  constructor(loopRunner: LoopRunner) {
    this.loopRunner = loopRunner;
  }

  /**
   * Parse a schedule expression into a ScheduleConfig.
   *
   * Supported formats:
   * - Minute intervals: every N minutes
   * - Hour intervals: every N hours
   * - Daily schedules: daily at fixed time HH:MM
   *
   * @param expr - Schedule expression string
   * @returns Parsed schedule configuration
   * @throws Error if expression format is invalid
   */
  parseSchedule(expr: string): ScheduleConfig {
    const trimmed = expr.trim().toLowerCase();

    // Pattern 1: "*/N minutes"
    const minuteMatch = trimmed.match(/^\*\/(\d+)\s+minutes?$/);
    if (minuteMatch) {
      const minutes = parseInt(minuteMatch[1], 10);
      if (minutes < 1) {
        throw new Error('Minute interval must be at least 1');
      }
      return {
        intervalMs: minutes * 60 * 1000,
        expression: expr,
      };
    }

    // Pattern 2: "every N hours"
    const hourMatch = trimmed.match(/^every\s+(\d+)\s+hours?$/);
    if (hourMatch) {
      const hours = parseInt(hourMatch[1], 10);
      if (hours < 1) {
        throw new Error('Hour interval must be at least 1');
      }
      return {
        intervalMs: hours * 60 * 60 * 1000,
        expression: expr,
      };
    }

    // Pattern 3: "daily HH:MM"
    const dailyMatch = trimmed.match(/^daily\s+(-?\d{1,2}):(-?\d{1,2})$/);
    if (dailyMatch) {
      const hour = parseInt(dailyMatch[1], 10);
      const minute = parseInt(dailyMatch[2], 10);

      if (hour < 0 || hour > 23) {
        throw new Error('Hour must be between 0 and 23');
      }
      if (minute < 0 || minute > 59) {
        throw new Error('Minute must be between 0 and 59');
      }

      return {
        intervalMs: null,
        dailyHour: hour,
        dailyMinute: minute,
        expression: expr,
      };
    }

    throw new Error(
      `Invalid schedule expression: "${expr}". ` +
        'Expected formats: "*/N minutes", "every N hours", or "daily HH:MM"'
    );
  }

  /**
   * Schedule a loop to run at regular intervals or fixed times.
   *
   * @param projectId - UUID of the project to schedule
   * @param schedule - Schedule expression or parsed ScheduleConfig
   * @param loopOpts - Loop start options (excluding mode, which is forced to SINGLE)
   * @throws Error if schedule expression is invalid or project already scheduled
   */
  scheduleLoop(
    projectId: string,
    schedule: string | ScheduleConfig,
    loopOpts: Omit<LoopStartOpts, 'mode'>
  ): void {
    if (this.schedules.has(projectId)) {
      throw new Error(`Project ${projectId} is already scheduled`);
    }

    const config =
      typeof schedule === 'string' ? this.parseSchedule(schedule) : schedule;

    const scheduled: ScheduledLoop = {
      projectId,
      schedule: config,
      loopOpts,
      timerId: null,
      nextRun: null,
    };

    if (config.intervalMs !== null) {
      // Interval-based schedule (minutes or hours)
      scheduled.nextRun = new Date(Date.now() + config.intervalMs).toISOString();
      scheduled.timerId = setInterval(() => {
        this.triggerLoop(projectId);
        const sched = this.schedules.get(projectId);
        if (sched && sched.schedule.intervalMs !== null) {
          sched.nextRun = new Date(
            Date.now() + sched.schedule.intervalMs
          ).toISOString();
        }
      }, config.intervalMs);
    } else {
      // Daily fixed-time schedule
      scheduled.nextRun = this.calculateNextDailyRun(
        config.dailyHour!,
        config.dailyMinute!
      );
      this.scheduleDailyTimer(projectId);
    }

    this.schedules.set(projectId, scheduled);
  }

  /**
   * Cancel a scheduled loop.
   *
   * @param projectId - UUID of the project to cancel
   * @returns True if schedule was cancelled, false if not scheduled
   */
  cancelSchedule(projectId: string): boolean {
    const scheduled = this.schedules.get(projectId);
    if (!scheduled) {
      return false;
    }

    if (scheduled.timerId) {
      clearInterval(scheduled.timerId);
      clearTimeout(scheduled.timerId);
    }

    this.schedules.delete(projectId);
    return true;
  }

  /**
   * List all currently scheduled loops.
   *
   * @returns Array of ScheduledLoop entries (without sensitive data)
   */
  listScheduled(): ScheduledLoop[] {
    return Array.from(this.schedules.values());
  }

  /**
   * Check if a project is currently scheduled.
   *
   * @param projectId - UUID of the project
   * @returns True if scheduled, false otherwise
   */
  isScheduled(projectId: string): boolean {
    return this.schedules.has(projectId);
  }

  /**
   * Cancel all scheduled loops (used during shutdown).
   */
  cancelAll(): void {
    for (const projectId of this.schedules.keys()) {
      this.cancelSchedule(projectId);
    }
  }

  /**
   * Trigger a loop execution immediately for a scheduled project.
   *
   * @param projectId - UUID of the project
   */
  private async triggerLoop(projectId: string): Promise<void> {
    const scheduled = this.schedules.get(projectId);
    if (!scheduled) {
      return;
    }

    try {
      // Start loop with mode=SINGLE (scheduler always triggers single-shot loops)
      await this.loopRunner.startLoop({
        ...scheduled.loopOpts,
        mode: LoopMode.SINGLE,
      });
    } catch (err) {
      // Log error but don't cancel schedule (user may fix issue and next run succeeds)
      console.error(
        `[Scheduler] Failed to trigger loop for project ${projectId}:`,
        err
      );
    }
  }

  /**
   * Calculate the next daily run time.
   *
   * @param hour - Target hour (0-23)
   * @param minute - Target minute (0-59)
   * @returns ISO 8601 timestamp of next run
   */
  private calculateNextDailyRun(hour: number, minute: number): string {
    const now = new Date();
    const next = new Date();
    next.setUTCHours(hour, minute, 0, 0);

    // If target time is in the past today, schedule for tomorrow
    if (next <= now) {
      next.setUTCDate(next.getUTCDate() + 1);
    }

    return next.toISOString();
  }

  /**
   * Schedule or reschedule a daily timer.
   *
   * @param projectId - UUID of the project
   */
  private scheduleDailyTimer(projectId: string): void {
    const scheduled = this.schedules.get(projectId);
    if (!scheduled || scheduled.schedule.intervalMs !== null) {
      return;
    }

    const { dailyHour, dailyMinute } = scheduled.schedule;
    const nextRun = new Date(
      this.calculateNextDailyRun(dailyHour!, dailyMinute!)
    );
    const msUntilRun = nextRun.getTime() - Date.now();

    if (scheduled.timerId) {
      clearTimeout(scheduled.timerId);
    }

    scheduled.timerId = setTimeout(() => {
      this.triggerLoop(projectId);

      // Reschedule for next day
      const sched = this.schedules.get(projectId);
      if (sched && sched.schedule.intervalMs === null) {
        sched.nextRun = this.calculateNextDailyRun(
          sched.schedule.dailyHour!,
          sched.schedule.dailyMinute!
        );
        this.scheduleDailyTimer(projectId);
      }
    }, msUntilRun);

    scheduled.nextRun = nextRun.toISOString();
  }
}
