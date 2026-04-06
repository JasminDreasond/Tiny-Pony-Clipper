/** @type {HTMLVideoElement} */
export const video = document.getElementById('streamView');
/** @type {HTMLInputElement} */
export const serverInput = document.getElementById('serverHost');
/** @type {HTMLInputElement} */
export const passInput = document.getElementById('pass');
/** @type {HTMLButtonElement} */
export const btnConnect = document.getElementById('btnConnect');
/** @type {HTMLElement} */
export const loginDiv = document.getElementById('login');
/** @type {HTMLButtonElement} */
export const btnToggleDebug = document.getElementById('btnToggleDebug');
/** @type {HTMLElement} */
export const debugPanel = document.getElementById('debugPanel');
/** @type {HTMLInputElement} */
export const wantsAudioInput = document.getElementById('wantsAudio');
/** @type {HTMLInputElement} */
export const wantsVideoInput = document.getElementById('wantsVideo');
/** @type {HTMLInputElement} */
export const stunInput = document.getElementById('stunServer');
/** @type {HTMLSelectElement} */
export const connMethodSelect = document.getElementById('connectionMethod');
/** @type {HTMLElement} */
export const ipSection = document.getElementById('ipSection');
/** @type {HTMLElement} */
export const sdpSection = document.getElementById('manualClientSection');
/** @type {HTMLElement} */
export const clientIdHud = document.getElementById('clientIdHud');
/** @type {HTMLElement} */
export const dbgPing = document.getElementById('dbgPing');

// Keyboard Gamepad UI
/** @type {HTMLInputElement} */
export const useKbPadInput = document.getElementById('useKbPad');
/** @type {HTMLButtonElement} */
export const btnOpenKbConfig = document.getElementById('btnOpenKbConfig');
/** @type {HTMLElement} */
export const kbModal = document.getElementById('kbModal');
/** @type {HTMLCanvasElement} */
export const gamepadCanvas = document.getElementById('gamepadCanvas');
/** @type {HTMLElement} */
export const kbMappings = document.getElementById('kbMappings');
/** @type {HTMLButtonElement} */
export const btnCloseKb = document.getElementById('btnCloseKb');
/** @type {HTMLButtonElement} */
export const btnExportKb = document.getElementById('btnExportKb');
/** @type {HTMLButtonElement} */
export const btnImportKbBtn = document.getElementById('btnImportKbBtn');
/** @type {HTMLInputElement} */
export const btnImportKbFile = document.getElementById('btnImportKbFile');
/** @type {HTMLButtonElement} */
export const btnOpenTx = document.getElementById('btnOpenTx');
/** @type {HTMLButtonElement} */
export const btnCancelKb = document.getElementById('btnCancelKb');
/** @type {HTMLButtonElement} */
export const btnResetKb = document.getElementById('btnResetKb');

/** @type {HTMLButtonElement} */
export const btnHudKbConfig = document.getElementById('btnHudKbConfig');

// Tab Configuration Elements
/** @type {HTMLButtonElement} */
export const tabKbBtn = document.getElementById('tabKbBtn');
/** @type {HTMLButtonElement} */
export const tabProfileBtn = document.getElementById('tabProfileBtn');
/** @type {HTMLElement} */
export const tabKbContent = document.getElementById('tabKbContent');
/** @type {HTMLElement} */
export const tabProfileContent = document.getElementById('tabProfileContent');

// Profile Manager Elements
/** @type {HTMLSelectElement} */
export const profileSelect = document.getElementById('profileSelect');
/** @type {HTMLButtonElement} */
export const btnCreateProfile = document.getElementById('btnCreateProfile');
/** @type {HTMLButtonElement} */
export const btnCloneProfile = document.getElementById('btnCloneProfile');
/** @type {HTMLButtonElement} */
export const btnDeleteProfile = document.getElementById('btnDeleteProfile');
/** @type {HTMLInputElement} */
export const profileName = document.getElementById('profileName');
/** @type {HTMLInputElement} */
export const profileRegex = document.getElementById('profileRegex');
/** @type {HTMLElement} */
export const profileButtonsGrid = document.getElementById('profileButtonsGrid');
/** @type {HTMLElement} */
export const profileAxesGrid = document.getElementById('profileAxesGrid');
/** @type {HTMLElement} */
export const rawGamepadDebugger = document.getElementById('rawGamepadDebugger');
/** @type {HTMLButtonElement} */
export const btnExportProfile = document.getElementById('btnExportProfile');
/** @type {HTMLButtonElement} */
export const btnImportProfileBtn = document.getElementById('btnImportProfileBtn');
/** @type {HTMLInputElement} */
export const btnImportProfileFile = document.getElementById('btnImportProfileFile');
/** @type {HTMLButtonElement} */
export const btnSaveProfile = document.getElementById('btnSaveProfile');

// Debug Elements
/** @type {HTMLElement} */
export const dbgWs = document.getElementById('dbgWs');
/** @type {HTMLElement} */
export const dbgRtcConn = document.getElementById('dbgRtcConn');
/** @type {HTMLElement} */
export const dbgRtcIce = document.getElementById('dbgRtcIce');
/** @type {HTMLElement} */
export const dbgVidTrack = document.getElementById('dbgVidTrack');
/** @type {HTMLElement} */
export const dbgVidPlay = document.getElementById('dbgVidPlay');
/** @type {HTMLElement} */
export const dbgVidRes = document.getElementById('dbgVidRes');
/** @type {HTMLElement} */
export const dbgDc = document.getElementById('dbgDc');
/** @type {HTMLElement} */
export const dbgPad = document.getElementById('dbgPad');
/** @type {HTMLElement} */
export const dbgInput = document.getElementById('dbgInput');

// Manual SDP Elements
/** @type {HTMLButtonElement} */
export const generateOfferBtn = document.getElementById('generateOfferBtn');
/** @type {HTMLTextAreaElement} */
export const myOfferOutput = document.getElementById('myOfferOutput');
/** @type {HTMLButtonElement} */
export const connectManualBtn = document.getElementById('connectManualBtn');
/** @type {HTMLTextAreaElement} */
export const serverAnswerInput = document.getElementById('serverAnswerInput');

// --- API BRIDGE & SERVICE WORKER LOGIC ---

/** @type {HTMLElement} */
export const btnManageApiOrigins = document.getElementById('btnManageApiOrigins');
/** @type {HTMLElement} */
export const apiManagerModal = document.getElementById('apiManagerModal');
/** @type {HTMLElement} */
export const apiOriginList = document.getElementById('apiOriginList');
/** @type {HTMLElement} */
export const btnCloseApiManager = document.getElementById('btnCloseApiManager');

/** @type {HTMLElement} */
export const apiAuthModal = document.getElementById('apiAuthModal');
/** @type {HTMLElement} */
export const apiAuthOriginText = document.getElementById('apiAuthOriginText');
/** @type {HTMLElement} */
export const btnApiDeny = document.getElementById('btnApiDeny');
/** @type {HTMLElement} */
export const btnApiAllow = document.getElementById('btnApiAllow');

// Custom Alert Elements & Overlay
/** @type {HTMLElement} */
export const modalOverlay = document.getElementById('modalOverlay');
/** @type {HTMLElement} */
export const customAlertModal = document.getElementById('customAlertModal');
/** @type {HTMLElement} */
export const customAlertText = document.getElementById('customAlertText');
/** @type {HTMLButtonElement} */
export const btnCustomAlertOk = document.getElementById('btnCustomAlertOk');
