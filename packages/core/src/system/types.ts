import type { ConsolaInstance } from 'consola';

import type { AnimeSpace } from '../space/schema';

import type { Anime } from './anime';

export interface SystemOperationOptions {
  filter?: string | ((anime: Anime) => boolean);
}

export interface LoadOptions extends SystemOperationOptions {
  force?: boolean;
}

export interface RefreshOptions extends SystemOperationOptions {}

export interface IntrospectOptions extends SystemOperationOptions {}

export interface AnimeSystem {
  space: AnimeSpace;

  logger: ConsolaInstance;

  printSpace(): void;

  /**
   * Load animes from plans or introspect result
   */
  load(options?: LoadOptions): Promise<Anime[]>;

  /**
   * Refresh the media library
   */
  refresh(options?: RefreshOptions): Promise<Anime[]>;

  /**
   * Sync with the modified anime config
   */
  introspect(options?: IntrospectOptions): Promise<Anime[]>;

  /**
   * Write back the modified anime library
   */
  writeBack(): Promise<Anime[]>;

  /**
   * Sync return any library is changed
   */
  isChanged(): boolean;
}
