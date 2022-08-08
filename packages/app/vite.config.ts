import * as path from 'node:path';
import { createRequire } from 'node:module';

import vue from '@vitejs/plugin-vue';
import { defineConfig, Plugin } from 'vite';

import Unocss from 'unocss/vite';
import Icons from 'unplugin-icons/vite';
import AutoImport from 'unplugin-auto-import/vite';
import Components from 'unplugin-vue-components/vite';

import Pages from 'vite-plugin-pages';
import BuildInfo from 'vite-plugin-info';
import Inspect from 'vite-plugin-inspect';
import { VitePWA } from 'vite-plugin-pwa';

import Bangumi from '@animepaste/bangumi/vite';

import { getMonth, setDate, setMonth, subDays, subYears } from 'date-fns';

// For node v16, ESM does not support import json module
// It fallbacks to node require
const require = createRequire(import.meta.url);
const { items: bgmItems } = require('bangumi-data');

// https://vitejs.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      '~/': `${path.resolve(__dirname, 'src')}/`
    }
  },
  plugins: [
    vue(),
    AutoImport({
      imports: ['vue', 'vue/macros', '@vueuse/core', 'vue-router'],
      dirs: ['./src/composables/**'],
      vueTemplate: true,
      dts: './src/auto-imports.d.ts'
    }),
    Components({
      dts: './src/components.d.ts'
    }),
    Unocss(),
    Icons({
      autoInstall: true
    }),
    Pages({
      dirs: 'src/pages',
      exclude: ['**/components/*.vue', '**/context.ts']
    }),
    BuildInfo({
      github: 'XLorPaste/AnimePaste',
      meta: {
        PUBLIC: process.env.ENABLE_PUBLIC === 'true' ?? false
      }
    }),
    Inspect(),
    // https://github.com/antfu/vite-plugin-pwa
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'favicon.svg',
        'android-chrome-192x192.png',
        'android-chrome-512x512.png',
        'apple-touch-icon.png',
        'favicon-16x16.png',
        'favicon-32x32.png',
        'mstile-70x70.png',
        'mstile-144x144.png',
        'mstile-150x150.png',
        'mstile-310x150.png',
        'mstile-310x310.png',
        'safari-pinned-tab.svg',
        'splash/*.png'
      ],
      manifest: {
        name: 'AnimePaste',
        short_name: 'AnimePaste',
        description: 'Paste your favourite anime online',
        start_url: '/index.html',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        dir: 'ltr',
        lang: 'zh-CN',
        icons: [
          {
            src: '/android-chrome-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: '/android-chrome-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: '/android-chrome-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 4194304,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365 // <== 365 days
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'gstatic-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365 // <== 365 days
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          // Cache bangumi pictures
          {
            urlPattern: /^https:\/\/lain\.bgm\.tv\/pic\/cover\/.*\.jpg$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'bangumi-pictures',
              expiration: {
                maxEntries: 256,
                maxAgeSeconds: 60 * 60 * 24 * 30 // <== 30 days
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
        ]
      }
    }),
    Bangumi(
      {
        id: 'recent',
        fields: ['titleCN', 'begin', 'officialSite'],
        begin: getRecent()
      },
      {
        id: 'all',
        fields: ['titleCN', 'begin', 'officialSite']
      }
    )
    // BangumiDate(200)
  ]
});

function getRecent() {
  const date = new Date();
  const month = getMonth(date);
  if (month <= 3) {
    return subDays(setDate(setMonth(subYears(date, 1), 9), 1), 15);
  } else if (month <= 6) {
    return subDays(setDate(setMonth(date, 0), 1), 15);
  } else if (month <= 9) {
    return subDays(setDate(setMonth(date, 3), 1), 15);
  } else {
    return subDays(setDate(setMonth(date, 6), 1), 15);
  }
}

/**
 * Only bundle first count piece of items
 *
 * @param count static import count
 * @returns
 */
function BangumiDate(count = 100): Plugin {
  const ModuleId = '~bangumi/data';
  const StaticImportCount = count;

  return {
    name: 'bangumi-data',
    resolveId(id) {
      if (id === ModuleId) return id;
    },
    load(id) {
      if (id === ModuleId) {
        bgmItems.sort((lhs, rhs) => {
          const d1 = new Date(lhs.begin).getTime();
          const d2 = new Date(rhs.begin).getTime();
          return d2 - d1;
        });
        const staticImport = [
          `export const bangumis = [`,
          ...bgmItems
            .slice(0, StaticImportCount)
            .map((b) => JSON.stringify(b) + ','),
          `]`
        ];
        return staticImport.join('\n');
      }
    }
  };
}
