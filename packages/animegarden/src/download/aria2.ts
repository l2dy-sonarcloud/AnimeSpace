import fs from 'fs-extra';
import path from 'path';
import { spawn } from 'node:child_process';

import type { ConsolaInstance } from 'consola';
import { AnimeSystem, formatStringArray } from '@animespace/core';

import { defu } from 'defu';
import { WebSocket } from 'libaria2';
import { MutableMap } from '@onekuma/map';

import { getProxy } from '../ufetch';

import { Aria2Trackers } from './trackers';
import { DownloadClient, DownloadOptions, DownloadState } from './base';

interface Aria2Options {
  directory: string;

  port: number;

  secret: string;

  args: string[];

  proxy: string | boolean;

  debug: {
    pipe: boolean;

    log: string | undefined;
  };
}

export class Aria2Client extends DownloadClient {
  private options: Aria2Options;

  private logger: ConsolaInstance;

  private started = false;

  private client!: WebSocket.Client;

  private version!: string;

  private heartbeat!: NodeJS.Timer;

  private gids = new Map<string, Task>();

  public constructor(system: AnimeSystem, options: Partial<Aria2Options> = {}) {
    super(system);
    this.logger = system.logger.withTag('aria2');
    this.options = defu(options, {
      directory: './temp',
      port: 6800,
      secret: 'animespace',
      args: [],
      proxy: false,
      debug: { pipe: false, log: undefined }
    });
    this.options.directory = system.space.resolvePath(this.options.directory);
    if (this.options.debug.log) {
      this.options.debug.log = system.space.resolvePath(this.options.debug.log);
    }
  }

  public async download(
    key: string,
    magnet: string,
    options: DownloadOptions = {}
  ): Promise<{ files: string[] }> {
    await this.start();

    const proxy =
      typeof this.options.proxy === 'string' ? this.options.proxy : getProxy();
    const gid = await this.client.addUri([magnet], {
      dir: this.options.directory,
      'bt-tracker': Aria2Trackers,
      'no-proxy': this.options.proxy === false ? true : false,
      'all-proxy': this.options.proxy !== false ? proxy : undefined
    });

    const that = this;
    const client = this.client;

    return new Promise((res, rej) => {
      const task: Task = {
        key,
        state: 'waiting',
        magnet,
        gids: {
          metadata: gid,
          files: new Set()
        },
        progress: MutableMap.empty(),
        options,
        async onDownloadStart(gid) {
          const status = await client.tellStatus(gid);
          await that.updateStatus(task, status);
        },
        async onDownloadError(gid) {
          const status = await client.tellStatus(gid);
          await that.updateStatus(task, status);
          if (task.state === 'error') {
            rej(new Error(status.errorMessage));
          }
        },
        async onDownloadComplete(gid) {},
        async onBtDownloadComplete(gid) {
          const status = await client.tellStatus(gid);
          await that.updateStatus(task, status);
          if (task.state === 'complete') {
            const statuses = await Promise.all(
              [...task.gids.files].map((gid) => client.tellStatus(gid))
            );
            const files = [];
            for (const status of statuses) {
              for (const f of status.files) {
                files.push(f.path);
              }
            }

            res({ files });
          }
        }
      };
      this.gids.set(gid, task);
    });
  }

