#!/usr/bin/env -S node --experimental-strip-types --experimental-transform-types --no-warnings

import {
  list, watch, panels, terminate, run, sendKeys, tail, panelGet, kill,
  AmuxError, MAX_TIMEOUT,
} from "../src/amux.ts";

const HELP = `amux — agentic mux

Named panels backed by tmux. Panels are panes tiled within a tab per cwd.

For humans:
  amux watch                see all tabs/panels live (Ctrl-Q to detach)
  amux watch -r             attach read-only
  amux list                 show active panels
  amux terminate --yes      shut down all panels

  Inside watch mode:
    M-1..9                  switch between tabs
    Esc                     scroll mode (copy-mode)
    M-q                     detach
    M-t                     terminate all panels

For agents:
  amux NAME run CMD...      run command in panel, stream output (default: 5s)
  amux NAME tail [opts]     tail panel log (default: 10 lines, 60s timeout)
  amux NAME panel-get       dump tmux panel content (--full for scrollback)
  amux NAME send-keys K...  send keystrokes to a panel
  amux NAME kill            remove a single panel

Options:
  -tN                       timeout in seconds (default depends on command, max ${MAX_TIMEOUT})

tail options:
  --follow / -f             follow live output until done or timeout
  --lines=N                 number of lines (default: 10)

send-keys reference:
  C-c C-d C-z               ctrl combos
  Enter Tab Esc Space       special keys
  Up Down Left Right        arrow keys
  BSpace                    backspace
  "some text"               literal text (no Enter added)

Examples:
  amux server run "npm start"             start a dev server
  amux watch                              see tabs with tiled panels
  amux server tail                        last 10 lines
  amux server tail --follow               tail -f until done or 60s
  amux server tail --lines=50             last 50 lines
  amux server panel-get                   dump panel screen
  amux server send-keys C-c               interrupt it
  amux repl run "irb"                     start a REPL
  amux repl send-keys "puts :hi" Enter    type + enter
  amux server kill                        remove one panel
  amux terminate --yes                    shut down everything
`;

// Parse -tN timeout flag from anywhere in args
const args = process.argv.slice(2);
let timeoutOverride: number | undefined;
const tIdx = args.findIndex((a) => /^-t\d+$/.test(a));
if (tIdx !== -1) {
  timeoutOverride = Math.min(parseInt(args[tIdx].slice(2), 10), MAX_TIMEOUT);
  args.splice(tIdx, 1);
}

const COMMANDS = ["run", "shell", "tail", "read", "panel-get", "send-keys", "kill"];

try {
  switch (args[0]) {
    case "list":
      list();
      process.exit(0);

    case "terminate":
      if (!args.includes("--yes")) {
        const p = panels();
        if (p.length > 0) {
          console.log("active panels:");
          for (const pane of p) {
            console.log(`  ${pane.windowName}/${pane.paneName}\t${pane.paneId}`);
          }
        }
        process.stderr.write("confirm with: amux terminate --yes\n");
        process.exit(1);
      }
      terminate();
      console.log("session destroyed");
      process.exit(0);

    case "watch":
    case "attach":
      watch({ readonly: args.includes("-r") });
      break;

    case undefined:
    case "-h":
    case "--help":
    case "help":
      process.stderr.write(HELP);
      process.exit(0);
  }

  // Panel commands: amux NAME COMMAND [ARGS...]
  const name = args[0];
  const cmd = args[1];

  if (!cmd || !COMMANDS.includes(cmd)) {
    process.stderr.write(HELP);
    process.exit(1);
  }

  const rest = args.slice(2);

  switch (cmd) {
    case "run":
    case "shell": {
      const command = rest.length === 1 ? rest[0] : rest.join(" ");
      if (!command) {
        process.stderr.write(HELP);
        process.exit(1);
      }
      const timeout = timeoutOverride ?? 5;
      const timedOut = run(name, command, { timeout });
      if (timedOut) {
        process.stdout.write(`\ntimeout ${timeout}s: still running. Use \`amux ${name} tail\` to check output.\n`);
      }
      break;
    }

    case "send-keys": {
      if (rest.length === 0) {
        process.stderr.write(HELP);
        process.exit(1);
      }
      const timeout = timeoutOverride ?? 5;
      const timedOut = sendKeys(name, rest, { timeout });
      if (timedOut) {
        process.stdout.write(`\ntimeout ${timeout}s: still running. Use \`amux ${name} tail\` to check output.\n`);
      }
      break;
    }

    case "tail":
    case "read": {
      const follow = rest.includes("--follow") || rest.includes("-f");
      let lines = 10;
      const linesArg = rest.find((a) => a.startsWith("--lines="));
      if (linesArg) lines = parseInt(linesArg.split("=")[1], 10) || 10;
      const timeout = timeoutOverride ?? 60;
      const stillRunning = tail(name, { follow, lines, timeout });
      if (follow && stillRunning) {
        process.stdout.write(`\ntimeout ${timeout}s: still running.\n`);
      }
      break;
    }

    case "panel-get": {
      const full = rest.includes("--full");
      process.stdout.write(panelGet(name, { full }));
      break;
    }

    case "kill": {
      kill(name);
      console.log(`- ${name}`);
      break;
    }
  }
} catch (e) {
  if (e instanceof AmuxError) {
    process.stderr.write(`amux: ${e.message}\n`);
    process.exit(1);
  }
  throw e;
}
