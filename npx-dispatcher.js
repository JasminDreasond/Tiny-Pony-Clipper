import { spawnSync } from 'child_process';
import { platform } from 'os';

/**
 * Dispatches the npx command based on the current Operating System.
 * @returns {void}
 */
const dispatchBuild = () => {
  /** @type {string} */
  const osPlatform = platform();
  /** @type {string} */
  const target = osPlatform === 'win32' ? 'win' : 'linux';

  console.log(`[Tiny Pony] Detected platform: ${osPlatform}. Starting build:npx:${target}...`);

  // Runs the specific npx command and pipes the output to the terminal
  spawnSync('yarn', [`build:npx:${target}`], {
    stdio: 'inherit',
    shell: true,
  });
};

dispatchBuild();