  private registerCallback() {
    // Download Start
    this.client.addListener('aria2.onDownloadStart', async (event) => {
      const { gid } = event;
      if (this.gids.has(gid)) {
        await this.gids.get(gid)!.onDownloadStart(gid);
      }
    });

    // Download Error
    this.client.addListener('aria2.onDownloadError', async ({ gid }) => {
      if (this.gids.has(gid)) {
        await this.gids.get(gid)!.onDownloadError(gid);
        this.gids.delete(gid);
      }
    });

    // Download and seed complete
    this.client.addListener('aria2.onDownloadComplete', async ({ gid }) => {
      if (this.gids.has(gid)) {
        await this.gids.get(gid)!.onDownloadComplete(gid);
      }
    });

    // Donwload complete but still seeding
    this.client.addListener('aria2.onBtDownloadComplete', async ({ gid }) => {
      if (this.gids.has(gid)) {
        await this.gids.get(gid)!.onBtDownloadComplete(gid);
        this.gids.delete(gid);
      }
    });

    // Hearbeat to monitor download status
    this.heartbeat = setInterval(async () => {
      await Promise.all(
        [...this.gids].map(async ([gid, task]) => {
          const status = await this.client.tellStatus(gid);
          await this.updateStatus(task, status);
          if (task.state === 'complete') {
            await task.onBtDownloadComplete(gid);
          } else if (task.state === 'error') {
            await task.onDownloadError(gid);
          }
        })
      );
    }, 500);
  }

  private async updateStatus(task: Task, status: IAria2DownloadStatus) {
    const oldState = task.state;
    const gid = status.gid;

    const connections = Number(status.connections);
    const speed = Number(status.downloadSpeed);

    // error and complete have no following state
    if (oldState === 'error' || oldState === 'complete') {
      return;
    }

    const force = !task.progress.has(gid);
    const progress = task.progress.getOrPut(gid, () => ({
      state: 'active',
      completed: status.completedLength,
      total: status.totalLength,
      connections,
      speed
    }));
    const oldProgress = { ...progress };
    const updateProgress = () => {
      progress.completed = status.completedLength;
      progress.total = status.totalLength;
      progress.connections = connections;
      progress.speed = speed;
    };

    if (task.gids.metadata === gid) {
      switch (status.status) {
        case 'active':
          if (oldProgress.state === 'active') {
            updateProgress();
          }
          if (task.state === 'waiting') {
            task.state = 'metadata';
          }
          break;
        case 'error':
          // Force set error state
          task.state = 'error';
          progress.state = 'error';
          updateProgress();
          break;
        case 'complete':
          // Force set complete state
          progress.state = 'complete';
          updateProgress();

          // Add followed files to current task
          const followed = formatStringArray(status.followedBy);
          for (const f of followed) {
            task.gids.files.add(f);
            this.gids.set(f, task);
          }

          // Metadata ok, transfer to downloading state
          if (task.state === 'metadata' || task.state === 'waiting') {
            task.state = 'downloading';
          }

          break;
        case 'paused':
          this.logger.warn(`Download task ${task.key} was unexpectedly paused`);
          break;
        case 'waiting':
        default:
          break;
      }

      // Trigger progress update
      const payload = {
        completed: progress.completed,
        total: progress.total,
        connections,
        speed
      };
      if (
        force ||
        oldState !== task.state ||
        oldProgress.state !== progress.state ||
        oldProgress.completed !== progress.completed ||
        oldProgress.total !== progress.total ||
        oldProgress.connections !== progress.connections ||
        oldProgress.speed !== progress.speed
      ) {
        if (task.state === 'metadata') {
          await task.options.onMetadataProgress?.(payload);
        } else if (task.state === 'downloading') {
          await task.options.onMetadataComplete?.(payload);
        } else if (task.state === 'error') {
          await task.options.onError?.({
            message: status.errorMessage,
            code: status.errorCode
          });
        } else {
          this.logger.warn(
            `Download task ${task.key} entered unexpectedly state`
          );
        }
      }
    } else {
      switch (status.status) {
        case 'active':
          if (oldProgress.state === 'active') {
            updateProgress();
          }
          break;
        case 'error':
          // Force set error state
          task.state = 'error';
          progress.state = 'error';
          updateProgress();
          break;
        case 'complete':
          // Force set complete state
          progress.state = 'complete';
          updateProgress();
          break;
        case 'paused':
          this.logger.warn(`Download task ${task.key} was unexpectedly paused`);
          break;
        case 'waiting':
        default:
          break;
      }

      if (
        force ||
        oldState !== task.state ||
        oldProgress.state !== progress.state ||
        oldProgress.completed !== progress.completed ||
        oldProgress.total !== progress.total ||
        oldProgress.connections !== progress.connections ||
        oldProgress.speed !== progress.speed
      ) {
        let active = false;
        let completed = BigInt(0),
          total = BigInt(0);
        for (const p of task.progress.values()) {
          completed += p.completed;
          total += p.total;
          if (p.state === 'active') {
            active = true;
          }
        }

        const payload = { completed, total, connections, speed };
        if (progress.state === 'active') {
          await task.options.onProgress?.(payload);
        } else if (progress.state === 'complete') {
          if (active) {
            await task.options.onProgress?.(payload);
          } else {
            // Finish all the download
            task.state = 'complete';
            await task.options.onComplete?.(payload);
          }
        } else if (progress.state === 'error') {
          await task.options.onError?.({
            message: status.errorMessage,
            code: status.errorCode
          });
        }
      }
    }
  }

