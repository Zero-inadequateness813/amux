// amux — agentic mux
//
// Architecture:
//   - One global tmux session ("amux") with its own socket and config.
//   - Each unique cwd maps to a tmux window (tab), named after the directory.
//   - Each named panel is a tmux pane tiled within that window.
//   - `amux watch` shows all windows as tabs, with panes tiled inside.

import { existsSync, mkdirSync, statSync, rmSync, openSync, readSync, readFileSync, readdirSync, closeSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join, resolve, dirname, basename } from "path";
import { spawnSync, execFileSync } from "child_process";
import { fileURLToPath } from "url";

// -- errors -------------------------------------------------------------------

export class AmuxError extends Error {
  constructor(message: string) { super(message); this.name = "AmuxError"; }
}
export class TmuxError extends AmuxError {
  constructor(message: string) { super(message); this.name = "TmuxError"; }
}
export class PanelNotFound extends AmuxError {
  constructor(message: string) { super(message); this.name = "PanelNotFound"; }
}
export class InvalidPanelName extends AmuxError {
  constructor(message: string) { super(message); this.name = "InvalidPanelName"; }
}

// -- constants ----------------------------------------------------------------

export const SPECIAL_KEYS: Record<string, string> = {
  Enter: "Enter", Tab: "Tab", Esc: "Escape", BSpace: "BSpace", Space: "Space",
  Up: "Up", Down: "Down", Left: "Left", Right: "Right",
};

export const VALID_PANEL_NAME = /^[a-zA-Z0-9_-]+$/;

// Sentinel emitted by bashrc PROMPT_COMMAND when a command completes.
// Format: AMUX_DONE:<exit_code>:<panel_name>  (on its own line)
export const DONE_SENTINEL_RE = /^AMUX_DONE:(\d+):(.+)$/;

// Interactive prompt patterns
export const INTERACTIVE_PROMPT_RE = new RegExp(
  [
    "(?:password|passphrase|passcode)\\s*:\\s*$",
    "\\[y/n\\]\\s*:?\\s*$",
    "\\(y/n\\)\\s*:?\\s*$",
    "\\[yes/no\\]\\s*:?\\s*$",
    "continue\\?\\s*\\[y/n\\]\\s*$",
    "press\\s+(?:enter|return|any\\s+key)",
    "enter\\s+(?:password|passphrase|pin)\\s*:\\s*$",
  ].join("|"),
  "i"
);

export const MAX_TIMEOUT = 300; // 5 minutes absolute cap

// -- configuration ------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");

export const config = {
  sessionName: "amux",
  socketName: "amux",
  tmuxConf: join(ROOT, "conf", "amux", "tmux.conf"),
  bashRc: join(ROOT, "conf", "amux", "bashrc"),
  logDir: join(homedir(), ".amux", "logs"),
  panelDir: join(homedir(), ".amux", "panels"),
};

function shellCmd(): string {
  return `bash --rcfile ${shellEscape(config.bashRc)} --noprofile`;
}

// -- helpers ------------------------------------------------------------------

