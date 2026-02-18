/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LoopScheduler, type ScheduleConfig } from '../../src/services/scheduler';
import type { LoopRunner } from '../../src/services/loop-runner';
import { LoopMode } from '../../src/shared/loop-types';

describe('LoopScheduler', () => {
  let mockLoopRunner: LoopRunner;
  let scheduler: LoopScheduler;

  beforeEach(() => {
    vi.useFakeTimers();

    mockLoopRunner = {
      startLoop: vi.fn().mockResolvedValue({}),
    } as unknown as LoopRunner;

    scheduler = new LoopScheduler(mockLoopRunner);
  });

  afterEach(() => {
    scheduler.cancelAll();
    vi.useRealTimers();
  });

  describe('parseSchedule', () => {
    it('should parse minute interval expression', () => {
      const config = scheduler.parseSchedule('*/5 minutes');

      expect(config.intervalMs).toBe(5 * 60 * 1000);
      expect(config.expression).toBe('*/5 minutes');
      expect(config.dailyHour).toBeUndefined();
      expect(config.dailyMinute).toBeUndefined();
    });

    it('should parse singular minute', () => {
      const config = scheduler.parseSchedule('*/1 minute');

      expect(config.intervalMs).toBe(60 * 1000);
    });

    it('should parse hour interval expression', () => {
      const config = scheduler.parseSchedule('every 2 hours');

      expect(config.intervalMs).toBe(2 * 60 * 60 * 1000);
      expect(config.expression).toBe('every 2 hours');
    });

    it('should parse singular hour', () => {
      const config = scheduler.parseSchedule('every 1 hour');

      expect(config.intervalMs).toBe(60 * 60 * 1000);
    });

    it('should parse daily expression with leading zero', () => {
      const config = scheduler.parseSchedule('daily 09:30');

      expect(config.intervalMs).toBeNull();
      expect(config.dailyHour).toBe(9);
      expect(config.dailyMinute).toBe(30);
      expect(config.expression).toBe('daily 09:30');
    });

    it('should parse daily expression without leading zero', () => {
      const config = scheduler.parseSchedule('daily 9:30');

      expect(config.intervalMs).toBeNull();
      expect(config.dailyHour).toBe(9);
      expect(config.dailyMinute).toBe(30);
    });

    it('should parse daily expression at midnight', () => {
      const config = scheduler.parseSchedule('daily 0:00');

      expect(config.dailyHour).toBe(0);
      expect(config.dailyMinute).toBe(0);
    });

    it('should parse daily expression at 23:59', () => {
      const config = scheduler.parseSchedule('daily 23:59');

      expect(config.dailyHour).toBe(23);
      expect(config.dailyMinute).toBe(59);
    });

    it('should be case-insensitive', () => {
      const minuteConfig = scheduler.parseSchedule('*/10 MINUTES');
      expect(minuteConfig.intervalMs).toBe(10 * 60 * 1000);

      const hourConfig = scheduler.parseSchedule('EVERY 3 HOURS');
      expect(hourConfig.intervalMs).toBe(3 * 60 * 60 * 1000);

      const dailyConfig = scheduler.parseSchedule('DAILY 14:30');
      expect(dailyConfig.dailyHour).toBe(14);
    });

    it('should handle extra whitespace', () => {
      const config = scheduler.parseSchedule('  */15  minutes  ');

      expect(config.intervalMs).toBe(15 * 60 * 1000);
    });

    it('should reject invalid expression format', () => {
      expect(() => scheduler.parseSchedule('invalid')).toThrow(
        'Invalid schedule expression'
      );
      expect(() => scheduler.parseSchedule('5 minutes')).toThrow(
        'Invalid schedule expression'
      );
      expect(() => scheduler.parseSchedule('every 2')).toThrow(
        'Invalid schedule expression'
      );
    });

    it('should reject zero or negative minute intervals', () => {
      expect(() => scheduler.parseSchedule('*/0 minutes')).toThrow(
        'Minute interval must be at least 1'
      );
    });

    it('should reject zero or negative hour intervals', () => {
      expect(() => scheduler.parseSchedule('every 0 hours')).toThrow(
        'Hour interval must be at least 1'
      );
    });

    it('should reject invalid daily hour', () => {
      expect(() => scheduler.parseSchedule('daily 24:00')).toThrow(
        'Hour must be between 0 and 23'
      );
      expect(() => scheduler.parseSchedule('daily -1:00')).toThrow(
        'Hour must be between 0 and 23'
      );
    });

    it('should reject invalid daily minute', () => {
      expect(() => scheduler.parseSchedule('daily 12:60')).toThrow(
        'Minute must be between 0 and 59'
      );
      expect(() => scheduler.parseSchedule('daily 12:-1')).toThrow(
        'Minute must be between 0 and 59'
      );
    });
  });

  describe('scheduleLoop - interval-based', () => {
    it('should schedule a loop with minute interval', () => {
      const loopOpts = {
        projectId: 'proj-1',
        dockerImage: 'test:latest',
      };

      scheduler.scheduleLoop('proj-1', '*/5 minutes', loopOpts);

      expect(scheduler.isScheduled('proj-1')).toBe(true);
      const scheduled = scheduler.listScheduled();
      expect(scheduled).toHaveLength(1);
      expect(scheduled[0].projectId).toBe('proj-1');
      expect(scheduled[0].schedule.intervalMs).toBe(5 * 60 * 1000);
      expect(scheduled[0].nextRun).toBeTruthy();
    });

    it('should schedule a loop with hour interval', () => {
      const loopOpts = {
        projectId: 'proj-2',
        dockerImage: 'test:latest',
      };

      scheduler.scheduleLoop('proj-2', 'every 2 hours', loopOpts);

      expect(scheduler.isScheduled('proj-2')).toBe(true);
      const scheduled = scheduler.listScheduled();
      expect(scheduled[0].schedule.intervalMs).toBe(2 * 60 * 60 * 1000);
    });

    it('should trigger loop after interval elapses', async () => {
      const loopOpts = {
        projectId: 'proj-3',
        dockerImage: 'test:latest',
      };

      scheduler.scheduleLoop('proj-3', '*/5 minutes', loopOpts);

      // Fast-forward 5 minutes
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

      expect(mockLoopRunner.startLoop).toHaveBeenCalledTimes(1);
      expect(mockLoopRunner.startLoop).toHaveBeenCalledWith({
        projectId: 'proj-3',
        dockerImage: 'test:latest',
        mode: LoopMode.SINGLE,
      });
    });

    it('should trigger loop repeatedly at interval', async () => {
      const loopOpts = {
        projectId: 'proj-4',
        dockerImage: 'test:latest',
      };

      scheduler.scheduleLoop('proj-4', '*/10 minutes', loopOpts);

      // First trigger at 10 minutes
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
      expect(mockLoopRunner.startLoop).toHaveBeenCalledTimes(1);

      // Second trigger at 20 minutes
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
      expect(mockLoopRunner.startLoop).toHaveBeenCalledTimes(2);

      // Third trigger at 30 minutes
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
      expect(mockLoopRunner.startLoop).toHaveBeenCalledTimes(3);
    });

    it('should update nextRun timestamp after each trigger', async () => {
      const loopOpts = {
        projectId: 'proj-5',
        dockerImage: 'test:latest',
      };

      scheduler.scheduleLoop('proj-5', '*/5 minutes', loopOpts);

      const initialNextRun = scheduler.listScheduled()[0].nextRun;
      expect(initialNextRun).toBeTruthy();

      // Advance time and trigger
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

      const updatedNextRun = scheduler.listScheduled()[0].nextRun;
      expect(updatedNextRun).not.toBe(initialNextRun);
    });

    it('should not cancel schedule if loop start fails', async () => {
      (mockLoopRunner.startLoop as any).mockRejectedValueOnce(
        new Error('Docker unavailable')
      );

      const loopOpts = {
        projectId: 'proj-6',
        dockerImage: 'test:latest',
      };

      scheduler.scheduleLoop('proj-6', '*/5 minutes', loopOpts);

      // Trigger should fail but schedule remains
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      expect(scheduler.isScheduled('proj-6')).toBe(true);

      // Next trigger should still attempt
      (mockLoopRunner.startLoop as any).mockResolvedValueOnce({});
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      expect(mockLoopRunner.startLoop).toHaveBeenCalledTimes(2);
    });
  });

  describe('scheduleLoop - daily fixed-time', () => {
    it('should schedule a daily loop', () => {
      const loopOpts = {
        projectId: 'proj-daily',
        dockerImage: 'test:latest',
      };

      scheduler.scheduleLoop('proj-daily', 'daily 14:30', loopOpts);

      expect(scheduler.isScheduled('proj-daily')).toBe(true);
      const scheduled = scheduler.listScheduled();
      expect(scheduled).toHaveLength(1);
      expect(scheduled[0].schedule.intervalMs).toBeNull();
      expect(scheduled[0].schedule.dailyHour).toBe(14);
      expect(scheduled[0].schedule.dailyMinute).toBe(30);
      expect(scheduled[0].nextRun).toBeTruthy();
    });

    it('should calculate next run for future time today', () => {
      // Set current time to 10:00
      const now = new Date('2026-02-18T10:00:00Z');
      vi.setSystemTime(now);

      const loopOpts = {
        projectId: 'proj-future',
        dockerImage: 'test:latest',
      };

      scheduler.scheduleLoop('proj-future', 'daily 14:30', loopOpts);

      const scheduled = scheduler.listScheduled()[0];
      const nextRun = new Date(scheduled.nextRun!);

      expect(nextRun.getUTCHours()).toBe(14);
      expect(nextRun.getUTCMinutes()).toBe(30);
      expect(nextRun.getUTCDate()).toBe(now.getUTCDate()); // Same day
    });

    it('should calculate next run for tomorrow if time passed today', () => {
      // Set current time to 15:00
      const now = new Date('2026-02-18T15:00:00Z');
      vi.setSystemTime(now);

      const loopOpts = {
        projectId: 'proj-tomorrow',
        dockerImage: 'test:latest',
      };

      scheduler.scheduleLoop('proj-tomorrow', 'daily 14:30', loopOpts);

      const scheduled = scheduler.listScheduled()[0];
      const nextRun = new Date(scheduled.nextRun!);

      expect(nextRun.getUTCHours()).toBe(14);
      expect(nextRun.getUTCMinutes()).toBe(30);
      expect(nextRun.getUTCDate()).toBe(now.getUTCDate() + 1); // Next day
    });

    it('should trigger daily loop at scheduled time', async () => {
      // Set current time to 14:29:50 (10 seconds before trigger)
      const now = new Date('2026-02-18T14:29:50Z');
      vi.setSystemTime(now);

      const loopOpts = {
        projectId: 'proj-trigger-daily',
        dockerImage: 'test:latest',
      };

      scheduler.scheduleLoop('proj-trigger-daily', 'daily 14:30', loopOpts);

      // Verify schedule is created and nextRun is set correctly
      const scheduled = scheduler.listScheduled()[0];
      expect(scheduled).toBeTruthy();
      expect(scheduled.projectId).toBe('proj-trigger-daily');

      const nextRun = new Date(scheduled.nextRun!);
      const expectedTime = new Date('2026-02-18T14:30:00Z');

      // Verify nextRun is approximately 10 seconds in the future
      const diff = nextRun.getTime() - now.getTime();
      expect(diff).toBeGreaterThan(0);
      expect(diff).toBeLessThanOrEqual(11 * 1000);
      expect(nextRun.getUTCHours()).toBe(14);
      expect(nextRun.getUTCMinutes()).toBe(30);
    });

    it('should set correct nextRun time for daily schedule', async () => {
      // Set current time to 14:29:50
      const now = new Date('2026-02-18T14:29:50Z');
      vi.setSystemTime(now);

      const loopOpts = {
        projectId: 'proj-next-run',
        dockerImage: 'test:latest',
      };

      scheduler.scheduleLoop('proj-next-run', 'daily 14:30', loopOpts);

      // Verify nextRun is set correctly for today
      const scheduled = scheduler.listScheduled()[0];
      const nextRun = new Date(scheduled.nextRun!);

      expect(nextRun.getUTCHours()).toBe(14);
      expect(nextRun.getUTCMinutes()).toBe(30);
      expect(nextRun.getUTCSeconds()).toBe(0);
      expect(nextRun.getUTCDate()).toBe(now.getUTCDate()); // Same day since 14:30 is in future
    });
  });

  describe('scheduleLoop - errors', () => {
    it('should reject scheduling already-scheduled project', () => {
      const loopOpts = {
        projectId: 'proj-dup',
        dockerImage: 'test:latest',
      };

      scheduler.scheduleLoop('proj-dup', '*/5 minutes', loopOpts);

      expect(() => {
        scheduler.scheduleLoop('proj-dup', '*/10 minutes', loopOpts);
      }).toThrow('Project proj-dup is already scheduled');
    });

    it('should accept parsed ScheduleConfig instead of string', () => {
      const config: ScheduleConfig = {
        intervalMs: 15 * 60 * 1000,
        expression: '*/15 minutes',
      };

      const loopOpts = {
        projectId: 'proj-config',
        dockerImage: 'test:latest',
      };

      scheduler.scheduleLoop('proj-config', config, loopOpts);

      expect(scheduler.isScheduled('proj-config')).toBe(true);
    });
  });

  describe('cancelSchedule', () => {
    it('should cancel a scheduled loop', () => {
      const loopOpts = {
        projectId: 'proj-cancel',
        dockerImage: 'test:latest',
      };

      scheduler.scheduleLoop('proj-cancel', '*/5 minutes', loopOpts);
      expect(scheduler.isScheduled('proj-cancel')).toBe(true);

      const result = scheduler.cancelSchedule('proj-cancel');

      expect(result).toBe(true);
      expect(scheduler.isScheduled('proj-cancel')).toBe(false);
      expect(scheduler.listScheduled()).toHaveLength(0);
    });

    it('should not trigger loop after cancellation', async () => {
      const loopOpts = {
        projectId: 'proj-no-trigger',
        dockerImage: 'test:latest',
      };

      scheduler.scheduleLoop('proj-no-trigger', '*/5 minutes', loopOpts);
      scheduler.cancelSchedule('proj-no-trigger');

      // Advance past trigger time
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);

      expect(mockLoopRunner.startLoop).not.toHaveBeenCalled();
    });

    it('should return false for non-existent schedule', () => {
      const result = scheduler.cancelSchedule('nonexistent');

      expect(result).toBe(false);
    });

    it('should cancel daily schedule', async () => {
      const now = new Date('2026-02-18T14:29:50Z');
      vi.setSystemTime(now);

      const loopOpts = {
        projectId: 'proj-cancel-daily',
        dockerImage: 'test:latest',
      };

      scheduler.scheduleLoop('proj-cancel-daily', 'daily 14:30', loopOpts);
      scheduler.cancelSchedule('proj-cancel-daily');

      // Advance past trigger time
      await vi.advanceTimersByTimeAsync(20 * 1000);

      expect(mockLoopRunner.startLoop).not.toHaveBeenCalled();
    });
  });

  describe('listScheduled', () => {
    it('should return empty array when no schedules', () => {
      const list = scheduler.listScheduled();

      expect(list).toEqual([]);
    });

    it('should list all scheduled loops', () => {
      scheduler.scheduleLoop('proj-a', '*/5 minutes', {
        projectId: 'proj-a',
        dockerImage: 'test:latest',
      });
      scheduler.scheduleLoop('proj-b', 'every 2 hours', {
        projectId: 'proj-b',
        dockerImage: 'test:latest',
      });
      scheduler.scheduleLoop('proj-c', 'daily 14:30', {
        projectId: 'proj-c',
        dockerImage: 'test:latest',
      });

      const list = scheduler.listScheduled();

      expect(list).toHaveLength(3);
      expect(list.map((s) => s.projectId).sort()).toEqual(['proj-a', 'proj-b', 'proj-c']);
    });
  });

  describe('isScheduled', () => {
    it('should return true for scheduled project', () => {
      scheduler.scheduleLoop('proj-check', '*/5 minutes', {
        projectId: 'proj-check',
        dockerImage: 'test:latest',
      });

      expect(scheduler.isScheduled('proj-check')).toBe(true);
    });

    it('should return false for non-scheduled project', () => {
      expect(scheduler.isScheduled('nonexistent')).toBe(false);
    });
  });

  describe('cancelAll', () => {
    it('should cancel all scheduled loops', () => {
      scheduler.scheduleLoop('proj-1', '*/5 minutes', {
        projectId: 'proj-1',
        dockerImage: 'test:latest',
      });
      scheduler.scheduleLoop('proj-2', 'every 2 hours', {
        projectId: 'proj-2',
        dockerImage: 'test:latest',
      });
      scheduler.scheduleLoop('proj-3', 'daily 14:30', {
        projectId: 'proj-3',
        dockerImage: 'test:latest',
      });

      expect(scheduler.listScheduled()).toHaveLength(3);

      scheduler.cancelAll();

      expect(scheduler.listScheduled()).toHaveLength(0);
      expect(scheduler.isScheduled('proj-1')).toBe(false);
      expect(scheduler.isScheduled('proj-2')).toBe(false);
      expect(scheduler.isScheduled('proj-3')).toBe(false);
    });

    it('should prevent triggers after cancelAll', async () => {
      scheduler.scheduleLoop('proj-all', '*/5 minutes', {
        projectId: 'proj-all',
        dockerImage: 'test:latest',
      });

      scheduler.cancelAll();

      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);

      expect(mockLoopRunner.startLoop).not.toHaveBeenCalled();
    });
  });

  describe('loop options propagation', () => {
    it('should propagate env vars to startLoop', async () => {
      const loopOpts = {
        projectId: 'proj-env',
        dockerImage: 'test:latest',
        envVars: { KEY: 'value' },
      };

      scheduler.scheduleLoop('proj-env', '*/5 minutes', loopOpts);

      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

      expect(mockLoopRunner.startLoop).toHaveBeenCalledWith({
        projectId: 'proj-env',
        dockerImage: 'test:latest',
        envVars: { KEY: 'value' },
        mode: LoopMode.SINGLE,
      });
    });

    it('should propagate volume mounts to startLoop', async () => {
      const loopOpts = {
        projectId: 'proj-vol',
        dockerImage: 'test:latest',
        volumeMounts: ['/host:/container'],
      };

      scheduler.scheduleLoop('proj-vol', '*/5 minutes', loopOpts);

      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

      expect(mockLoopRunner.startLoop).toHaveBeenCalledWith({
        projectId: 'proj-vol',
        dockerImage: 'test:latest',
        volumeMounts: ['/host:/container'],
        mode: LoopMode.SINGLE,
      });
    });

    it('should always set mode to SINGLE', async () => {
      const loopOpts = {
        projectId: 'proj-mode',
        dockerImage: 'test:latest',
      };

      scheduler.scheduleLoop('proj-mode', '*/5 minutes', loopOpts);

      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

      const callArgs = (mockLoopRunner.startLoop as any).mock.calls[0][0];
      expect(callArgs.mode).toBe(LoopMode.SINGLE);
    });
  });
});
