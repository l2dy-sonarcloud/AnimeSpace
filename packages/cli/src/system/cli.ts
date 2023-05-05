import openEditor from 'open-editor';
import { type Breadc, breadc } from 'breadc';
import { AnimeSystem, onDeath } from '@animespace/core';

import { version, description } from '../../package.json';

export async function makeCliApp(system: AnimeSystem) {
  const app = breadc('anime', { version, description });
  registerApp(system, app);
  for (const plugin of system.space.plugins) {
    await plugin.command?.(system, app);
  }
  return app;
}

function registerApp(system: AnimeSystem, app: Breadc<{}>) {
  app
    .command('space', 'Display the space directory')
    .option('--storage', 'Display the storage directory')
    .option('--open', 'Open space in your editor')
    .action(async (options) => {
      const root = options.storage ? system.space.storage : system.space.root;
      if (options.open) {
        try {
          openEditor([root]);
        } catch (error) {
          console.log(root);
        }
      } else {
        console.log(root);
      }
      return root;
    });

  app
    .command('refresh', 'Refresh the local anime system')
    .option('-i, --introspect')
    .action(async (options) => {
      registerDeath();

      system.printSpace();
      try {
        if (options.introspect) {
          await system.introspect();
        }
        const animes = await system.refresh();
        return animes;
      } catch (error) {
        throw error;
      } finally {
        await system.writeBack();
      }
    });

  app
    .command('introspect', 'Introspect the local anime system')
    .action(async () => {
      registerDeath();

      system.printSpace();
      try {
        const animes = await system.introspect();
        return animes;
      } catch (error) {
        throw error;
      } finally {
        await system.writeBack();
      }
    });

  function registerDeath() {
    onDeath(async () => {
      await system.writeBack();
    });
  }
}
