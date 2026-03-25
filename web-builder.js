import { rm, mkdir, readdir, copyFile, stat } from 'fs/promises';
import { join } from 'path';

/**
 * @param {string} source
 * @param {string} destination
 * @returns {Promise<void>}
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
            })
        );
    } else {
        await copyFile(source, destination);
    }
};

/**
 * @param {string} path
 * @returns {Promise<void>}
 */
const cleanDirectory = async (path) => {
    /** @type {object} */
    const options = { recursive: true, force: true };
    await rm(path, options);
};

/**
 * @returns {Promise<void>}
 */
const buildWeb = async () => {
    /** @type {string} */
    const srcDir = 'src/public';
    /** @type {string} */
    const distDir = 'dist/web';

    try {
        console.log('Cleaning destination folder...');
        await cleanDirectory(distDir);

        console.log('Starting file copy...');
        await copyRecursive(srcDir, distDir);
        
        console.log('Build completed successfully!');
    } catch (error) {
        /** @type {Error} */
        const err = error;
        console.error('Error during build:', err.message);
    }
};

buildWeb();