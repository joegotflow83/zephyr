import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';

import Dockerode from 'dockerode';
import { Readable } from 'stream';

import type {
  ContainerCreateOpts,
  ContainerFilters,
  ContainerRuntime,
  ContainerStatus,
  ContainerSummary,
  ExecOpts,
  ExecResult,
  ExecSession,
  ExecSessionOpts,
  LogCallback,
  LogStream,
  ProgressCallback,
  RuntimeInfo,
} from './container-runtime';

/**
 * DockerRuntime — ContainerRuntime implementation backed by the Docker daemon
 * via the dockerode library.
 *
 * This is a direct refactor of the old DockerManager class. All orchestration
 * code now depends only on the ContainerRuntime interface; DockerRuntime is
 * injected at startup when AppSettings.container_runtime === 'docker'.
 */
export class DockerRuntime implements ContainerRuntime {
  readonly runtimeType = 'docker' as const;

  private docker: Dockerode;

  constructor(dockerOpts?: Dockerode.DockerOptions) {
    this.docker = new Dockerode(dockerOpts);
  }

  // ── Availability ────────────────────────────────────────────────────────────

  async isAvailable(): Promise<boolean> {
    try {
      await this.docker.ping();
      return true;
    } catch {
      return false;
    }
  }

  async getInfo(): Promise<RuntimeInfo> {
    const info = await this.docker.info();
    const version = await this.docker.version();

    return {
      version: version.Version || 'unknown',
      containers: info.Containers || 0,
      images: info.Images || 0,
      osType: info.OSType,
      architecture: info.Architecture,
    };
  }

  // ── Images ──────────────────────────────────────────────────────────────────

  async isImageAvailable(image: string): Promise<boolean> {
    try {
      await this.docker.getImage(image).inspect();
      return true;
    } catch {
      return false;
    }
  }

