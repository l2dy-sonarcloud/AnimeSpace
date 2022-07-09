import * as fs from 'fs-extra';
import * as path from 'node:path';
import { homedir } from 'node:os';

import { subMonths } from 'date-fns';
import { load, dump } from 'js-yaml';

import { MagnetStore, VideoStore } from '@animepaste/database';

import type { CliOption, Plan } from '../types';
import type { VideoInfo, VideoStorePlatform } from '../io';

import { Anime } from '../anime';

export interface GlobalConfig {
  plan: string | string[];

  server: {
    baseURL: string;

    token: string;
  };

  store: {};
}

const DefaultGlobalConfig: GlobalConfig = {
  plan: ['./plans/test.yaml'],
  server: {
    baseURL: 'https://anime.xlorpaste.cn/api/',
    token: ''
  },
  store: {
    local: {
      anime: './anime',
      cache: './cache'
    },
    ali: {
      accessKeyId: '',
      accessKeySecret: '',
      endpoint: ''
    }
  }
};

export class GlobalContex {
  static ConfigFileName = 'config.yaml';
  static AnimeDdName = 'anime.json';

  cliOption!: CliOption;

  readonly root: string;
  readonly anime: string;
  readonly config: string;
  readonly databaseFilepath: string;

  readonly videoStore: VideoStore<VideoStorePlatform>;
  readonly magnetStore: MagnetStore;

  private _cacheRoot: string;
  private _localRoot: string;

  private configCache: any;
  private animeCache: Map<string, Anime> = new Map();

  constructor() {
    this.root = path.join(homedir(), '.animepaste');
    this._cacheRoot = path.join(this.root, 'cache');
    this._localRoot = path.join(this.root, 'anime');

    this.anime = path.join(this.root, GlobalContex.AnimeDdName);
    this.config = path.join(this.root, GlobalContex.ConfigFileName);

    this.databaseFilepath = path.join(this.root, 'store.db');
    this.videoStore = new VideoStore({ url: this.databaseFilepath });
    this.magnetStore = new MagnetStore({ url: this.databaseFilepath });
  }

  get localRoot() {
    return this._localRoot;
  }

  get cacheRoot() {
    return this._cacheRoot;
  }

  async init(option: CliOption) {
    this.cliOption = option;

    await fs.ensureDir(this.root);
    await fs.ensureDir(path.join(this.root, 'anime'));
    await fs.ensureDir(path.join(this.root, 'cache'));
    await fs.ensureDir(path.join(this.root, 'plans'));

    if (!(await fs.pathExists(this.config))) {
      fs.writeFile(
        this.config,
        dump(DefaultGlobalConfig, { indent: 2 })
          .replace('server', '\nserver')
          .replace('store', '\nstore'),
        'utf-8'
      );
    }

    // Setup cache and anime root
    {
      type LocalConfig = { anime?: string; cache?: string };
      const local = await this.getStoreConfig<LocalConfig>('local');
      if (local?.anime) {
        this._localRoot = path.resolve(this.root, local.anime);
      }
      if (!fs.existsSync(this._localRoot)) {
        throw new Error(
          `Local stroage root "${this._localRoot}" does not exist`
        );
      }
      if (local?.cache) {
        this._cacheRoot = path.resolve(this.root, local.cache);
      }
      if (!fs.existsSync(this._cacheRoot)) {
        throw new Error(
          `Local stroage root "${this._cacheRoot}" does not exist`
        );
      }
    }

    if (fs.existsSync(this.anime)) {
      const animes = JSON.parse(
        await fs.readFile(this.anime, 'utf-8')
      ) as Anime[];
      this.animeCache.clear();
      for (const anime of animes) {
        this.animeCache.set(anime.bgmId, Anime.copy(anime));
      }
    }

    await this.magnetStore.ensure();
    await this.loadConfig();
  }

  async makeLocalAnimeRoot(title: string) {
    const local = path.join(this.localRoot, title);
    await fs.ensureDir(local);
    return local;
  }

  async loadConfig<T = any>(): Promise<T> {
    const content = await fs.readFile(this.config, 'utf-8');
    this.configCache = load(content);
    return this.configCache;
  }

  async getPlans(): Promise<Plan[]> {
    const config = await this.loadConfig<GlobalConfig>();
    const planPath = Array.isArray(config.plan) ? config.plan : [config.plan];
    const planBody: Plan[] = [];
    for (const plan of planPath) {
      const planPath = path.join(this.root, plan);
      if (!fs.existsSync(planPath)) {
        throw new Error(`You should provide plan "${plan}"`);
      }
      const body = load(fs.readFileSync(planPath, 'utf-8')) as Plan;
      // Setup date (default: 6 months ago)
      if (!Boolean(body.date)) {
        body.date = subMonths(new Date(), 6);
      } else {
        body.date = new Date(body.date);
      }
      // Setup state (default: onair)
      if (!Boolean(body.state)) {
        body.state = 'onair';
      }
      // Setup store platform (default: ali)
      if (!Boolean(body.store)) {
        body.store = 'ali';
      }
      // Fix bgmId string type
      for (const bgm of body.onair) {
        if (typeof bgm.bgmId === 'number') {
          bgm.bgmId = String(bgm.bgmId);
        }
      }
      planBody.push(body);
    }
    return planBody;
  }

  async getServerConfig(): Promise<GlobalConfig['server']> {
    const config = await this.loadConfig<GlobalConfig>();
    return config.server;
  }

  async getStoreConfig<T = any>(key: string): Promise<T> {
    return (await this.loadConfig()).store[key];
  }

  // -----------

  /**
   * Anime
   */
  async getAnime(bgmId: string): Promise<Anime | undefined> {
    return this.animeCache.get(bgmId);
  }

  async updateAnime(anime: Anime) {
    this.animeCache.set(anime.bgmId, anime);
    const content = [...this.animeCache.values()];
    await fs.writeFile(this.anime, JSON.stringify(content, null, 2), 'utf-8');
  }

  // -----------

  /**
   * Copy file from "src" to cache root
   *
   * @param src
   */
  async copyToCache(src: string) {
    if (contains(this.localRoot, src) || contains(this.cacheRoot, src)) {
      return src;
    }
    const filepath = path.join(this.cacheRoot, path.basename(src));
    await fs.copy(src, filepath);
    return filepath;
  }

  encodePath(src: string) {
    if (contains(this.localRoot, src)) {
      return 'local:' + path.relative(this.localRoot, src);
    } else {
      return 'cache:' + path.relative(this.cacheRoot, src);
    }
  }

  decodePath(src: string) {
    if (src.startsWith('local:')) {
      return path.join(this.localRoot, src.substring(6));
    } else if (src.startsWith('cache:')) {
      return path.join(this.cacheRoot, src.substring(6));
    } else {
      return src;
    }
  }
}

export const context = new GlobalContex();

function contains(parent: string, dir: string) {
  const relative = path.relative(parent, dir);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}
