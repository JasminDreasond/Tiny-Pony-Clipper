import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { execSync } from 'child_process';

/**
 * Retrieves the absolute path to the authentication whitelist JSON file.
 *
 * @returns {string} The path to the auth list file.
 */
const getAuthPath = () => path.join(app.getPath('userData'), 'cli-auth.json');

/**
 * Loads the authentication whitelist from the disk.
 * Since the file has 644 permissions, the standard user can read it without root access.
 *
 * @returns {Record<string, boolean>} The dictionary of authenticated applications.
 */
export const loadAuthList = () => {
  try {
    /** @type {string} */
    const authPath = getAuthPath();
    if (fs.existsSync(authPath)) {
      return JSON.parse(fs.readFileSync(authPath, 'utf-8'));
    }
  } catch (e) {
    console.error('[AUTH ERROR] Failed to load auth list:', e);
  }
  return {};
};

/**
 * Saves the authentication whitelist to the disk using root privileges via pkexec.
 * It pipes the JSON data directly from memory to the root process, avoiding temporary files on disk.
 *
 * @param {Record<string, boolean>} list - The updated authentication dictionary.
 * @returns {void}
 */
export const saveAuthList = (list) => {
  try {
    /** @type {string} */
    const authPath = getAuthPath();
    /** @type {string} */
    const jsonString = JSON.stringify(list, null, 4);

    // Elevates privileges and pipes the JSON string directly into the file via stdin
    execSync(
      `pkexec sh -c "cat > '${authPath}' && chown root:root '${authPath}' && chmod 644 '${authPath}'"`,
      {
        input: jsonString,
        encoding: 'utf-8',
      },
    );

    console.log('[AUTH] Auth list securely saved directly from memory as root.');
  } catch (e) {
    console.error(
      '[AUTH ERROR] Failed to save auth list. The user might have canceled the authentication prompt or an error occurred.',
      e,
    );
  }
};

/**
 * Checks the authorization status of a given application path.
 *
 * @param {string} callerPath - The executable path of the calling application.
 * @returns {boolean | null} True if allowed, false if denied, null if unknown.
 */
export const checkAuth = (callerPath) => {
  /** @type {Record<string, boolean>} */
  const list = loadAuthList();
  if (list[callerPath] !== undefined) {
    return list[callerPath];
  }
  return null;
};

/**
 * Sets or updates the authorization status for a specific application.
 *
 * @param {string} callerPath - The executable path of the calling application.
 * @param {boolean} isAllowed - The authorization status to set.
 * @returns {void}
 */
export const setAuth = (callerPath, isAllowed) => {
  /** @type {Record<string, boolean>} */
  const list = loadAuthList();
  list[callerPath] = isAllowed;
  saveAuthList(list);
};

/**
 * Removes an application from the authentication whitelist.
 *
 * @param {string} callerPath - The executable path of the application to remove.
 * @returns {void}
 */
export const removeAuth = (callerPath) => {
  /** @type {Record<string, boolean>} */
  const list = loadAuthList();
  delete list[callerPath];
  saveAuthList(list);
};
