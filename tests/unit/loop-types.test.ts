/**
 * Unit tests for loop execution types.
 */

import { describe, it, expect } from 'vitest';
import {
  LoopMode,
  LoopStatus,
  type LoopState,
  type LoopStartOpts,
  createLoopState,
  isLoopTerminal,
  isLoopActive,
  validateLoopStartOpts,
} from '../../src/shared/loop-types';

describe('LoopMode enum', () => {
  it('should have SINGLE mode', () => {
    expect(LoopMode.SINGLE).toBe('single');
  });

  it('should have CONTINUOUS mode', () => {
    expect(LoopMode.CONTINUOUS).toBe('continuous');
  });

  it('should have SCHEDULED mode', () => {
    expect(LoopMode.SCHEDULED).toBe('scheduled');
  });

  it('should have exactly three modes', () => {
    const modes = Object.values(LoopMode);
    expect(modes).toHaveLength(3);
    expect(modes).toEqual(['single', 'continuous', 'scheduled']);
  });
});

describe('LoopStatus enum', () => {
  it('should have IDLE status', () => {
    expect(LoopStatus.IDLE).toBe('idle');
  });

  it('should have STARTING status', () => {
    expect(LoopStatus.STARTING).toBe('starting');
  });

  it('should have RUNNING status', () => {
    expect(LoopStatus.RUNNING).toBe('running');
  });

  it('should have PAUSED status', () => {
    expect(LoopStatus.PAUSED).toBe('paused');
  });

  it('should have STOPPING status', () => {
    expect(LoopStatus.STOPPING).toBe('stopping');
  });

  it('should have STOPPED status', () => {
    expect(LoopStatus.STOPPED).toBe('stopped');
  });

  it('should have FAILED status', () => {
    expect(LoopStatus.FAILED).toBe('failed');
  });

  it('should have COMPLETED status', () => {
    expect(LoopStatus.COMPLETED).toBe('completed');
  });

  it('should have exactly eight statuses', () => {
    const statuses = Object.values(LoopStatus);
    expect(statuses).toHaveLength(8);
  });
});

describe('LoopState interface', () => {
  it('should compile with all required fields', () => {
    const state: LoopState = {
      projectId: 'test-id',
      projectName: 'Test Project',      containerId: null,
      mode: LoopMode.SINGLE,
      status: LoopStatus.IDLE,
      iteration: 0,
      startedAt: null,
      stoppedAt: null,
      logs: [],
      commits: [],
      errors: 0,
      error: null,
    };
    expect(state.projectId).toBe('test-id');
  });

  it('should allow null containerId', () => {
    const state: LoopState = createLoopState('test-id');
    expect(state.containerId).toBeNull();
  });

  it('should allow string containerId', () => {
    const state: LoopState = {
      ...createLoopState('test-id'),
      containerId: 'abc123',
    };
    expect(state.containerId).toBe('abc123');
  });

  it('should allow ISO 8601 timestamps', () => {
    const now = new Date().toISOString();
    const state: LoopState = {
      ...createLoopState('test-id'),
      startedAt: now,
      stoppedAt: now,
    };
    expect(state.startedAt).toBe(now);
    expect(state.stoppedAt).toBe(now);
  });

  it('should allow arrays for logs and commits', () => {
    const state: LoopState = {
      ...createLoopState('test-id'),
      logs: ['line1', 'line2'],
      commits: ['sha1', 'sha2'],
    };
    expect(state.logs).toHaveLength(2);
    expect(state.commits).toHaveLength(2);
  });

  it('should allow null or string for error', () => {
    const state1: LoopState = {
      ...createLoopState('test-id'),
      error: null,
    };
    const state2: LoopState = {
      ...createLoopState('test-id'),
      error: 'Container crashed',
    };
    expect(state1.error).toBeNull();
    expect(state2.error).toBe('Container crashed');
  });
});