function shellEscape(s: string): string {
  if (s === "") return "''";
  if (/^[a-zA-Z0-9_./-]+$/.test(s)) return s;
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

const sleepBuffer = new SharedArrayBuffer(4);
const sleepArray = new Int32Array(sleepBuffer);
function sleepSync(ms: number): void {
  Atomics.wait(sleepArray, 0, 0, ms);
}

function monotonic(): number {
  return performance.now() / 1000;
}

export function clampTimeout(t: number): number {
  return Math.max(0, Math.min(t, MAX_TIMEOUT));
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// -- ANSI stripping -----------------------------------------------------------

export function stripAnsi(text: string): string {
  return text
    .replace(/\x1b\][\s\S]*?(?:\x1b\\|\x07)/g, "")  // OSC
    .replace(/\x1b\[[\d;?]*[A-Za-z]/g, "")            // CSI
    .replace(/\x1b[^[\]]/g, "")                        // two-byte escapes
    .replace(/[\x00-\x08\x0b-\x1f]/g, "");            // control chars
}

// -- line detection -----------------------------------------------------------

export function detectInputWait(
  line: string,
  panelName: string
): "prompt" | "interactive" | false {
  if (DONE_SENTINEL_RE.test(line)) return "prompt";

  // Prompt: "NAME $ " or "NAME [exit N] $ "
  const promptRe = new RegExp(
    `^${escapeRegex(panelName)}\\s+(\\[exit \\d+\\]\\s+)?\\$\\s*$`
  );
  if (promptRe.test(line)) return "prompt";

  if (INTERACTIVE_PROMPT_RE.test(line)) return "interactive";
  return false;
}

// -- panel name validation ----------------------------------------------------

export function validatePanelName(name: string | undefined | null): asserts name is string {
  if (name == null) throw new InvalidPanelName("panel name cannot be nil");
  if (name === "") throw new InvalidPanelName("panel name cannot be empty");
  if (!VALID_PANEL_NAME.test(name))
    throw new InvalidPanelName(`invalid panel name "${name}" — use only [a-zA-Z0-9_-]`);
}

// -- tmux primitives ----------------------------------------------------------

function tmuxBase(): string[] {
  return ["tmux", "-L", config.socketName, "-f", config.tmuxConf];
}

export function socketPath(): string {
  const base = process.env.TMUX_TMPDIR || "/tmp";
  return join(base, `tmux-${process.getuid!()}`, config.socketName);
}

export function serverRunning(): boolean {
  return existsSync(socketPath());
}

export function tmux(args: string[], opts?: { allowFail?: boolean }): string {
  const cmd = tmuxBase();
  const all = [...cmd, ...args];
  const result = spawnSync(all[0], all.slice(1), {
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  const out = (result.stdout ?? "") + (result.stderr ?? "");
  if (result.status === 0 || opts?.allowFail) return out;
  throw new TmuxError(`tmux ${args[0]}: ${out.trim()}`);
}

function reloadConfig(): void {
  if (!serverRunning()) return;
  const all = [...tmuxBase(), "source-file", config.tmuxConf];
  spawnSync(all[0], all.slice(1), { stdio: ["ignore", "ignore", "ignore"] });
}

export function hasSession(): boolean {
  if (!serverRunning()) return false;
  const all = [...tmuxBase(), "has-session", "-t", config.sessionName];
  const result = spawnSync(all[0], all.slice(1), { stdio: ["ignore", "ignore", "ignore"] });
  return result.status === 0;
}

export function ensureSession(): void {
  reloadConfig();
  if (hasSession()) return;
  const tabName = cwdToTabName(process.cwd());
  tmux([
    "new-session", "-d",
    "-s", config.sessionName,
    "-n", tabName,
    "-c", process.cwd(),
    shellCmd(),
  ]);
}

// -- tab (window) management --------------------------------------------------
//
// Each unique cwd maps to a tmux window (tab). The window name is derived
// from the directory basename, disambiguated if needed.

function cwdToTabName(cwd: string): string {
  // Use last path component, or "root" for /
  const name = basename(resolve(cwd)) || "root";
  // Sanitize for tmux window name
  return name.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 30);
}

export interface TabInfo {
  windowId: string;
  windowIndex: number;
  windowName: string;
}

export interface PaneInfo {
  paneId: string;
  paneName: string;  // AMUX_PANEL env
  windowId: string;
  windowName: string;
}

/** List all windows (tabs) in the session. */
function listWindows(): TabInfo[] {
  if (!hasSession()) return [];
  const out = tmux([
    "list-windows", "-t", config.sessionName,
    "-F", "#{window_id}\t#{window_index}\t#{window_name}",
  ], { allowFail: true });
  const tabs: TabInfo[] = [];
  for (const line of out.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [windowId, idx, windowName] = trimmed.split("\t");
    if (!windowId || !idx) continue;
    tabs.push({ windowId, windowIndex: parseInt(idx, 10), windowName: windowName || "" });
  }
  return tabs;
}

// -- pane registry (sidecar files) --------------------------------------------
//
// tmux doesn't expose pane environment variables in format strings, so we
// track the name→paneId mapping via sidecar files:
//   ~/.amux/panels/{name}.pane  →  contains pane_id (e.g. %3)
//   ~/.amux/panels/{name}.tab   →  contains window name (tab)

function panePanePath(name: string): string {
  return join(config.panelDir, `${name}.pane`);
}

function paneTabPath(name: string): string {
  return join(config.panelDir, `${name}.tab`);
}

function savePaneMapping(name: string, paneId: string, tabName: string): void {
  mkdirSync(config.panelDir, { recursive: true });
  writeFileSync(panePanePath(name), paneId);
  writeFileSync(paneTabPath(name), tabName);
}

function loadPaneId(name: string): string | undefined {
  try { return readFileSync(panePanePath(name), "utf-8").trim() || undefined; } catch { return undefined; }
}

function loadPaneTab(name: string): string | undefined {
  try { return readFileSync(paneTabPath(name), "utf-8").trim() || undefined; } catch { return undefined; }
}

/** Check if a tmux pane still exists. */
function paneAlive(paneId: string): boolean {
  const out = tmux(["list-panes", "-s", "-t", config.sessionName, "-F", "#{pane_id}"], { allowFail: true });
  return out.split("\n").some(l => l.trim() === paneId);
}

/** List all registered panels (reads sidecar files, validates against tmux). */
function listAllPanes(): PaneInfo[] {
  if (!hasSession()) return [];
  try {
    const files = readdirSync(config.panelDir);
    const panes: PaneInfo[] = [];
    for (const f of files) {
      if (!f.endsWith(".pane")) continue;
      const name = f.slice(0, -5); // strip .pane
      const paneId = loadPaneId(name);
      const tabName = loadPaneTab(name);
      if (!paneId || !tabName) continue;
      if (!paneAlive(paneId)) {
        // Stale — clean up
        try { rmSync(panePanePath(name), { force: true }); } catch {}
        try { rmSync(paneTabPath(name), { force: true }); } catch {}
        try { rmSync(panelLogPath(name), { force: true }); } catch {}
        try { rmSync(panelCwdPath(name), { force: true }); } catch {}
        continue;
      }
      panes.push({ paneId, paneName: name, windowId: "", windowName: tabName });
    }
    return panes;
  } catch {
    return [];
  }
}

/** Find the window (tab) for a given cwd, or create one. */
function ensureTab(cwd: string): TabInfo {
  ensureSession();

  const tabName = cwdToTabName(cwd);
  const windows = listWindows();

  // Look for existing window with this name
  const existing = windows.find(w => w.windowName === tabName);
  if (existing) return existing;

  // Create new window
  const out = tmux([
    "new-window", "-d",
    "-t", config.sessionName,
    "-n", tabName,
    "-c", cwd,
    "-P", "-F", "#{window_id}\t#{window_index}",
    shellCmd(),
  ]);
  const parts = out.trim().split("\t");
  return { windowId: parts[0], windowIndex: parseInt(parts[1] || "0", 10), windowName: tabName };
}

/** Find a named pane. */
function findPane(name: string): PaneInfo | undefined {
  const paneId = loadPaneId(name);
  const tabName = loadPaneTab(name);
  if (!paneId || !tabName) return undefined;
  if (!paneAlive(paneId)) {
    // Clean up stale mappings
    try { rmSync(panePanePath(name), { force: true }); } catch {}
    try { rmSync(paneTabPath(name), { force: true }); } catch {}
    return undefined;
  }
  return { paneId, paneName: name, windowId: "", windowName: tabName };
}

function resolvePane(name: string): PaneInfo {
  const pane = findPane(name);
  if (!pane) throw new PanelNotFound(`panel '${name}' not found`);
  return pane;
}

// -- panel log files ----------------------------------------------------------

export function panelLogPath(name: string): string {
  return join(config.panelDir, `${name}.log`);
}

function panelCwdPath(name: string): string {
  return join(config.panelDir, `${name}.cwd`);
}

export function panelCwd(name: string): string | undefined {
  try {
    return readFileSync(panelCwdPath(name), "utf-8").trim() || undefined;
  } catch { return undefined; }
}

function startPanelLog(paneId: string, name: string): void {
  mkdirSync(config.panelDir, { recursive: true });
  const logPath = panelLogPath(name);
  writeFileSync(logPath, "");
  writeFileSync(panelCwdPath(name), process.cwd());
  tmux(["pipe-pane", "-o", "-t", paneId, `cat >> ${shellEscape(logPath)}`]);
}

// -- panel (pane) creation ----------------------------------------------------

export function ensurePanel(name: string): string {
  validatePanelName(name);

  // Already exists?
  const existing = findPane(name);
  if (existing) return existing.paneId;

  const cwd = process.cwd();
  const tab = ensureTab(cwd);

  // Check again after ensureTab (it may have created the window with a default pane)
  const existingAfter = findPane(name);
  if (existingAfter) return existingAfter.paneId;

  // List panes in this window — if there's only the default shell pane
  // (from window creation), repurpose it instead of splitting
  const windowPanes = listAllPanes().filter(p => p.windowId === tab.windowId);
  const defaultPane = windowPanes.length === 1 && !windowPanes[0].paneName
    ? windowPanes[0] : null;

  let paneId: string;

  if (defaultPane) {
    // Repurpose the default pane
    paneId = defaultPane.paneId;
    tmux(["send-keys", "-t", paneId, "-l", "--",
      `export AMUX_PANEL=${shellEscape(name)}; clear`]);
    tmux(["send-keys", "-t", paneId, "Enter"]);
    sleepSync(300);
    // Set pane title for tmux border display
    tmux(["select-pane", "-t", paneId, "-T", name], { allowFail: true });
  } else {
    // Split horizontally to create a new pane, tiled layout
    const out = tmux([
      "split-window", "-d",
      "-t", tab.windowId,
      "-c", cwd,
      "-e", `AMUX_PANEL=${shellEscape(name)}`,
      "-P", "-F", "#{pane_id}",
      shellCmd(),
    ]);
    paneId = out.trim();
    // Set pane title for tmux border display
    tmux(["select-pane", "-t", paneId, "-T", name], { allowFail: true });
    // Re-tile so panes are evenly distributed
    tmux(["select-layout", "-t", tab.windowId, "tiled"], { allowFail: true });
  }

  savePaneMapping(name, paneId, tab.windowName);
  startPanelLog(paneId, name);
  return paneId;
}

// -- streaming (log tailing) --------------------------------------------------

let logSeq = 0;

export function saveTimeoutLog(
  rawBytes: Buffer | string,
  panelName: string,
  context: string
): string {
  mkdirSync(config.logDir, { recursive: true });
  const now = new Date();
  const ts =
    String(now.getFullYear()) +
    String(now.getMonth() + 1).padStart(2, "0") +
    String(now.getDate()).padStart(2, "0") + "-" +
    String(now.getHours()).padStart(2, "0") +
    String(now.getMinutes()).padStart(2, "0") +
    String(now.getSeconds()).padStart(2, "0");
  const seq = ++logSeq;
  const path = join(config.logDir, `${panelName}-${context}-${ts}-${seq}.raw`);
  writeFileSync(path, rawBytes);
  return path;
}

/**
 * Tail the panel log file while fn() runs. Streams output to stdout.
 * Returns true if timed out (panel still producing output).
 */
function streamFor(
  paneId: string,
  fn: () => void,
  { timeout, panelName }: { timeout?: number; panelName?: string }
): boolean {
  if (!timeout) { fn(); return false; }

  const name = panelName || "unknown";
  const logPath = panelLogPath(name);
  let pos = 0;
  try { pos = statSync(logPath).size; } catch {}

  const sigHandler = () => { process.exit(130); };
  process.on("SIGINT", sigHandler);
  process.on("SIGTERM", sigHandler);

  try {
    fn();

    let deadline = monotonic() + timeout;
    let timedOut = true;
    let partial = "";

    const fd = openSync(logPath, "r");
    const buf = Buffer.alloc(65536);
    try {
      while (true) {
        if (monotonic() >= deadline) break;
        let size: number;
        try { size = statSync(logPath).size; } catch { size = 0; }

        if (size > pos) {
          const toRead = Math.min(size - pos, buf.length);
          const bytesRead = readSync(fd, buf, 0, toRead, pos);
          if (bytesRead > 0) {
            pos += bytesRead;
            const text = partial + buf.toString("utf-8", 0, bytesRead);
            const lines = text.split("\n");
            partial = lines.pop()!;

            for (const raw of lines) {
              const clean = stripAnsi(raw).trimEnd();
              const waiting = detectInputWait(clean, name);
              if (waiting) {
                timedOut = false;
                const cap = monotonic() + (waiting === "prompt" ? 0.2 : 0.3);
                if (cap < deadline) deadline = cap;
                continue;
              }
              if (raw) process.stdout.write(raw + "\n");
            }

            if (partial) {
              const cleanPartial = stripAnsi(partial).trimEnd();
              const waiting = detectInputWait(cleanPartial, name);
              if (waiting) {
                timedOut = false;
                const cap = monotonic() + 0.2;
                if (cap < deadline) deadline = cap;
              }
            }
          }
        } else {
          sleepSync(50);
        }
      }
    } finally {
      closeSync(fd);
    }

    if (partial) {
      const clean = stripAnsi(partial).trimEnd();
      if (clean && !detectInputWait(clean, name)) {
        process.stdout.write(partial + "\n");
      }
    }
    return timedOut;
  } finally {
    process.removeListener("SIGINT", sigHandler);
    process.removeListener("SIGTERM", sigHandler);
  }
}

// -- core API -----------------------------------------------------------------

/** Run a command in a panel. Returns true if timed out. Default timeout: 5s. */
export function run(
  name: string,
  command: string,
  opts?: { timeout?: number }
): boolean {
  if (!command?.trim()) throw new AmuxError("missing command");
  const timeout = clampTimeout(opts?.timeout ?? 5);
  const paneId = ensurePanel(name);
  return streamFor(paneId, () => {
    tmux(["send-keys", "-t", paneId, "-l", "--", command]);
    tmux(["send-keys", "-t", paneId, "Enter"]);
  }, { timeout, panelName: name });
}

export function normalizeKey(token: string): string | undefined {
  const m = token.match(/^C-(.)$/i);
  if (m) return `C-${m[1].toLowerCase()}`;
  return SPECIAL_KEYS[token];
}

/** Send keystrokes to a panel. Returns true if timed out. */
export function sendKeys(
  name: string,
  keys: string[],
  opts?: { timeout?: number }
): boolean {
  const timeout = clampTimeout(opts?.timeout ?? 5);
  const paneId = ensurePanel(name);
  return streamFor(paneId, () => {
    for (const token of keys) {
      const key = normalizeKey(token);
      if (key) {
        tmux(["send-keys", "-t", paneId, key]);
      } else {
        tmux(["send-keys", "-t", paneId, "-l", "--", token]);
      }
    }
  }, { timeout, panelName: name });
}

/**
 * Tail the panel log file.
 * - lines: number of tail lines (default 10)
 * - follow: keep tailing until done or timeout (default false)
 * - timeout: max seconds (default 60, capped at MAX_TIMEOUT)
 * Returns true if timed out while following.
 */
export function tail(
  name: string,
  opts?: { follow?: boolean; lines?: number; timeout?: number }
): boolean {
  const _follow = opts?.follow ?? false;
  const _lines = opts?.lines ?? 10;
  const _timeout = clampTimeout(opts?.timeout ?? 60);

  resolvePane(name); // throws if panel doesn't exist
  const logPath = panelLogPath(name);

  // Read tail of log file
  const CHUNK = Math.max(65536, _lines * 512);
  let content: string;
  try {
    const fd = openSync(logPath, "r");
    try {
      const st = statSync(logPath);
      const size = st.size;
      if (size === 0) {
        closeSync(fd);
        if (!_follow) return false;
        content = "";
      } else {
        const start = Math.max(0, size - CHUNK);
        const buf = Buffer.alloc(Math.min(CHUNK, size));
        readSync(fd, buf, 0, buf.length, start);
        content = buf.toString("utf-8");
      }
    } finally {
      closeSync(fd);
    }
  } catch {
    return false;
  }

  const allLines = content.split("\n");
  if (allLines.length > 0 && allLines[allLines.length - 1] === "") allLines.pop();

  const tailLines = allLines.slice(-_lines);
  for (const raw of tailLines) {
    const clean = stripAnsi(raw).trimEnd();
    if (detectInputWait(clean, name)) continue;
    if (raw) process.stdout.write(raw + "\n");
  }

  if (!_follow) return false;

  // Follow mode
  let pos: number;
  try { pos = statSync(logPath).size; } catch { return false; }

  let partial = "";
  let deadline = monotonic() + _timeout;
  let timedOut = true;

  const fd = openSync(logPath, "r");
  const buf = Buffer.alloc(65536);
  try {
    while (true) {
      if (monotonic() >= deadline) break;
      let size: number;
      try { size = statSync(logPath).size; } catch { size = 0; }

      if (size > pos) {
        const toRead = Math.min(size - pos, buf.length);
        const bytesRead = readSync(fd, buf, 0, toRead, pos);
        if (bytesRead > 0) {
          pos += bytesRead;
          const text = partial + buf.toString("utf-8", 0, bytesRead);
          const lines = text.split("\n");
          partial = lines.pop()!;

          for (const raw of lines) {
            const clean = stripAnsi(raw).trimEnd();
            const waiting = detectInputWait(clean, name);
            if (waiting) {
              timedOut = false;
              continue;
            }
            if (raw) process.stdout.write(raw + "\n");
          }

          if (partial) {
            const cleanPartial = stripAnsi(partial).trimEnd();
            if (detectInputWait(cleanPartial, name)) {
              timedOut = false;
              break;
            }
          }
          if (!timedOut) break;
        }
      } else {
        sleepSync(50);
      }
    }
  } finally {
    closeSync(fd);
  }

  if (partial) {
    const clean = stripAnsi(partial).trimEnd();
    if (clean && !detectInputWait(clean, name)) {
      process.stdout.write(partial + "\n");
    }
  }
  return timedOut;
}

/** Dump the tmux capture-pane content (raw panel screen). */
export function panelGet(name: string, opts?: { full?: boolean }): string {
  const pane = resolvePane(name);
  const args = ["capture-pane", "-p", "-t", pane.paneId];
  if (opts?.full) args.push("-S", "-");
  const output = tmux(args);
  const lines = output.split("\n");
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
  return lines.length === 0 ? "" : lines.join("\n") + "\n";
}

export function kill(name: string): void {
  const pane = findPane(name);
  if (!pane) return;
  tmux(["kill-pane", "-t", pane.paneId], { allowFail: true });
  // Clean up all sidecar files
  try { rmSync(panelLogPath(name), { force: true }); } catch {}
  try { rmSync(panelCwdPath(name), { force: true }); } catch {}
  try { rmSync(panePanePath(name), { force: true }); } catch {}
  try { rmSync(paneTabPath(name), { force: true }); } catch {}
  // If the window is now empty, tmux auto-removes it
}

export function terminate(): void {
  tmux(["kill-session", "-t", config.sessionName], { allowFail: true });
  try { rmSync(config.panelDir, { recursive: true, force: true }); } catch {}
}

export function watch(opts?: { readonly?: boolean }): never {
  const ro = opts?.readonly ?? false;
  ensureSession();
  // Select the tab matching current cwd if possible
  selectBestWindow();
  const args = [...tmuxBase(), "attach-session", "-t", config.sessionName];
  if (ro) args.push("-r");
  try {
    execFileSync(args[0], args.slice(1), { stdio: "inherit" });
    process.exit(0);
  } catch (e: any) {
    process.exit(e.status ?? 1);
  }
}

function selectBestWindow(): void {
  const cwd = process.cwd();
  const tabName = cwdToTabName(cwd);
  const windows = listWindows();
  const match = windows.find(w => w.windowName === tabName);
  if (match) {
    tmux(["select-window", "-t", match.windowId]);
  } else if (windows.length > 0) {
    // Pick most recently active
    const best = windows.reduce((a, b) => a.windowIndex > b.windowIndex ? a : b);
    tmux(["select-window", "-t", best.windowId]);
  }
}

/** List all panels grouped by tab. */
export function panels(): PaneInfo[] {
  return listAllPanes().filter(p => p.paneName);
}

export function list(): void {
  const allPanes = panels();
  if (allPanes.length === 0) {
    console.log("no panels");
    return;
  }
  // Group by window name (tab)
  const byTab: Record<string, PaneInfo[]> = {};
  for (const p of allPanes) {
    const tab = p.windowName || "?";
    if (!byTab[tab]) byTab[tab] = [];
    byTab[tab].push(p);
  }
  for (const [tab, panes] of Object.entries(byTab)) {
    console.log(`${tab}/`);
    for (const p of panes) {
      console.log(`  ${p.paneName}\t${p.paneId}`);
    }
  }
}
