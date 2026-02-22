/**
 * Unit tests for src/main/ipc-handlers/image-handlers.ts
 *
 * Verifies that registerImageHandlers() correctly wires IPC channels to
 * ImageStore and ImageBuilder service methods. Each handler is extracted via
 * the mock ipcMain.handle registry, then called directly to confirm routing.
 *
 * Why we test routing: the IPC layer is the boundary between renderer and main.
 * A mis-wired channel silently returns undefined to the UI. Tests here catch
 * those regressions without needing a real Electron process or Docker daemon.
 *
 * Progress streaming is tested by verifying that event.sender.send() is called
 * with IMAGE_BUILD_PROGRESS and the extracted line string when the builder fires
 * a BuildProgressEvent — this is the mechanism that drives the live build UI.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';
import { IPC } from '../../src/shared/ipc-channels';
import { ImageBuildConfig, ZephyrImage } from '../../src/shared/models';

// ── Mock electron ─────────────────────────────────────────────────────────────

const handlerRegistry: Record<
  string,
  (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
> = {};

vi.mock('electron', () => ({
  ipcMain: {
    handle: (
      channel: string,
      handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
    ) => {
      handlerRegistry[channel] = handler;
    },
  },
}));

// ── Import subject under test (after mock is set up) ──────────────────────────

import { registerImageHandlers } from '../../src/main/ipc-handlers/image-handlers';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SAMPLE_CONFIG: ImageBuildConfig = {
  name: 'python-dev',
  languages: [{ languageId: 'python', version: '3.12' }],
};

const SAMPLE_IMAGE: ZephyrImage = {
  id: 'img-uuid-1',
  name: 'python-dev',
  dockerTag: 'zephyr-python-dev:latest',
  languages: [{ languageId: 'python', version: '3.12' }],
  buildConfig: SAMPLE_CONFIG,
  builtAt: '2024-01-01T00:00:00.000Z',
};

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Creates a fake IpcMainInvokeEvent with a controllable sender.send spy. */
function makeFakeEvent() {
  return {
    sender: {
      send: vi.fn(),
    },
  } as unknown as IpcMainInvokeEvent;
}

/** Invoke a registered handler as if called from the renderer. */
async function invoke(
  channel: string,
  eventOrArgs?: IpcMainInvokeEvent | unknown,
  ...args: unknown[]
): Promise<unknown> {
  const handler = handlerRegistry[channel];
  if (!handler) throw new Error(`No handler registered for channel: ${channel}`);
  // If first arg looks like an event (has sender), use it; else use a bare event
  if (eventOrArgs && typeof eventOrArgs === 'object' && 'sender' in (eventOrArgs as object)) {
    return handler(eventOrArgs as IpcMainInvokeEvent, ...args);
  }
  return handler(
    makeFakeEvent(),
    ...(eventOrArgs !== undefined ? [eventOrArgs, ...args] : [])
  );
}

// ── Service mocks ──────────────────────────────────────────────────────────────

function makeMockImageStore() {
  return {
    listImages: vi.fn(),
    getImage: vi.fn(),
    addImage: vi.fn(),
    updateImage: vi.fn(),
    removeImage: vi.fn(),
  };
}

function makeMockImageBuilder() {
  return {
    buildImage: vi.fn(),
    rebuildImage: vi.fn(),
  };
}

// ── Setup ──────────────────────────────────────────────────────────────────────