describe('LoopStartOpts interface', () => {
  it('should compile with required fields only', () => {
    const opts: LoopStartOpts = {
      projectId: 'test-id',
      projectName: 'Test Project',      dockerImage: 'anthropics/anthropic-quickstarts:latest',
      mode: LoopMode.CONTINUOUS,
    };
    expect(opts.projectId).toBe('test-id');
  });

  it('should allow optional envVars', () => {
    const opts: LoopStartOpts = {
      projectId: 'test-id',
      projectName: 'Test Project',      dockerImage: 'test:latest',
      mode: LoopMode.SINGLE,
      envVars: { API_KEY: 'secret', DEBUG: 'true' },
    };
    expect(opts.envVars).toEqual({ API_KEY: 'secret', DEBUG: 'true' });
  });

  it('should allow optional volumeMounts', () => {
    const opts: LoopStartOpts = {
      projectId: 'test-id',
      projectName: 'Test Project',      dockerImage: 'test:latest',
      mode: LoopMode.SINGLE,
      volumeMounts: ['/host/path:/container/path', '/another:/mount'],
    };
    expect(opts.volumeMounts).toHaveLength(2);
  });

  it('should allow optional workDir', () => {
    const opts: LoopStartOpts = {
      projectId: 'test-id',
      projectName: 'Test Project',      dockerImage: 'test:latest',
      mode: LoopMode.SINGLE,
      workDir: '/app',
    };
    expect(opts.workDir).toBe('/app');
  });

  it('should allow optional user', () => {
    const opts: LoopStartOpts = {
      projectId: 'test-id',
      projectName: 'Test Project',      dockerImage: 'test:latest',
      mode: LoopMode.SINGLE,
      user: 'root',
    };
    expect(opts.user).toBe('root');
  });
});

describe('createLoopState', () => {
  it('should create state with default mode SINGLE', () => {
    const state = createLoopState('project-123');
    expect(state.projectId).toBe('project-123');
    expect(state.mode).toBe(LoopMode.SINGLE);
  });

  it('should create state with specified mode', () => {
    const state = createLoopState('project-123', LoopMode.CONTINUOUS);
    expect(state.mode).toBe(LoopMode.CONTINUOUS);
  });

  it('should initialize with IDLE status', () => {
    const state = createLoopState('project-123');
    expect(state.status).toBe(LoopStatus.IDLE);
  });

  it('should initialize containerId as null', () => {
    const state = createLoopState('project-123');
    expect(state.containerId).toBeNull();
  });

  it('should initialize iteration as 0', () => {
    const state = createLoopState('project-123');
    expect(state.iteration).toBe(0);
  });

  it('should initialize timestamps as null', () => {
    const state = createLoopState('project-123');
    expect(state.startedAt).toBeNull();
    expect(state.stoppedAt).toBeNull();
  });

  it('should initialize logs and commits as empty arrays', () => {
    const state = createLoopState('project-123');
    expect(state.logs).toEqual([]);
    expect(state.commits).toEqual([]);
  });

  it('should initialize errors count as 0', () => {
    const state = createLoopState('project-123');
    expect(state.errors).toBe(0);
  });

  it('should initialize error as null', () => {
    const state = createLoopState('project-123');
    expect(state.error).toBeNull();
  });
});

describe('isLoopTerminal', () => {
  it('should return true for STOPPED status', () => {
    expect(isLoopTerminal(LoopStatus.STOPPED)).toBe(true);
  });

  it('should return true for FAILED status', () => {
    expect(isLoopTerminal(LoopStatus.FAILED)).toBe(true);
  });

  it('should return true for COMPLETED status', () => {
    expect(isLoopTerminal(LoopStatus.COMPLETED)).toBe(true);
  });

  it('should return false for IDLE status', () => {
    expect(isLoopTerminal(LoopStatus.IDLE)).toBe(false);
  });

  it('should return false for STARTING status', () => {
    expect(isLoopTerminal(LoopStatus.STARTING)).toBe(false);
  });

  it('should return false for RUNNING status', () => {
    expect(isLoopTerminal(LoopStatus.RUNNING)).toBe(false);
  });

  it('should return false for PAUSED status', () => {
    expect(isLoopTerminal(LoopStatus.PAUSED)).toBe(false);
  });

  it('should return false for STOPPING status', () => {
    expect(isLoopTerminal(LoopStatus.STOPPING)).toBe(false);
  });
});

