import { exec } from 'child_process';

/**
 * @param {string} appPath
 * @param {string} base64Data
 * @returns {void}
 */
const processWebRTCStep = (appPath, base64Data) => {
  if (!base64Data) {
    console.error('Error: Please provide the Base64 offer as an argument.');
    return;
  }

  const command = `"${appPath}" --process-sdp "${base64Data}"`;

  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error('Execution failed:', error);
      return;
    }

    try {
      const response = JSON.parse(stdout.trim());

      if (response.status === 'success') {
        console.log("Success! Here is the Server Answer (Base64):", response.data);
      // You can now send this answer back to your client
      } else {
        console.error('CLI Error:', response.error);
      }
    } catch (parseError) {
      console.error('Failed to parse CLI output:', stdout);
    }
  });
};

// process.argv[0] is node, [1] is the script path, [2] is our argument
const appPath = process.argv[2];
const inputBase64 = process.argv[3];
processWebRTCStep(appPath, inputBase64);