  async pullImage(image: string, onProgress?: ProgressCallback): Promise<void> {
    return new Promise((resolve, reject) => {
      this.docker.pull(image, (err: Error | undefined, stream: NodeJS.ReadableStream) => {
        if (err) {
          reject(err);
          return;
        }

        const layerProgress = new Map<string, { current: number; total: number }>();

        this.docker.modem.followProgress(
          stream,
          (err: Error | null, _output: unknown[]) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          },
          (event: {
            status?: string;
            id?: string;
            progressDetail?: { current?: number; total?: number };
          }) => {
            if (onProgress) {
              if (event.id && event.progressDetail) {
                layerProgress.set(event.id, {
                  current: event.progressDetail.current || 0,
                  total: event.progressDetail.total || 0,
                });

                let totalCurrent = 0;
                let totalSize = 0;
                layerProgress.forEach((progress) => {
                  totalCurrent += progress.current;
                  totalSize += progress.total;
                });

                onProgress({
                  status: event.status || 'pulling',
                  current: totalCurrent,
                  total: totalSize,
                });
              } else if (event.status) {
                onProgress({ status: event.status });
              }
            }
          }
        );
      });
    });
  }

  async saveImage(image: string, outputPath: string): Promise<void> {
    const img = this.docker.getImage(image);
    const stream = (await img.get()) as Readable;
    const writeStream = createWriteStream(outputPath);
    await pipeline(stream, writeStream);
  }

  async buildImage(
    contextDir: string,
    tag: string,
    buildArgs?: Record<string, string>,
    onProgress?: ProgressCallback
  ): Promise<void> {
    const context: Dockerode.ImageBuildContext = {
      context: contextDir,
      src: ['Dockerfile'],
    };

    const options: Dockerode.ImageBuildOptions = {
      t: tag,
      ...(buildArgs ? { buildargs: buildArgs } : {}),
    };

    const stream = await this.docker.buildImage(context, options);

    return new Promise((resolve, reject) => {
      this.docker.modem.followProgress(
        stream,
        (err: Error | null, _output: unknown[]) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        },
        (event: { stream?: string; error?: string; status?: string; progress?: string }) => {
          if (event.error) {
            reject(new Error(event.error));
          } else if (onProgress) {
            onProgress(event);
          }
        }
      );
    });
  }

  // ── Container lifecycle ─────────────────────────────────────────────────────

  async createContainer(opts: ContainerCreateOpts): Promise<string> {
    const { image, projectId, name, command, env, binds, labels, workingDir, autoRemove, capAdd, securityOpts, networkMode, tty } = opts;

    const envArray = env ? Object.entries(env).map(([k, v]) => `${k}=${v}`) : undefined;

    const container = await this.docker.createContainer({
      Image: image,
      name,
      Cmd: command,
      Env: envArray,
      WorkingDir: workingDir,
      Tty: tty,
      Labels: {
        'zephyr-managed': 'true',
        'zephyr.project_id': projectId,
        ...labels,
      },
      HostConfig: {
        Binds: binds,
        AutoRemove: autoRemove,
        CapAdd: capAdd,
        SecurityOpt: securityOpts,
        NetworkMode: networkMode,
      },
    });

    return container.id;
  }

  async startContainer(id: string): Promise<void> {
    await this.docker.getContainer(id).start();
  }

  async stopContainer(id: string, timeout?: number): Promise<void> {
    await this.docker.getContainer(id).stop({ t: timeout ?? 10 });
  }

  async removeContainer(id: string, force?: boolean): Promise<void> {
    await this.docker.getContainer(id).remove({ force });
  }

  // ── Container introspection ─────────────────────────────────────────────────

  async getContainerStatus(id: string): Promise<ContainerStatus> {
    const inspect = await this.docker.getContainer(id).inspect();

    return {
      id: inspect.Id,
      state: inspect.State.Status as ContainerStatus['state'],
      status: inspect.State.Status,
      startedAt: inspect.State.StartedAt,
      finishedAt: inspect.State.FinishedAt,
    };
  }

  async getContainerCreated(id: string): Promise<string | null> {
    try {
      const inspect = await this.docker.getContainer(id).inspect();
      return inspect.Created;
    } catch {
      return null;
    }
  }

  async listContainers(filters?: ContainerFilters): Promise<ContainerSummary[]> {
    const labelFilters = ['zephyr-managed=true'];
    if (filters?.projectId) {
      labelFilters.push(`zephyr.project_id=${filters.projectId}`);
    }
    if (filters?.label) {
      labelFilters.push(...filters.label);
    }

    const containers = await this.docker.listContainers({
      all: true,
      filters: { label: labelFilters },
    });

    return containers.map((c) => ({
      id: c.Id,
      name: c.Names[0]?.replace(/^\//, '') || 'unknown',
      image: c.Image,
      state: c.State,
      status: c.Status,
      created: new Date(c.Created * 1000).toISOString(),
      projectId: c.Labels['zephyr.project_id'],
    }));
  }

  // ── Exec & logs ─────────────────────────────────────────────────────────────

  async execCommand(containerId: string, cmd: string[], opts?: ExecOpts): Promise<ExecResult> {
    const container = this.docker.getContainer(containerId);

    const exec = await container.exec({
      Cmd: cmd,
      AttachStdout: true,
      AttachStderr: true,
      User: opts?.user,
      WorkingDir: opts?.workingDir,
      Env: opts?.env,
    });

    const stream = await exec.start({ Detach: false });

    let stdout = '';
    let stderr = '';

    return new Promise((resolve, reject) => {
      stream.on('data', (chunk: Buffer) => {
        let offset = 0;
        const buf = Buffer.from(chunk);

        while (offset < buf.length) {
          if (offset + 8 > buf.length) break;

          const streamType = buf[offset];
          const payloadSize =
            (buf[offset + 4] << 24) |
            (buf[offset + 5] << 16) |
            (buf[offset + 6] << 8) |
            buf[offset + 7];

          if (offset + 8 + payloadSize > buf.length) break;

          const payload = buf.subarray(offset + 8, offset + 8 + payloadSize).toString('utf8');

          if (streamType === 1) {
            stdout += payload;
          } else if (streamType === 2) {
            stderr += payload;
          }

          offset += 8 + payloadSize;
        }
      });

      stream.on('end', async () => {
        try {
          const inspectResult = await exec.inspect();
          resolve({ exitCode: inspectResult.ExitCode || 0, stdout, stderr });
        } catch (error) {
          reject(error);
        }
      });

      stream.on('error', (error: Error) => reject(error));
    });
  }

  async createExecSession(containerId: string, opts?: ExecSessionOpts): Promise<ExecSession> {
    const container = this.docker.getContainer(containerId);
    const shell = opts?.shell || 'bash';

    const exec = await container.exec({
      Cmd: [shell],
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: true,
      User: opts?.user,
      WorkingDir: opts?.workingDir,
      Env: opts?.env,
    });

    // hijack: true upgrades to a raw bidirectional TCP socket so stdin writes
    // actually reach the container process.
    const stream = (await exec.start({
      hijack: true,
      Detach: false,
      Tty: true,
      stdin: true,
    })) as NodeJS.ReadWriteStream;

    if (opts?.rows && opts?.cols) {
      try {
        await exec.resize({ h: opts.rows, w: opts.cols });
      } catch {
        // Resize may fail if exec not started yet — safe to ignore.
      }
    }

    return { id: exec.id, stream };
  }

  async resizeExec(execId: string, rows: number, cols: number): Promise<void> {
    await this.docker.getExec(execId).resize({ h: rows, w: cols });
  }

  async streamLogs(containerId: string, onLine: LogCallback, since?: number): Promise<LogStream> {
    const container = this.docker.getContainer(containerId);

    const logOptions: {
      follow: true;
      stdout: boolean;
      stderr: boolean;
      timestamps: boolean;
      since?: number;
    } = {
      follow: true,
      stdout: true,
      stderr: true,
      timestamps: true,
    };

    if (since !== undefined) {
      logOptions.since = since;
    }

    const stream = (await container.logs(logOptions)) as unknown as Readable;

    let buffer = '';

    stream.on('data', (chunk: Buffer) => {
      // Docker multiplexes stdout/stderr with an 8-byte header.
      // Format: [STREAM_TYPE, 0, 0, 0, SIZE1, SIZE2, SIZE3, SIZE4, ...PAYLOAD...]
      let offset = 0;
      const buf = Buffer.from(chunk);

      while (offset < buf.length) {
        if (offset + 8 > buf.length) break;

        const payloadSize =
          (buf[offset + 4] << 24) |
          (buf[offset + 5] << 16) |
          (buf[offset + 6] << 8) |
          buf[offset + 7];

        if (offset + 8 + payloadSize > buf.length) break;

        const payload = buf.subarray(offset + 8, offset + 8 + payloadSize).toString('utf8');
        buffer += payload;

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim()) onLine(line);
        }

        offset += 8 + payloadSize;
      }
    });

    stream.on('end', () => {
      if (buffer.trim()) onLine(buffer);
      stream.destroy();
    });

    stream.on('error', (error: Error) => {
      console.error(`Log stream error for container ${containerId}:`, error);
      stream.destroy();
    });

    return {
      stop() {
        stream.destroy();
      },
    };
  }
}