describe('isLoopActive', () => {
  it('should return true for STARTING status', () => {
    expect(isLoopActive(LoopStatus.STARTING)).toBe(true);
  });

  it('should return true for RUNNING status', () => {
    expect(isLoopActive(LoopStatus.RUNNING)).toBe(true);
  });

  it('should return false for IDLE status', () => {
    expect(isLoopActive(LoopStatus.IDLE)).toBe(false);
  });

  it('should return false for PAUSED status', () => {
    expect(isLoopActive(LoopStatus.PAUSED)).toBe(false);
  });

  it('should return false for STOPPING status', () => {
    expect(isLoopActive(LoopStatus.STOPPING)).toBe(false);
  });

  it('should return false for STOPPED status', () => {
    expect(isLoopActive(LoopStatus.STOPPED)).toBe(false);
  });

  it('should return false for FAILED status', () => {
    expect(isLoopActive(LoopStatus.FAILED)).toBe(false);
  });

  it('should return false for COMPLETED status', () => {
    expect(isLoopActive(LoopStatus.COMPLETED)).toBe(false);
  });
});

describe('validateLoopStartOpts', () => {
  it('should not throw for valid options', () => {
    const opts: LoopStartOpts = {
      projectId: 'test-id',
      projectName: 'Test Project',      dockerImage: 'test:latest',
      mode: LoopMode.SINGLE,
    };
    expect(() => validateLoopStartOpts(opts)).not.toThrow();
  });

  it('should throw if projectId is empty string', () => {
    const opts: LoopStartOpts = {
      projectId: '',
      dockerImage: 'test:latest',
      mode: LoopMode.SINGLE,
    };
    expect(() => validateLoopStartOpts(opts)).toThrow(
      'projectId must be a non-empty string',
    );
  });

  it('should throw if projectId is not a string', () => {
    const opts = {
      projectId: 123,
      dockerImage: 'test:latest',
      mode: LoopMode.SINGLE,
    } as unknown as LoopStartOpts;
    expect(() => validateLoopStartOpts(opts)).toThrow(
      'projectId must be a non-empty string',
    );
  });

  it('should throw if dockerImage is empty string', () => {
    const opts: LoopStartOpts = {
      projectId: 'test-id',
      projectName: 'Test Project',      dockerImage: '',
      mode: LoopMode.SINGLE,
    };
    expect(() => validateLoopStartOpts(opts)).toThrow(
      'dockerImage must be a non-empty string',
    );
  });

  it('should throw if dockerImage is not a string', () => {
    const opts = {
      projectId: 'test-id',
      projectName: 'Test Project',      dockerImage: null,
      mode: LoopMode.SINGLE,
    } as unknown as LoopStartOpts;
    expect(() => validateLoopStartOpts(opts)).toThrow(
      'dockerImage must be a non-empty string',
    );
  });

  it('should throw if mode is invalid', () => {
    const opts = {
      projectId: 'test-id',
      projectName: 'Test Project',      dockerImage: 'test:latest',
      mode: 'invalid-mode',
    } as unknown as LoopStartOpts;
    expect(() => validateLoopStartOpts(opts)).toThrow('mode must be one of');
  });

  it('should accept all valid modes', () => {
    const modes = [LoopMode.SINGLE, LoopMode.CONTINUOUS, LoopMode.SCHEDULED];
    modes.forEach((mode) => {
      const opts: LoopStartOpts = {
        projectId: 'test-id',
        projectName: 'Test Project',        dockerImage: 'test:latest',
        mode,
      };
      expect(() => validateLoopStartOpts(opts)).not.toThrow();
    });
  });

  it('should accept optional fields', () => {
    const opts: LoopStartOpts = {
      projectId: 'test-id',
      projectName: 'Test Project',      dockerImage: 'test:latest',
      mode: LoopMode.CONTINUOUS,
      envVars: { FOO: 'bar' },
      volumeMounts: ['/host:/container'],
      workDir: '/app',
      user: 'root',
    };
    expect(() => validateLoopStartOpts(opts)).not.toThrow();
  });
});

describe('Type imports from both main and renderer', () => {
  it('should import LoopMode enum', () => {
    expect(LoopMode).toBeDefined();
    expect(LoopMode.SINGLE).toBe('single');
  });

  it('should import LoopStatus enum', () => {
    expect(LoopStatus).toBeDefined();
    expect(LoopStatus.IDLE).toBe('idle');
  });

  it('should import createLoopState function', () => {
    expect(typeof createLoopState).toBe('function');
  });

  it('should import isLoopTerminal function', () => {
    expect(typeof isLoopTerminal).toBe('function');
  });

  it('should import isLoopActive function', () => {
    expect(typeof isLoopActive).toBe('function');
  });

  it('should import validateLoopStartOpts function', () => {
    expect(typeof validateLoopStartOpts).toBe('function');
  });
});
