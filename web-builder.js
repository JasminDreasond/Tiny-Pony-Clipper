import { rm, mkdir, readdir, copyFile, stat } from 'fs/promises';
import { join } from 'path';

/**
 * Recursively copies all files and subdirectories from a source path to a destination path.
 *
 * @param {string} source - The absolute or relative path to the source folder or file.
 * @param {string} destination - The absolute or relative path to the target folder.
 * @returns {Promise<void>} Resolves when the copy operation is completely finished.
 */
const copyRecursive = async (source, destination) => {
  /** @type {import('node:fs').Stats} */
  const stats = await stat(source);

  if (stats.isDirectory()) {
    await mkdir(destination, { recursive: true });
    /** @type {string[]} */
    const items = await readdir(source);

    await Promise.all(
      items.map((item) => {
        /** @type {string} */
        const srcPath = join(source, item);
        /** @type {string} */
        const destPath = join(destination, item);
        return copyRecursive(srcPath, destPath);
      }),
    );
  } else {
    await copyFile(source, destination);
  }
};

/**
 * Forcefully removes a directory and all of its contents.
 * Used to clean up the build folder before starting a fresh copy.
 *
 * @param {string} path - The path to the directory to be removed.
 * @returns {Promise<void>} Resolves when the directory is successfully deleted.
 */
const cleanDirectory = async (path) => {
  /** @type {object} */
  const options = { recursive: true, force: true };
  await rm(path, options);
};

/**
 * Orchestrates the web client build process.
 * Cleans the destination directory, copies public assets, and handles the tray icon.
 *
 * @returns {Promise<void>} Resolves when the build script finishes executing.
 */
const buildWeb = async () => {
  /** @type {string} */
  const srcDir = 'src/public';
  /** @type {string} */
  const distDir = 'dist/web';

  try {
    console.log('Cleaning destination folder...');
    await cleanDirectory(distDir);

    console.log('Starting file copy (including HTML and JS)...');
    await copyRecursive(srcDir, distDir);

    console.log('Copying tray icon...');
    /** @type {string} */
    const imgDestDir = join(distDir, 'img');
    await mkdir(imgDestDir, { recursive: true });

    /** @type {string} */
    const srcIconPath = 'src/icons/tray-icon.png';
    /** @type {string} */
    const destIconPath = join(imgDestDir, 'tray-icon.png');
    await copyFile(srcIconPath, destIconPath);

    console.log('Build completed successfully!');
  } catch (error) {
    /** @type {Error} */
    const err = error;
    console.error('Error during build:', err.message);
  }
};

buildWeb();
