import { spawnSync } from 'child_process';
import { platform } from 'os';

/**
 * Dispatches the build command based on the current Operating System.
 * @returns {void}
 */
const dispatchBuild = () => {
  /** @type {string} */
  const osPlatform = platform();
  /** @type {string} */
  const target = osPlatform === 'win32' ? 'win' : 'linux';

  console.log(`[Tiny Pony] Detected platform: ${osPlatform}. Starting build:${target}...`);

  // Runs the specific build command and pipes the output to the terminal
  spawnSync('yarn', [`build:${target}`], {
    stdio: 'inherit',
    shell: true,
  });
};

dispatchBuild();