describe('registerImageHandlers', () => {
  let mockImageStore: ReturnType<typeof makeMockImageStore>;
  let mockImageBuilder: ReturnType<typeof makeMockImageBuilder>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockImageStore = makeMockImageStore();
    mockImageBuilder = makeMockImageBuilder();

    registerImageHandlers({
      imageStore: mockImageStore as never,
      imageBuilder: mockImageBuilder as never,
    });
  });

  // ── Registration ──────────────────────────────────────────────────────────

  it('registers all expected IPC channels', () => {
    const expected = [
      IPC.IMAGE_LIST,
      IPC.IMAGE_GET,
      IPC.IMAGE_BUILD,
      IPC.IMAGE_REBUILD,
      IPC.IMAGE_DELETE,
    ];
    for (const channel of expected) {
      expect(handlerRegistry[channel], `expected channel ${channel} to be registered`).toBeDefined();
    }
  });

  // ── IMAGE_LIST ────────────────────────────────────────────────────────────

  describe('IMAGE_LIST', () => {
    it('returns the images array from imageStore.listImages', async () => {
      mockImageStore.listImages.mockReturnValue([SAMPLE_IMAGE]);
      const result = await invoke(IPC.IMAGE_LIST);
      expect(result).toEqual([SAMPLE_IMAGE]);
      expect(mockImageStore.listImages).toHaveBeenCalledOnce();
    });

    it('returns an empty array when no images exist', async () => {
      mockImageStore.listImages.mockReturnValue([]);
      const result = await invoke(IPC.IMAGE_LIST);
      expect(result).toEqual([]);
    });
  });

  // ── IMAGE_GET ─────────────────────────────────────────────────────────────

  describe('IMAGE_GET', () => {
    it('returns a single image by id', async () => {
      mockImageStore.getImage.mockReturnValue(SAMPLE_IMAGE);
      const result = await invoke(IPC.IMAGE_GET, 'img-uuid-1');
      expect(result).toEqual(SAMPLE_IMAGE);
      expect(mockImageStore.getImage).toHaveBeenCalledWith('img-uuid-1');
    });

    it('returns null for an unknown image id', async () => {
      mockImageStore.getImage.mockReturnValue(null);
      const result = await invoke(IPC.IMAGE_GET, 'nonexistent');
      expect(result).toBeNull();
    });
  });

  // ── IMAGE_BUILD ───────────────────────────────────────────────────────────

  describe('IMAGE_BUILD', () => {
    it('calls imageBuilder.buildImage with the provided config', async () => {
      mockImageBuilder.buildImage.mockResolvedValue(SAMPLE_IMAGE);
      await invoke(IPC.IMAGE_BUILD, SAMPLE_CONFIG);
      expect(mockImageBuilder.buildImage).toHaveBeenCalledOnce();
      const [calledConfig] = mockImageBuilder.buildImage.mock.calls[0] as [ImageBuildConfig, unknown];
      expect(calledConfig).toEqual(SAMPLE_CONFIG);
    });

    it('returns the built ZephyrImage', async () => {
      mockImageBuilder.buildImage.mockResolvedValue(SAMPLE_IMAGE);
      const result = await invoke(IPC.IMAGE_BUILD, SAMPLE_CONFIG);
      expect(result).toEqual(SAMPLE_IMAGE);
    });

    it('sends IMAGE_BUILD_PROGRESS events via webContents.send when stream progress fires', async () => {
      const fakeEvent = makeFakeEvent();
      mockImageBuilder.buildImage.mockImplementation(
        async (_config: unknown, onProgress: (e: { stream?: string }) => void) => {
          onProgress({ stream: 'Step 1/3 : FROM ubuntu:24.04' });
          onProgress({ stream: 'Step 2/3 : RUN apt-get update' });
          return SAMPLE_IMAGE;
        }
      );

      await handlerRegistry[IPC.IMAGE_BUILD](fakeEvent, SAMPLE_CONFIG);

      expect(fakeEvent.sender.send).toHaveBeenCalledTimes(2);
      expect(fakeEvent.sender.send).toHaveBeenCalledWith(
        IPC.IMAGE_BUILD_PROGRESS,
        'Step 1/3 : FROM ubuntu:24.04'
      );
      expect(fakeEvent.sender.send).toHaveBeenCalledWith(
        IPC.IMAGE_BUILD_PROGRESS,
        'Step 2/3 : RUN apt-get update'
      );
    });

    it('sends progress using status field when stream is absent', async () => {
      const fakeEvent = makeFakeEvent();
      mockImageBuilder.buildImage.mockImplementation(
        async (_config: unknown, onProgress: (e: { status?: string }) => void) => {
          onProgress({ status: 'Pulling base image' });
          return SAMPLE_IMAGE;
        }
      );

      await handlerRegistry[IPC.IMAGE_BUILD](fakeEvent, SAMPLE_CONFIG);
      expect(fakeEvent.sender.send).toHaveBeenCalledWith(
        IPC.IMAGE_BUILD_PROGRESS,
        'Pulling base image'
      );
    });

    it('does not send empty progress lines', async () => {
      const fakeEvent = makeFakeEvent();
      mockImageBuilder.buildImage.mockImplementation(
        async (_config: unknown, onProgress: (e: { stream?: string }) => void) => {
          onProgress({ stream: '' });
          onProgress({});
          return SAMPLE_IMAGE;
        }
      );

      await handlerRegistry[IPC.IMAGE_BUILD](fakeEvent, SAMPLE_CONFIG);
      expect(fakeEvent.sender.send).not.toHaveBeenCalled();
    });

    it('propagates errors from imageBuilder.buildImage', async () => {
      mockImageBuilder.buildImage.mockRejectedValue(new Error('build failed'));
      await expect(invoke(IPC.IMAGE_BUILD, SAMPLE_CONFIG)).rejects.toThrow('build failed');
    });
  });

  // ── IMAGE_REBUILD ─────────────────────────────────────────────────────────

  describe('IMAGE_REBUILD', () => {
    it('calls imageBuilder.rebuildImage with the provided id', async () => {
      mockImageBuilder.rebuildImage.mockResolvedValue(SAMPLE_IMAGE);
      await invoke(IPC.IMAGE_REBUILD, 'img-uuid-1');
      expect(mockImageBuilder.rebuildImage).toHaveBeenCalledOnce();
      const [calledId] = mockImageBuilder.rebuildImage.mock.calls[0] as [string, unknown];
      expect(calledId).toBe('img-uuid-1');
    });

    it('returns the rebuilt ZephyrImage', async () => {
      mockImageBuilder.rebuildImage.mockResolvedValue(SAMPLE_IMAGE);
      const result = await invoke(IPC.IMAGE_REBUILD, 'img-uuid-1');
      expect(result).toEqual(SAMPLE_IMAGE);
    });

    it('streams rebuild progress via webContents.send', async () => {
      const fakeEvent = makeFakeEvent();
      mockImageBuilder.rebuildImage.mockImplementation(
        async (_id: unknown, onProgress: (e: { stream?: string }) => void) => {
          onProgress({ stream: 'Rebuilding layer' });
          return SAMPLE_IMAGE;
        }
      );

      await handlerRegistry[IPC.IMAGE_REBUILD](fakeEvent, 'img-uuid-1');
      expect(fakeEvent.sender.send).toHaveBeenCalledWith(
        IPC.IMAGE_BUILD_PROGRESS,
        'Rebuilding layer'
      );
    });

    it('propagates errors from imageBuilder.rebuildImage', async () => {
      mockImageBuilder.rebuildImage.mockRejectedValue(new Error('rebuild failed'));
      await expect(invoke(IPC.IMAGE_REBUILD, 'img-uuid-1')).rejects.toThrow('rebuild failed');
    });
  });

  // ── IMAGE_DELETE ──────────────────────────────────────────────────────────

  describe('IMAGE_DELETE', () => {
    it('calls imageStore.removeImage with the provided id', async () => {
      mockImageStore.removeImage.mockReturnValue(true);
      await invoke(IPC.IMAGE_DELETE, 'img-uuid-1');
      expect(mockImageStore.removeImage).toHaveBeenCalledWith('img-uuid-1');
    });

    it('returns true when image was found and removed', async () => {
      mockImageStore.removeImage.mockReturnValue(true);
      const result = await invoke(IPC.IMAGE_DELETE, 'img-uuid-1');
      expect(result).toBe(true);
    });

    it('returns false when image was not found', async () => {
      mockImageStore.removeImage.mockReturnValue(false);
      const result = await invoke(IPC.IMAGE_DELETE, 'nonexistent');
      expect(result).toBe(false);
    });
  });
});