  public async start(): Promise<void> {
    if (this.started || this.client || this.version) return;
    this.started = true;

    if (this.options.debug.log) {
      await fs.ensureDir(path.dirname(this.options.debug.log));
      if (await fs.exists(this.options.debug.log)) {
        await fs.rm(this.options.debug.log);
      }
      this.system.logger.info(
        `Write aria2 debug logs to ${this.options.debug.log}`
      );
    }

    const env = { ...process.env };
    delete env['all_proxy'];
    delete env['ALL_PROXY'];
    delete env['http_proxy'];
    delete env['https_proxy'];
    delete env['HTTP_PROXY'];
    delete env['HTTPS_PROXY'];
    const child = spawn(
      'aria2c',
      [
        '--enable-rpc',
        '--rpc-listen-all',
        '--rpc-allow-origin-all',
        `--rpc-listen-port=${this.options.port}`,
        `--rpc-secret=${this.options.secret}`,
        ...(this.options.debug.log ? [`--log=${this.options.debug.log}`] : []),
        ...this.options.args
      ],
      { cwd: process.cwd(), env }
    );

    return new Promise((res) => {
      if (this.options.debug.pipe) {
        child.stdout.on('data', (chunk) => {
          console.log(chunk.toString());
        });
        child.stderr.on('data', (chunk) => {
          console.log(chunk.toString());
        });
      }

      child.stdout.once('data', async (_chunk) => {
        this.client = new WebSocket.Client({
          protocol: 'ws',
          host: 'localhost',
          port: this.options.port,
          auth: {
            secret: this.options.secret
          }
        });
        this.registerCallback();

        const version = await this.client.getVersion();
        this.version = version.version;
        this.system.logger.info(`aria2 v${this.version} is running`);
        res();
      });
    });
  }

  public async close() {
    clearInterval(this.heartbeat);
    if (this.client) {
      const version = this.version;
      const res = await this.client.shutdown();
      await this.client.close();
      if (res === 'OK') {
        // @ts-ignore
        this.client = undefined;
        // @ts-ignore
        this.version = undefined;
        this.system.logger.info(`aria2 v${version} has been closed`);
        this.started = false;
        return true;
      } else {
        return false;
      }
    } else {
      return false;
    }
  }
}

interface Task {
  key: string;

  state: DownloadState;

  magnet: string;

  gids: {
    metadata: string;

    files: Set<string>;
  };

  progress: MutableMap<
    string,
    {
      state: 'active' | 'error' | 'complete';
      total: bigint;
      completed: bigint;
      connections: number;
      speed: number;
    }
  >;

  options: DownloadOptions;

  onDownloadStart: (gid: string) => Promise<void>;

  onDownloadError: (gid: string) => Promise<void>;

  onDownloadComplete: (gid: string) => Promise<void>;

  onBtDownloadComplete: (gid: string) => Promise<void>;
}

type IAria2DownloadStatus = Awaited<ReturnType<WebSocket.Client['tellStatus']>>;
