export interface CliOption {
  force: boolean;
}

export interface ResolvedOption {}

export interface VideoInfo {
  store: 'ali';

  videoId: string;

  title: string;

  creationTime: string;

  cover: string;

  playUrl: string[];
}

export interface LocalVideoInfo extends VideoInfo {
  filepath: string;

  hash: string;
}

export type AnimeType = 'tv' | 'web' | 'movie' | 'ova';
