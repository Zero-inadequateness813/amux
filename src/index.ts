// amux — agentic mux
// Library entrypoint

export {
  // Core API
  run,
  sendKeys,
  tail,
  panelGet,
  kill,
  list,
  watch,
  terminate,

  // Panel management
  ensurePanel,
  panels,

  // Session management
  ensureSession,
  hasSession,
  serverRunning,

  // Configuration
  config,
  MAX_TIMEOUT,

  // Detection
  detectInputWait,
  normalizeKey,
  validatePanelName,
  stripAnsi,
  clampTimeout,

  // Panel logs
  panelLogPath,
  panelCwd,

  // Low-level
  tmux,
  socketPath,
  saveTimeoutLog,

  // Errors
  AmuxError,
  TmuxError,
  PanelNotFound,
  InvalidPanelName,

  // Constants
  SPECIAL_KEYS,
  VALID_PANEL_NAME,
  INTERACTIVE_PROMPT_RE,
  DONE_SENTINEL_RE,

  // Types
  type TabInfo,
  type PaneInfo,
} from "./amux.ts";
