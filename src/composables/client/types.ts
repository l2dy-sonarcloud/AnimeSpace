export interface OnairAnime {
  title: string;

  bgmId: string;

  episodes: OnairEpisode[];

  link?: string;
}

export interface OnairEpisode {
  /**
   * 条目内的集数, 从 1 开始
   */
  ep: number;

  /**
   * Video qulity
   */
  quality: 1080 | 720;

  /**
   * Airdate
   */
  creationTime: string;

  /**
   * Play url
   */
  playURL: string;
}

export interface HistoryLog {
  bgmId: string;

  ep: number;

  progress: number;

  timestamp: string;
}
