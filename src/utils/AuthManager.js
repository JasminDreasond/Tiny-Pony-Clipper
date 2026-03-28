import fs from 'fs';
import path from 'path';
import { app } from 'electron';

/**
 * Retrieves the absolute path to the authentication whitelist JSON file.
 *
 * @returns {string} The path to the auth list file.
 */
const getAuthPath = () => path.join(app.getPath('userData'), 'cli-auth.json');

/**
 * Loads the authentication whitelist from the disk.
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
 * Saves the authentication whitelist to the disk.
 *
 * @param {Record<string, boolean>} list
 * @returns {void}
 */
export const saveAuthList = (list) => {
  fs.writeFileSync(getAuthPath(), JSON.stringify(list, null, 4));
};

/**
 * Checks the authorization status of a given application path.
 *
 * @param {string} callerPath
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
 * @param {string} callerPath
 * @param {boolean} isAllowed
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
 * @param {string} callerPath
 * @returns {void}
 */
export const removeAuth = (callerPath) => {
  /** @type {Record<string, boolean>} */
  const list = loadAuthList();
  delete list[callerPath];
  saveAuthList(list);
};
