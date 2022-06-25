import { defineStore } from 'pinia';
import { useLocalStorage, useUrlSearchParams } from '@vueuse/core';

import type { OnairAnime, OnairEpisode } from './types';
import { UserClient } from './user';

export { UserClient };
export type { OnairAnime, OnairEpisode };

export const useClient = defineStore('client', () => {
  const query = useUrlSearchParams('history');
  const token = ref(
    useLocalStorage(
      'animepaste:token',
      typeof query.token === 'string' ? query.token : ''
    )
  );

  const client = computed(() =>
    Boolean(token.value) ? new UserClient(token.value) : undefined
  );

  const onair = ref(useLocalStorage('animepaste:onair', [] as OnairAnime[]));

  const onairMap = computed(() => {
    const map = new Map<string, OnairAnime>();
    for (const anime of onair.value) {
      map.set(anime.bgmId, anime);
    }
    return map;
  });

  watch(
    client,
    async (client) => {
      if (client) {
        try {
          const result = await client.fetchOnair();
          onair.value.splice(0);
          onair.value.push(...result);
        } catch {
          token.value = '';
        }
      }
    },
    { immediate: true }
  );

  return {
    token,
    client,
    onair,
    onairMap
  };
});
