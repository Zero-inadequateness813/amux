# amux — agentic mux

Named tmux panels for AI agents and humans. Run commands in persistent background panels, tail their output with byte-offset continuation, and never lose a line.

## Install

```bash
npm install -g https://github.com/tobi/amux
```

## Terminology & Architecture

```
┌─ Global Amux ─────────────────────────────────────────────────────────┐
│  One tmux server (own socket + config, separate from your tmux)       │
│                                                                       │
│  ┌─ Session: my-proje-a3f1 ──────────────────────────────────────┐   │
│  │  (derived from /Users/me/src/my-project — has .git)           │   │
│  │  = one tmux window (tab)                                      │   │
│  │                                                               │   │
│  │  ┌─ Panel: server ─┐  ┌─ Panel: tests ──┐  ┌─ Panel: build ┐│   │
│  │  │ npm start        │  │ npm test         │  │ make          ││   │
│  │  │ listening :3000  │  │ 47 passed        │  │ done          ││   │
│  │  └─────────────────┘  └──────────────────┘  └──────────────┘│   │
│  │  (dwm-style tiling)                                          │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                       │
│  ┌─ Session: other-re-b7e2 ─────────────────────────────────────┐   │
│  │  (derived from /Users/me/src/other-repo)                      │   │
│  │  ┌─ Panel: worker ──┐                                        │   │
│  │  │ ruby worker.rb    │                                        │   │
│  │  └──────────────────┘                                        │   │
│  └──────────────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────────────┘
```

**Global Amux** — A single tmux server with its own socket and config, completely separate from your personal tmux. Everything lives here.

**Session** — Each unique project directory gets its own session, which maps to one tmux window (tab). The project root is found by looking for `.git` up to 2 levels from the working directory. The session is named `basename[0:8]-hash[0:4]` where hash is the first 4 hex digits of SHA-256 of the resolved path. Example: `/Users/me/src/my-project` → `my-proje-a3f1`.

**Panel** — Created with `amux {name} run '...'`. Each panel is a tmux pane within its session's tab. Panels tile automatically in dwm-style layout. Named by whatever you pass as `{name}` — `server`, `tests`, `build`, etc.

## The run → tail workflow

The primary workflow. Start a command with `run`, which streams output for a short timeout (default 5s). If it finishes in time, you get `SUCCESS` or `FAIL EXITCODE:N`. If it times out, the output includes a **continuation hint** with the byte offset — call `tail` with that offset to pick up exactly where you left off.

### Example: fast command (completes within timeout)

```
$ amux server run "echo hello"
echo hello
hello

SUCCESS
```

### Example: slow command (timeout → continue with tail)

```
$ amux tests run "npm test" -t10
npm test

> test
> jest --runInBand

PASS src/utils.test.ts
PASS src/api.test.ts

⏳ timeout 10s — continue with:
  amux_tail(name: "tests", follow: true, offset: 4820)
```

The agent sees the timeout and uses the printed hint to resume:

```
$ amux tests tail -f -c 4820
PASS src/models.test.ts
PASS src/routes.test.ts

Tests: 47 passed
Time: 23.4s

SUCCESS
```

No output is lost. No output is duplicated. The byte offset is the exact position in the log file where `run` stopped reading.

### Example: chained timeouts

If `tail` also times out, it prints another continuation hint:

```
$ amux build tail -f -c 4820 -t60
... 60 seconds of output ...

⏳ timeout 60s — continue with:
  amux_tail(name: "build", follow: true, offset: 128400)
```

The agent keeps chaining `tail` calls until the command completes.

## Commands

### `amux NAME run CMD`

Run a command in a panel. Creates the panel if it doesn't exist. Streams output from the start.

- Default timeout: **5 seconds** (`-t5`)
- Max timeout: 300 seconds
- Prints `SUCCESS` / `FAIL EXITCODE:N` on completion
- Prints continuation hint with byte offset on timeout

```bash
amux server run "npm start"           # 5s default
amux server run "npm test" -t30       # 30s timeout
```

### `amux NAME tail`

Tail the panel log. Without `--follow`, prints the last N lines and exits.

- Default lines: **10** (`--lines=10`)
- Default timeout: **60 seconds** (`-t60`)
- `-c OFFSET`: start from byte offset (for continuation)
- `--follow` / `-f`: keep tailing until command completes or timeout

```bash
amux server tail                      # last 10 lines
amux server tail --lines=50           # last 50 lines
amux server tail -f                   # follow until done or 60s
amux server tail -f -c 4820          # continue from offset
amux server tail -f -c 4820 -t120   # continue with 2min timeout
```

### `amux NAME send-keys K...`

Send keystrokes to a panel.

```bash
amux server send-keys C-c            # Ctrl-C
amux repl send-keys "puts :hi" Enter # type + enter
```

Keys: `C-c` `C-d` `C-z` `Enter` `Tab` `Esc` `Space` `BSpace` `Up` `Down` `Left` `Right`

### `amux NAME kill`

Remove a panel.

### `amux list`

List all active panels grouped by session.

### `amux watch`

Open tmux to see all sessions and panels live.

- `M-1`…`M-9`: switch sessions
- `Esc`: scroll mode
- `M-q`: detach
- `M-t`: terminate all

### `amux terminate --yes`

Destroy everything and kill the tmux server.

## Internals

- **Logs**: `~/.amux/panels/{name}.log` via tmux `pipe-pane`
- **Sidecar files**: `.pane` and `.tab` track tmux pane ID → panel name mapping
- **Sentinels**: bash `PROMPT_COMMAND` prints `SUCCESS` or `FAIL EXITCODE:N` after each command
- **Prompt**: `amux ready $ ` — static, deterministic, trivially matchable
- **Nesting guard**: rejects commands containing `amux`, `tmux`, or `zellij`
- **Timeout cap**: all timeouts capped at 300s (5 minutes)

## pi extension

amux ships as a [pi](https://github.com/mariozechner/pi) package with tools:

- `amux_shell` — run a command in a panel (wraps `run`)
- `amux_tail` — tail panel output with offset continuation
- `amux_send_keys` — send keystrokes
- `amux_kill` — remove a panel
- `amux_list` — list panels

The extension truncates output for the LLM (last 2000 lines / 50KB, same as pi's built-in bash tool) while showing full output in the UI widget. A tab bar widget with `⌥1`–`⌥9` hotkeys provides live panel trailing.
