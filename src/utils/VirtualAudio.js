import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import { isWin } from '../../win/vigemclient.js';

/** @type {Function} */
const execAsync = promisify(exec);

/** * Keeps track of the loaded PulseAudio/PipeWire module IDs so we can unload them cleanly.
 * @type {string[]}
 */
let loadedModules = [];

/**
 * Creates a temporary virtual microphone (input) and routes the specified physical output to it.
 * This creates an isolated virtual input that Chrome can capture natively via getUserMedia.
 *
 * @param {string} targetOutputSink - The name of the PulseAudio sink to mirror (e.g., 'alsa_output...').
 * @returns {Promise<boolean>} True if the virtual microphone was created successfully.
 */
export const createTemporaryAudioMirror = async (targetOutputSink) => {
  if (isWin) return false;
  try {
    // 1. Create a "Null Sink" which acts as our virtual target device
    /**
     * Executes the module load command and extracts its ID.
     * @param {string} command - The pactl command to run.
     * @returns {Promise<string>} The module ID.
     */
    const loadModule = async (command) => {
      const { stdout } = await execAsync(command);
      return stdout.trim();
    };

    console.log(
      `[VIRTUAL AUDIO] Remapping output [${targetOutputSink}] to a virtual microphone...`,
    );

    // We use module-remap-source to create a true input (source) that listens to the monitor of the output.
    /** @type {string} */
    const remapId = await loadModule(
      `pactl load-module module-remap-source master=${targetOutputSink}.monitor source_name=TinyPonyClipper_Virtual_Mic source_properties=device.description="tiny_pony_clipper_virtual_mic"`,
    );
    loadedModules.push(remapId);

    console.log('[VIRTUAL AUDIO] Virtual microphone established successfully.');
    return true;
  } catch (error) {
    console.error('[VIRTUAL AUDIO ERROR] Failed to create virtual microphone:', error);
    destroyTemporaryAudioMirror(); // Clean up if it partially failed
    return false;
  }
};

/**
 * Destroys the temporary virtual audio devices synchronously.
 * Crucial for the app's "will-quit" event to ensure cleanup before the process dies.
 */
export const destroyTemporaryAudioMirror = () => {
  if (loadedModules.length === 0) return;
  if (isWin) return;

  console.log('[VIRTUAL AUDIO] Cleaning up virtual audio modules...');

  for (const moduleId of loadedModules) {
    try {
      execSync(`pactl unload-module ${moduleId}`);
      console.log(`[VIRTUAL AUDIO] Unloaded module ID: ${moduleId}`);
    } catch (error) {
      console.error(`[VIRTUAL AUDIO ERROR] Failed to unload module ${moduleId}:`, error);
    }
  }

  // Reset the array
  loadedModules = [];
  console.log('[VIRTUAL AUDIO] Cleanup complete.');
};
