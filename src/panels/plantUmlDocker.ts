import { execFile } from 'child_process';
import * as http from 'http';

export const CONTAINER_NAME = 'repodoc-plantuml';

/** Builds the `docker run` arguments — pure, unit-testable. */
export function dockerRunArgs(image: string, port: number): string[] {
  return ['run', '-d', '--rm', '--name', CONTAINER_NAME, '-p', `${port}:8080`, image];
}

function docker(args: string[]): Promise<{ ok: boolean; stdout: string }> {
  return new Promise((resolve) => {
    execFile('docker', args, { timeout: 30000 }, (error, stdout) => {
      resolve({ ok: !error, stdout: String(stdout ?? '').trim() });
    });
  });
}

function httpUp(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve((res.statusCode ?? 500) < 500);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * Manages a local PlantUML renderer container so diagram source never leaves
 * the machine. The container is named, idempotent to start, and `--rm` so it
 * vanishes when stopped.
 */
export class PlantUmlDocker {
  private startedByUs = false;
  private starting: Promise<boolean> | undefined;

  constructor(
    private readonly image: string,
    private readonly port: number,
  ) {}

  localUrl(): string {
    return `http://localhost:${this.port}`;
  }

  async dockerAvailable(): Promise<boolean> {
    return (await docker(['version', '--format', '{{.Server.Version}}'])).ok;
  }

  async isRunning(): Promise<boolean> {
    const { ok, stdout } = await docker([
      'ps',
      '--filter',
      `name=^${CONTAINER_NAME}$`,
      '--format',
      '{{.Names}}',
    ]);
    return ok && stdout === CONTAINER_NAME;
  }

  /**
   * Starts the container if needed and waits until it serves HTTP (~30s max).
   * Concurrent callers share one attempt. Resolves false when docker is
   * unavailable or the server never came up.
   */
  ensureStarted(): Promise<boolean> {
    this.starting ??= this.doStart().finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }

  private async doStart(): Promise<boolean> {
    if (await this.isRunning()) {
      return this.waitUp();
    }
    if (!(await this.dockerAvailable())) {
      return false;
    }
    const run = await docker(dockerRunArgs(this.image, this.port));
    if (!run.ok) {
      return false;
    }
    this.startedByUs = true;
    return this.waitUp();
  }

  private async waitUp(): Promise<boolean> {
    for (let attempt = 0; attempt < 30; attempt++) {
      if (await httpUp(this.localUrl())) {
        return true;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    return false;
  }

  /** Stops the container (it is `--rm`, so stop also removes it). */
  async stop(): Promise<boolean> {
    const { ok } = await docker(['stop', CONTAINER_NAME]);
    this.startedByUs = false;
    return ok;
  }

  /** Best-effort stop on deactivate — only for a container we started. */
  stopIfStartedByUs(): void {
    if (this.startedByUs) {
      void docker(['stop', CONTAINER_NAME]);
    }
  }
}
