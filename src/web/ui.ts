export const WEB_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="color-scheme" content="dark">
  <meta name="theme-color" content="#2a211c">
  <title>YamX Web</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <div class="app-shell" id="app-shell">
    <aside class="sidebar" id="sidebar" aria-label="Main navigation">
      <div class="sidebar-brand">
        <div class="brand">YamX</div>
        <div class="brand-tag" id="brand-tag">local · offline</div>
      </div>
      <div class="sidebar-meta">
        <div class="sub" id="cwd" title="Working directory and model (when loaded)">cwd: .</div>
        <span class="ver" id="app-ver"></span>
      </div>
      <nav class="sidebar-nav" role="tablist" aria-orientation="vertical">
        <button type="button" class="nav-item active" data-panel="terminal" role="tab" aria-selected="true">
          <span class="nav-ico" aria-hidden="true">[>]</span>
          <span class="nav-label">Shell</span>
        </button>
        <button type="button" class="nav-item" data-panel="settings" role="tab" aria-selected="false">
          <span class="nav-ico" aria-hidden="true">[*]</span>
          <span class="nav-label">Settings</span>
        </button>
        <button type="button" class="nav-item" data-panel="sessions" role="tab" aria-selected="false">
          <span class="nav-ico" aria-hidden="true">[#]</span>
          <span class="nav-label">Sessions</span>
        </button>
        <button type="button" class="nav-item" data-panel="tools" role="tab" aria-selected="false">
          <span class="nav-ico" aria-hidden="true">[+]</span>
          <span class="nav-label">Tools</span>
        </button>
      </nav>
      <p class="sidebar-hint muted">Local control plane | bind stays on loopback</p>
    </aside>
    <div class="sidebar-backdrop" id="sidebar-backdrop" aria-hidden="true"></div>

    <div class="main">
      <header class="mainbar">
        <button type="button" class="menu-toggle" id="menu-toggle" aria-expanded="false" aria-controls="sidebar" title="Menu">
          <span class="burger" aria-hidden="true"></span>
          <span class="sr-only">Open navigation</span>
        </button>
        <div class="mainbar-title" id="mainbar-title">Shell</div>
        <div class="mainbar-actions">
          <div class="pill" id="state">offline</div>
        </div>
      </header>

      <div class="main-body">
        <section id="panel-terminal" class="panel panel-shell active" role="tabpanel" aria-labelledby="tab-terminal-label">
          <span id="tab-terminal-label" class="sr-only">Shell</span>
          <div class="shell-stage">
            <div class="shell-split">
              <div class="shell-split-main">
                <div class="shell-card" role="region" aria-label="YamX shell">
                  <div class="terminal-workspace">
                    <div class="terminal-chrome">
                  <span class="chrome-title">Conversation</span>
                  <span class="chrome-hint muted">Shell runs locally. Code, fixes, and debugging use the connected model.</span>
                </div>
                <div class="provider-readiness-row" id="provider-readiness" role="status" aria-live="polite">Loading provider status...</div>
                <main class="terminal" id="terminal" aria-live="polite">
                  <div class="terminal-empty" id="terminal-empty">
                    <div class="empty-icon" aria-hidden="true">[#]</div>
                    <p class="empty-title">Start a turn</p>
                    <p class="muted empty-hint">Your message appears here right away. YamX or the shell replies below when ready.</p>
                  </div>
                    </main>
                    <div class="terminal-tools" id="terminal-tools">
                      <button type="button" id="btn-clear-terminal">Clear terminal</button>
                      <button type="button" id="btn-copy-last-output">Copy last output</button>
                      <button type="button" id="btn-export-transcript">Export transcript</button>
                    </div>
                    <form class="commandbar" id="command-form">
                      <span class="prompt" aria-hidden="true">&gt;</span>
                      <input id="command-input" name="command" autocomplete="off" spellcheck="false" placeholder="Type command or task..." autofocus aria-label="Message or command">
                      <button type="submit" title="Send to YamX">Send</button>
                    </form>
                  </div>
                </div>
              </div>
              <aside class="shell-split-side" aria-label="Chat sessions sidebar">
                <div class="shell-sessions-panel">
                  <header class="shell-sessions-head">
                    <span class="shell-sessions-title">Sessions</span>
                    <span class="shell-sessions-caption muted">~/.yamx/sessions · active switches on next agent message</span>
                  </header>
                  <div id="shell-sessions-status" class="status"></div>
                  <div class="shell-sessions-toolbar">
                    <button type="button" class="primary compact js-session-new">New</button>
                    <button type="button" class="compact js-session-refresh">Refresh</button>
                    <button type="button" class="compact muted-link js-open-sessions-tab" title="Full sessions tab">Expand</button>
                  </div>
                  <div class="shell-sessions-scroll table-wrap">
                    <div id="shell-sessions-mount"></div>
                  </div>
                </div>
              </aside>
            </div>
          </div>
        </section>

        <section id="panel-settings" class="panel panel-settings" role="tabpanel" aria-labelledby="tab-settings-label">
          <span id="tab-settings-label" class="sr-only">Settings</span>
          <div class="panel-scroll">
            <div class="panel-inner panel-inner-settings">
              <p class="lead">Read/write <code>~/.yamx/config.json</code>. API keys are masked in the browser; leave a key blank to keep the saved value, or enter a new key to replace.</p>
              <div id="settings-status" class="status"></div>
              <div id="settings-mount"></div>
              <div class="btn-row">
                <button type="button" id="btn-save-config" class="primary">Save configuration</button>
                <button type="button" id="btn-reload-runtime">Reload agent cache</button>
                <button type="button" id="btn-reset-config" class="danger">Reset to defaults</button>
              </div>
            </div>
          </div>
        </section>

        <section id="panel-sessions" class="panel" role="tabpanel" aria-labelledby="tab-sessions-label">
          <span id="tab-sessions-label" class="sr-only">Sessions</span>
          <div class="panel-scroll">
            <div class="panel-inner">
              <p class="lead">Chat sessions in <code>~/.yamx/sessions/</code>. Full CRUD via this UI or the API. Changing the active session reloads the web agent on the next message.</p>
              <div id="sessions-status" class="status"></div>
              <div class="sessions-toolbar">
                <button type="button" id="btn-new-session" class="primary js-session-new">New session</button>
                <button type="button" id="btn-refresh-sessions" class="js-session-refresh">Refresh</button>
              </div>
              <div class="table-wrap">
                <div id="sessions-mount"></div>
              </div>
            </div>
          </div>
        </section>

        <section id="panel-tools" class="panel" role="tabpanel" aria-labelledby="tab-tools-label">
          <span id="tab-tools-label" class="sr-only">Tools</span>
          <div class="panel-scroll">
            <div class="panel-inner panel-inner-wide panel-inner-tools">
              <div class="card tools-card">
                <div class="card-header">
                  <h3 class="h3">Tools</h3>
                  <label class="tool-filter-label">Filter <input type="search" id="tool-filter" class="tool-filter" placeholder="Name or description..." autocomplete="off"></label>
                </div>
                <div id="tools-mount" class="tools-mount"></div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
  <script src="/app.js"></script>
</body>
</html>`;

export const WEB_CSS = `:root {
  color-scheme: dark;
  --bg: #2a211c;
  --bg-elevated: #3a2e28;
  --panel: #3a2e28;
  --panel-2: #4a342c;
  --line: #6b5346;
  --text: #f6e4d4;
  --muted: #c4a894;
  --accent: #d97757;
  --accent-dim: #a3563c;
  --accent-soft: rgba(217, 119, 87, 0.18);
  --cyan: #e8b56a;
  --terminal-bg: #241c18;
  --reply-shell: #f6d7a8;
  --reply-chat: #f6e4d4;
  --warn: #e8b56a;
  --bad: #e07a6a;
  --shadow: rgba(0, 0, 0, 0.45);
  --shadow-deep: rgba(0, 0, 0, 0.65);
  --glow: 0 0 18px rgba(217, 119, 87, 0.22);
  --sidebar-w: 264px;
  --mainbar-h: 56px;
  --radius-lg: 16px;
  --radius-md: 12px;
  --pad-inline: clamp(12px, 2.8vw, 22px);
  --pad-panel-y: clamp(18px, 3.5vw, 32px);
  --safe-top: env(safe-area-inset-top, 0px);
  --safe-right: env(safe-area-inset-right, 0px);
  --safe-bottom: env(safe-area-inset-bottom, 0px);
  --safe-left: env(safe-area-inset-left, 0px);
  --font-mono: "Cascadia Code", "JetBrains Mono", "Fira Code", Consolas, monospace;
  --font-ui: "Cascadia Code", "Segoe UI", "Noto Sans", sans-serif;
}

* { box-sizing: border-box; }

html {
  overflow-x: clip;
  height: 100%;
  background-color: var(--bg);
  color-scheme: dark;
}

html, body {
  margin: 0;
  background-color: var(--bg);
  color: var(--text);
  font: 14px/1.55 var(--font-ui);
}

body {
  min-width: 280px;
  min-height: 100%;
  min-height: 100dvh;
  overflow-x: clip;
  -webkit-text-size-adjust: 100%;
  background-color: var(--bg);
}

body::before {
  content: '';
  position: fixed;
  inset: 0;
  min-height: 100dvh;
  pointer-events: none;
  background:
    repeating-linear-gradient(
      0deg,
      transparent 0,
      transparent 2px,
      rgba(217, 119, 87, 0.04) 2px,
      rgba(217, 119, 87, 0.04) 4px
    ),
    radial-gradient(55% 42% at 50% -8%, rgba(217, 119, 87, 0.12), transparent 58%),
    radial-gradient(45% 35% at 102% 96%, rgba(232, 181, 106, 0.08), transparent 52%),
    linear-gradient(168deg, #1a1411 0%, var(--bg) 45%, #140f0c 100%);
  z-index: 0;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

code {
  font: 13px var(--font-mono);
  background: rgba(0, 255, 136, 0.08);
  padding: 1px 6px;
  border-radius: 4px;
  border: 1px solid rgba(0, 255, 136, 0.22);
}

/* App shell: sidebar + main */
.app-shell {
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  align-items: stretch;
  position: relative;
  z-index: 1;
  padding-top: var(--safe-top);
  padding-right: var(--safe-right);
  padding-bottom: var(--safe-bottom);
  padding-left: var(--safe-left);
}

.sidebar {
  width: var(--sidebar-w);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px 14px 22px;
  background: linear-gradient(180deg, #0b1512 0%, #08100d 52%, var(--terminal-bg) 100%);
  border-right: 1px solid rgba(217, 119, 87, 0.28);
  box-shadow: 4px 0 28px var(--shadow-deep);
}

.sidebar-brand {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}
.brand {
  font-weight: 800;
  font-size: 1.18rem;
  letter-spacing: 0.04em;
  font-family: var(--font-mono);
  color: var(--accent);
  text-transform: uppercase;
  text-shadow: 0 0 18px rgba(217, 119, 87, 0.35);
}
.brand-tag {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: .14em;
  color: var(--cyan);
  opacity: .95;
}

.sidebar-meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.sub {
  color: var(--muted);
  font-size: 11px;
  line-height: 1.35;
  overflow-wrap: anywhere;
  font-family: var(--font-mono);
}
.ver { font-size: 10px; color: var(--muted); opacity: .85; font-family: var(--font-mono); }

.sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 4px;
  flex: 1;
  min-height: 0;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  margin: 0;
  padding: 10px 12px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  color: var(--muted);
  font: inherit;
  text-align: left;
  cursor: pointer;
  min-height: 42px;
  transition: background .12s, color .12s, border-color .12s, box-shadow .15s;
}
.nav-item:hover {
  color: var(--accent-dim);
  background: rgba(0, 255, 136, 0.08);
  border-color: rgba(0, 255, 136, 0.25);
  box-shadow: 0 0 12px rgba(0, 255, 136, 0.12);
}
.nav-item.active {
  color: var(--accent);
  background: rgba(0, 255, 136, 0.12);
  border-color: rgba(0, 255, 136, 0.45);
  font-weight: 600;
  text-shadow: 0 0 10px rgba(0, 255, 136, 0.35);
}
.nav-ico {
  font-family: var(--font-mono);
  font-size: 13px;
  width: 1.25rem;
  opacity: .85;
}
.nav-item.active .nav-ico { opacity: 1; color: var(--accent); }
.nav-label { flex: 1; min-width: 0; font-family: var(--font-mono); }

.sidebar-hint {
  margin: 0;
  font-size: 10px;
  line-height: 1.4;
  padding-top: 8px;
  border-top: 1px solid var(--line);
  font-family: var(--font-mono);
}

.sidebar-backdrop {
  display: none;
  position: fixed;
  inset: 0;
  z-index: 90;
  background: rgba(1, 8, 4, 0.72);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  opacity: 0;
  transition: opacity .2s ease;
}
.sidebar-backdrop.show {
  display: block;
  opacity: 1;
}

.main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: transparent;
}

.mainbar {
  flex-shrink: 0;
  min-height: var(--mainbar-h);
  height: auto;
  display: flex;
  align-items: center;
  gap: 10px;
  row-gap: 8px;
  flex-wrap: wrap;
  padding: 8px 14px 8px 10px;
  border-bottom: 1px solid rgba(0, 255, 136, 0.2);
  background: linear-gradient(180deg, #0c1613 0%, #09100e 100%);
  box-shadow: 0 4px 24px var(--shadow);
}

.menu-toggle {
  display: none;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  padding: 0;
  margin: 0;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--panel-2);
  color: var(--accent);
  cursor: pointer;
}
.menu-toggle:hover { border-color: var(--accent-dim); box-shadow: var(--glow); }
.burger {
  display: block;
  width: 18px;
  height: 2px;
  background: var(--accent);
  border-radius: 1px;
  box-shadow: 0 -6px 0 var(--accent), 0 6px 0 var(--accent);
}

.mainbar-title {
  flex: 1;
  font-weight: 700;
  font-size: 1.03rem;
  letter-spacing: 0.06em;
  min-width: 0;
  font-family: var(--font-mono);
  color: var(--accent);
  text-transform: uppercase;
  text-shadow: 0 0 12px rgba(0, 255, 136, 0.25);
}
.mainbar-actions { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }

.pill {
  min-width: 72px;
  text-align: center;
  padding: 5px 10px;
  border: 1px solid rgba(0, 255, 136, 0.35);
  background: rgba(0, 255, 136, 0.08);
  color: var(--muted);
  border-radius: 999px;
  font-size: 12px;
  white-space: nowrap;
  font-weight: 600;
  font-family: var(--font-mono);
}
.pill.ok { color: var(--accent); border-color: var(--accent); }
.pill.bad { color: var(--bad); border-color: rgba(224, 122, 106, 0.7); }

.main-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  position: relative;
}

.panel {
  display: none;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
}
.panel.active {
  display: flex;
  animation: yamx-panel-in .22s ease;
}

@keyframes yamx-panel-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.panel-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  -webkit-overflow-scrolling: touch;
}

.panel-inner {
  width: 100%;
  padding: var(--pad-panel-y) var(--pad-inline) clamp(28px, 5vw, 40px);
  max-width: 960px;
  margin: 0 auto;
}
.panel-inner-wide { max-width: 1200px; }
.panel-inner-settings { max-width: 920px; }

.panel:not(.panel-shell) .panel-scroll {
  background:
    radial-gradient(ellipse 90% 65% at 50% -28%, rgba(0, 255, 136, 0.06), transparent 54%),
    radial-gradient(ellipse 70% 50% at -5% 95%, rgba(46, 243, 217, 0.04), transparent 48%),
    var(--bg);
}

.panel-shell {
  background:
    radial-gradient(ellipse 120% 80% at 50% -18%, rgba(0, 255, 136, 0.07), transparent 58%),
    radial-gradient(ellipse 80% 55% at 100% 48%, rgba(46, 243, 217, 0.04), transparent 50%),
    var(--bg);
}

/* Shell: 12-col vibe - main ~8, sessions sidebar ~4 */
.shell-split {
  display: grid;
  grid-template-columns: minmax(0, 8fr) minmax(248px, 4fr);
  gap: clamp(14px, 2.2vw, 22px);
  align-items: stretch;
  width: 100%;
  flex: 1;
  min-height: 0;
}
.shell-split-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.shell-split-side {
  min-width: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.shell-split-main .shell-card {
  max-width: none;
  width: 100%;
  margin: 0;
}

.shell-sessions-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(0, 255, 136, 0.26);
  border-radius: var(--radius-lg);
  background: linear-gradient(165deg, #0a1411 0%, var(--panel) 44%, #050a08 100%);
  box-shadow:
    0 0 20px rgba(0, 255, 136, 0.06),
    0 12px 36px var(--shadow-deep),
    inset 0 1px 0 rgba(0, 255, 136, 0.05);
  overflow: hidden;
}
.shell-sessions-head {
  flex-shrink: 0;
  padding: 11px 14px 10px;
  border-bottom: 1px solid rgba(0, 255, 136, 0.14);
}
.shell-sessions-title {
  display: block;
  font-family: var(--font-mono);
  font-weight: 700;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.11em;
  color: var(--accent);
  text-shadow: 0 0 8px rgba(0, 255, 136, 0.22);
}
.shell-sessions-caption {
  display: block;
  font-size: 10px;
  line-height: 1.38;
  margin-top: 5px;
}
.shell-sessions-toolbar {
  flex-shrink: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--line);
}
.shell-sessions-toolbar button.compact {
  padding: 5px 10px;
  font-size: 11px;
}
button.muted-link {
  margin-left: auto;
  background: transparent;
  border: none;
  color: var(--cyan);
  cursor: pointer;
  font-family: var(--font-mono);
  text-decoration: underline;
  padding: 4px 0;
}
button.muted-link:hover {
  color: var(--accent);
}
.shell-sessions-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 6px 8px 12px;
  -webkit-overflow-scrolling: touch;
}
.shell-sessions-panel table.sessions {
  font-size: 11px;
}
.shell-sessions-panel table.sessions th,
.shell-sessions-panel table.sessions td {
  padding: 5px 6px;
}
.shell-sessions-panel .session-actions {
  flex-direction: column;
  align-items: stretch;
  gap: 5px;
}
.shell-sessions-panel .session-actions button {
  padding: 4px 6px;
  font-size: 10px;
  min-height: 0;
}

/* Centered shell card - scroll happens inside .terminal only */
.shell-stage {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: stretch;
  padding: clamp(10px, 2.2vw, 22px) clamp(10px, 2.8vw, 26px) clamp(12px, 2.2vh, 28px);
  overflow: hidden;
}

.shell-card {
  width: 100%;
  max-width: 980px;
  margin: 0 auto;
  flex: 1 1 auto;
  min-height: min(380px, 50vh);
  max-height: min(86vh, calc(100dvh - var(--mainbar-h) - var(--safe-top) - var(--safe-bottom) - 52px));
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(0, 255, 136, 0.28);
  border-radius: var(--radius-lg);
  background: linear-gradient(165deg, #0a1411 0%, var(--panel) 42%, #050a08 100%);
  box-shadow:
    0 0 24px rgba(0, 255, 136, 0.08),
    0 16px 48px var(--shadow-deep),
    inset 0 1px 0 rgba(0, 255, 136, 0.06);
  overflow: hidden;
}

/* Terminal workspace inside shell card */
.terminal-workspace {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--terminal-bg);
}

.terminal-chrome {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  row-gap: 6px;
  padding: 10px 16px;
  border-bottom: 1px solid rgba(0, 255, 136, 0.2);
  background: linear-gradient(180deg, #0d1815 0%, #080f0c 100%);
  font-size: 11px;
  font-family: var(--font-mono);
}
.chrome-title { font-weight: 600; color: var(--accent); text-transform: uppercase; letter-spacing: .1em; text-shadow: 0 0 8px rgba(0, 255, 136, 0.35); }
.chrome-hint { font-size: 11px; }

.execution-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--line);
  background: rgba(0, 255, 136, 0.04);
  font-family: var(--font-mono);
}
.mode-select-wrap {
  display: grid;
  gap: 3px;
  color: var(--muted);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
}
.mode-select {
  min-width: 120px;
  height: 32px;
  border: 1px solid rgba(0, 255, 136, 0.35);
  border-radius: 10px;
  background: var(--panel-2);
  color: var(--accent);
  padding: 0 9px;
  font: 12px var(--font-mono);
}
/* Provider select: wider for ids like openrouter */
.execution-toolbar #provider-quick.mode-select {
  min-width: 140px;
  max-width: min(228px, 100%);
}
.provider-readiness-row {
  padding: 6px 14px 10px;
  border-bottom: 1px solid var(--line);
  background: rgba(0, 28, 18, 0.42);
  font-size: 11px;
  line-height: 1.45;
  font-family: var(--font-mono);
  color: var(--muted);
  overflow-wrap: anywhere;
}
.provider-readiness-row.provider-readiness-ok {
  color: var(--reply-shell);
}
.provider-readiness-row.provider-readiness-bad {
  color: var(--bad);
  text-shadow: 0 0 10px rgba(255, 77, 125, 0.25);
}
.execution-lab .provider-readiness-row {
  border-bottom: none;
  padding-bottom: 12px;
}
.execution-lab {
  border-bottom: 1px solid var(--line);
  background: rgba(0, 35, 22, 0.45);
}
.execution-lab > summary {
  list-style: none;
  cursor: pointer;
  padding: 10px 14px;
  font-size: 12px;
  font-weight: 700;
  color: var(--accent);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  font-family: var(--font-mono);
  text-shadow: 0 0 10px rgba(0, 255, 136, 0.25);
}
.execution-lab > summary::-webkit-details-marker { display: none; }
.execution-lab > summary::after {
  content: '[+]';
  float: right;
  color: var(--muted);
  font-family: var(--font-mono);
}
.execution-lab[open] > summary::after {
  content: '[-]';
}
.execution-lab-grid {
  padding: 0 14px 12px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.execution-lab-grid label {
  display: grid;
  gap: 4px;
  color: var(--muted);
  font-size: 12px;
  font-family: var(--font-mono);
}
.execution-lab-grid select,
.execution-lab-grid input,
.runbook-block textarea {
  width: 100%;
  min-width: 0;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel-2);
  color: var(--reply-shell);
  padding: 8px 10px;
  font: 12px var(--font-mono);
}
.execution-profiles {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 0 14px 12px;
}
.exec-profile-label {
  font-size: 11px;
  color: var(--muted);
  font-weight: 600;
  font-family: var(--font-mono);
}
.exec-profile {
  height: 30px;
  min-width: 0;
  padding: 0 10px;
  border-radius: 999px;
  font-size: 11px;
}
.runbook-block {
  border-top: 1px dashed rgba(0, 255, 136, 0.25);
  padding: 10px 14px 14px;
}
.runbook-label {
  display: block;
  margin-bottom: 6px;
  font-size: 11px;
  color: var(--muted);
}
#runbook-input {
  min-height: 96px;
  resize: vertical;
}
.runbook-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 8px;
}
.runbook-row button {
  height: 32px;
  min-width: 0;
  font-size: 12px;
  padding: 0 10px;
}

.table-wrap {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  margin-top: 4px;
}

.split-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr));
  gap: 18px;
  align-items: start;
}
.card {
  border: 1px solid rgba(0, 255, 136, 0.2);
  border-radius: var(--radius-md);
  padding: 15px 16px 18px;
  background: linear-gradient(165deg, rgba(12, 24, 18, 0.95) 0%, var(--panel) 55%, #080e0b 100%);
  box-shadow:
    0 0 14px rgba(0, 255, 136, 0.06),
    0 12px 36px var(--shadow-deep);
  opacity: 0;
  transform: translateY(6px);
  animation: yamx-card-in .36s ease forwards;
}
.card .h3 { margin: 0 0 8px; }

.split-cards .card:nth-child(2) { animation-delay: .06s; }
.split-cards .card:nth-child(3) { animation-delay: .12s; }

/* Tools & API — full main-column width (ID beats .panel-inner / .panel-inner-wide max-width caps) */
#panel-tools .panel-inner {
  min-width: 0;
  max-width: none;
  width: 100%;
  box-sizing: border-box;
  padding-inline: clamp(10px, 1.6vw, 16px); /* narrower gutter than generic panels → more usable width */
}

.tools-api-stack {
  --tools-api-gap: clamp(18px, 2.2vw, 26px);
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: var(--tools-api-gap);
  width: 100%;
  max-width: 100%;
  min-width: 0;
}

.split-cards.tools-api-grid {
  gap: var(--tools-api-gap);
  grid-template-columns: 1fr;
  align-items: stretch;
}

.split-cards.tools-api-grid.tools-api-grid-dual {
  width: 100%;
  max-width: 100%;
  min-width: 0;
}

.split-cards.tools-api-grid > .card {
  display: flex;
  flex-direction: column;
  min-width: 0;
  max-width: 100%;
  width: 100%;
  min-height: min(320px, 44vh);
  padding: clamp(14px, 1.9vw, 20px) clamp(15px, 2.1vw, 20px) clamp(16px, 2.4vw, 22px);
  box-sizing: border-box;
}

.split-cards.tools-api-grid .card-header {
  flex-shrink: 0;
  min-width: 0;
  max-width: 100%;
}

.split-cards.tools-api-grid .card-header .h3 {
  margin: 0 0 6px;
  font-size: 1.0625rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.25;
}

.split-cards.tools-api-grid .card-lead {
  margin: 0 0 12px;
  font-size: 13px;
  line-height: 1.5;
  max-width: 64ch;
}

.tools-card .card-header .h3 {
  margin-bottom: 10px;
}

.tools-card .card-header .tool-filter-label {
  margin: 0;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--muted);
}

.tools-card .tool-filter {
  max-width: none;
  width: 100%;
  min-height: 40px;
  padding: 9px 12px;
  border-radius: 8px;
  font-size: 14px;
}

.api-doc-card .api-doc-mount {
  flex: 1 1 auto;
  margin-top: 0;
  min-width: 0;
  width: 100%;
  max-width: 100%;
  min-height: 220px;
  max-height: min(52vh, 480px);
  overflow: auto;
  padding: 12px 14px;
  border: 1px solid rgba(0, 255, 136, 0.15);
  border-radius: 10px;
  background: var(--terminal-bg);
  box-shadow: inset 0 0 40px rgba(0, 255, 136, 0.04);
  -webkit-overflow-scrolling: touch;
}

.api-doc-card .api-group:last-child {
  margin-bottom: 0;
}

.api-doc-card .raw-api-details {
  margin-top: 14px;
  flex-shrink: 0;
  padding-top: 2px;
}

.api-doc-card .routes-json {
  max-height: 200px;
}

.tools-mount {
  flex: 1 1 auto;
  min-width: 0;
  width: 100%;
  max-width: 100%;
  min-height: 240px;
  max-height: min(52vh, 480px);
  overflow-y: auto;
  overflow-x: auto;
  overscroll-behavior: contain;
  padding: 8px 10px 12px;
  border: 1px solid rgba(0, 255, 136, 0.15);
  border-radius: 10px;
  background: var(--terminal-bg);
  box-shadow: inset 0 0 40px rgba(0, 255, 136, 0.04);
  -webkit-overflow-scrolling: touch;
}

.tools-count {
  margin: 0 0 10px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--muted);
}

.tools-mount details.tool-block:last-child {
  margin-bottom: 0;
}

.engineering-card-wide {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  align-self: stretch;
  animation-delay: 0.12s;
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: clamp(14px, 1.9vw, 20px) clamp(15px, 2.1vw, 22px) clamp(16px, 2.4vw, 24px);
  box-sizing: border-box;
  overflow-x: clip;
}

.engineering-card-wide .engineering-card-header {
  flex-shrink: 0;
}

.engineering-card-wide .engineering-card-header .h3 {
  margin: 0 0 8px;
  font-size: 1.0625rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.25;
}

.engineering-card-wide .engineering-card-lead {
  margin: 0 0 14px;
  font-size: 13px;
  line-height: 1.55;
  max-width: none;
  width: 100%;
  hyphens: auto;
  overflow-wrap: break-word;
}

.engineering-card-wide .engineering-controls {
  max-width: 100%;
}

.engineering-card-wide .engineering-summary {
  max-width: 100%;
}

.engineering-card-wide .engineering-summary-grid {
  max-width: 100%;
}

.engineering-card-wide .engineering-json {
  width: 100%;
  max-width: none;
  min-height: min(140px, 26vh);
  max-height: min(52vh, 560px);
  margin-top: 12px;
  flex: 0 1 auto;
  box-sizing: border-box;
}

.engineering-card .engineering-controls {
  margin: 0 0 10px;
  flex-shrink: 0;
}

.engineering-card .engineering-summary {
  flex-shrink: 0;
  margin-bottom: 0;
  max-width: 100%;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

.engineering-json {
  flex: 1 1 auto;
  min-height: 120px;
  max-height: min(38vh, 300px);
  margin-top: 10px;
}

@media (min-width: 700px) {
  .split-cards.tools-api-grid.tools-api-grid-dual {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@keyframes yamx-card-in {
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Settings: horizontal section tabs */
.settings-shell {
  display: flex;
  flex-direction: column;
  gap: 0;
  min-height: 0;
}

.settings-tablist {
  display: flex;
  flex-wrap: nowrap;
  gap: 8px;
  overflow-x: auto;
  overflow-y: hidden;
  padding: 4px 4px 14px;
  margin: 0 -4px 4px;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: thin;
}

.settings-tab {
  flex: 0 0 auto;
  margin: 0;
  padding: 9px 16px;
  height: auto;
  min-height: 38px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--panel-2);
  color: var(--muted);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.12s, color 0.12s, border-color 0.12s;
}

.settings-tab:hover {
  color: var(--text);
  border-color: rgba(0, 255, 136, 0.4);
  background: rgba(0, 255, 136, 0.08);
}

.settings-tab.active {
  color: var(--accent);
  border-color: var(--accent-dim);
  background: var(--accent-soft);
  font-weight: 600;
}

.settings-panels {
  min-height: 0;
}

.settings-tab-panel {
  display: none;
  padding: 4px 2px 8px;
}

.settings-tab-panel.active {
  display: block;
}

.settings-tab-panel .form-section {
  margin: 0;
}

.settings-tab-panel .form-section + .form-section {
  margin-top: 14px;
}

.lead { color: var(--muted); margin: 0 0 16px; max-width: 70ch; }
.h3 { margin: 24px 0 8px; font-size: 1rem; }
.muted { color: var(--muted); font-size: 13px; }

.status {
  margin-bottom: 12px;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
  display: none;
}
.status.show { display: block; }
.status.ok { background: var(--accent-soft); color: var(--accent-dim); }
.status.err { background: rgba(255, 77, 125, 0.12); color: var(--bad); }

.form-grid {
  display: grid;
  gap: 14px;
}
.form-section {
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 14px 16px;
  background: var(--panel);
}
.form-section h4 {
  margin: 0 0 12px;
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: .04em;
  color: var(--muted);
}
.provider-block {
  padding-bottom: 14px;
  margin-bottom: 14px;
  border-bottom: 1px solid var(--line);
}
.provider-block:last-child {
  border-bottom: 0;
  margin-bottom: 0;
  padding-bottom: 0;
}
.field {
  margin-bottom: 12px;
}
.field:last-child { margin-bottom: 0; }
.field label {
  display: block;
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 4px;
}
.settings-tab-panel .field input[type="text"],
.settings-tab-panel .field input[type="password"],
.settings-tab-panel .field input[type="number"],
.settings-tab-panel .field select,
.settings-tab-panel .field textarea {
  max-width: 100%;
}
.field input[type="text"],
.field input[type="password"],
.field input[type="number"],
.field select,
.field textarea {
  width: 100%;
  max-width: min(560px, 100%);
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--panel-2);
  color: var(--text);
  font: 13px "Cascadia Code", "JetBrains Mono", "Fira Code", Consolas, monospace;
}
.field textarea { min-height: 64px; resize: vertical; }
.field input[type="checkbox"] {
  width: auto;
  margin-right: 8px;
}
.inline-check label { display: inline; }

.btn-row {
  margin-top: 20px;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
button.primary {
  background: linear-gradient(180deg, #e8b56a 0%, #d97757 52%, #a3563c 100%);
  border-color: rgba(217, 119, 87, 0.7);
  color: #2a211c;
  font-weight: 700;
  text-shadow: none;
  box-shadow: 0 0 16px rgba(217, 119, 87, 0.28);
}
button.primary:hover {
  background: linear-gradient(180deg, #f6d7a8 0%, #e09458 52%, #c46848 100%);
  border-color: var(--accent);
  color: #2a211c;
}
button.danger {
  background: rgba(80, 8, 20, 0.45);
  border-color: rgba(255, 77, 125, 0.5);
  color: #ffa8bc;
}
button.small {
  padding: 6px 12px;
  font-size: 12px;
  margin-bottom: 12px;
}

table.sessions {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
table.sessions th, table.sessions td {
  text-align: left;
  padding: 8px 10px;
  border-bottom: 1px solid var(--line);
}
table.sessions tr.active { background: var(--accent-soft); }
table.sessions button {
  padding: 4px 10px;
  font-size: 12px;
}
table.sessions td.session-actions {
  vertical-align: middle;
}
.session-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.session-actions button {
  height: auto;
  min-height: 32px;
  min-width: 0;
}

.sessions-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 14px;
  align-items: center;
}

button.danger-text {
  background: rgba(80, 8, 20, 0.35);
  border-color: rgba(255, 77, 125, 0.45);
  color: var(--bad);
}

.api-doc-mount { margin-top: 10px; overflow-x: auto; -webkit-overflow-scrolling: touch; }
.api-group { margin-bottom: 18px; min-width: 0; max-width: 100%; }
.api-group-title {
  margin: 0 0 8px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--muted);
}
.api-table {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  border-collapse: collapse;
  font-size: 12px;
  table-layout: fixed;
}
.api-table th:first-child,
.api-table td:first-child {
  width: 4.5rem;
}
.api-table th:nth-child(2),
.api-table td:nth-child(2) {
  width: 34%;
}
.api-table th:nth-child(3),
.api-table td:nth-child(3) {
  width: 20%;
}
.api-table th:nth-child(4),
.api-table td:nth-child(4) {
  width: auto;
}
.api-table th, .api-table td {
  text-align: left;
  padding: 8px 10px;
  border-bottom: 1px solid var(--line);
  vertical-align: top;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.api-table th {
  color: var(--muted);
  font-weight: 600;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.api-row { cursor: pointer; }
.api-row:hover { background: var(--accent-soft); }
.http-method {
  display: inline-block;
  min-width: 54px;
  padding: 3px 8px;
  border-radius: 4px;
  font-weight: 700;
  font-size: 10px;
  text-align: center;
  font-family: var(--font-mono);
}
.http-method.m-get { background: rgba(46, 243, 217, 0.12); color: var(--cyan); border: 1px solid rgba(46, 243, 217, 0.35); }
.http-method.m-post { background: rgba(0, 255, 136, 0.12); color: var(--accent); border: 1px solid rgba(0, 255, 136, 0.38); }
.http-method.m-patch { background: rgba(255, 224, 77, 0.1); color: var(--warn); border: 1px solid rgba(255, 224, 77, 0.35); }
.http-method.m-delete { background: rgba(255, 77, 125, 0.12); color: var(--bad); border: 1px solid rgba(255, 77, 125, 0.38); }
.api-path code { font-size: 11px; word-break: break-word; line-height: 1.35; }
.api-body-hint { font-size: 11px; color: var(--muted); }
.raw-api-details { margin-top: 14px; }
.raw-api-details summary { cursor: pointer; color: var(--muted); }
.code-tight { max-height: 220px; margin-top: 8px; }

.tool-filter-label {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
  font-size: 13px;
  color: var(--muted);
}
.tool-filter {
  flex: 1;
  min-width: 140px;
  max-width: 320px;
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid var(--line);
  background: var(--panel-2);
  color: var(--text);
  font: inherit;
}

.engineering-controls {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
  align-items: end;
  margin: 12px 0 12px;
}
.engineering-controls label {
  display: grid;
  gap: 5px;
  font-size: 12px;
  color: var(--muted);
  min-width: 0;
}
.engineering-controls select {
  width: 100%;
  min-width: 0;
  max-width: none;
  padding: 9px 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel-2);
  color: var(--text);
  font: inherit;
}
.engineering-btns {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  grid-column: 1 / -1;
}
@media (min-width: 640px) and (max-width: 899px) {
  .engineering-controls {
    grid-template-columns: 1fr 1fr;
  }
}
@media (min-width: 900px) {
  .engineering-controls {
    grid-template-columns: minmax(140px, 1fr) minmax(140px, 1fr) auto;
  }
  .engineering-btns {
    grid-column: auto;
    justify-self: start;
    align-self: end;
  }
}
.engineering-summary {
  font-size: 12px;
  line-height: 1.45;
  margin-bottom: 10px;
}
.engineering-summary-grid {
  display: grid;
  gap: 6px;
}
.engineering-summary .ok { color: var(--accent); }
.engineering-summary .warn { color: var(--warn); }
.engineering-summary .bad { color: var(--bad); }

details.tool-block {
  border: 1px solid var(--line);
  border-radius: 8px;
  margin-bottom: 8px;
  background: var(--panel);
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
}
details.tool-block summary {
  padding: 10px 12px;
  cursor: pointer;
  list-style: none;
}
details.tool-block summary::-webkit-details-marker { display: none; }
.tool-name { font-weight: 600; color: var(--accent); }
.tool-desc { font-size: 12px; color: var(--muted); margin-top: 4px; font-weight: 400; }
.tool-schema {
  margin: 0 12px 12px;
  max-height: 220px;
  max-width: calc(100% - 24px);
  font-size: 11px;
  overflow: auto;
  box-sizing: border-box;
}
.tool-hidden { display: none !important; }

pre.code {
  background: var(--terminal-bg);
  border: 1px solid rgba(0, 255, 136, 0.22);
  padding: 12px;
  border-radius: 10px;
  overflow: auto;
  font-size: 12px;
  line-height: 1.4;
  max-height: min(50vh, 360px);
  color: var(--reply-shell);
  font-family: var(--font-mono);
}

.terminal {
  flex: 1;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 14px 16px 24px;
  background:
    repeating-linear-gradient(
      0deg,
      transparent 0,
      transparent 3px,
      rgba(0, 255, 136, 0.02) 3px,
      rgba(0, 255, 136, 0.02) 6px
    ),
    radial-gradient(70% 50% at 50% -5%, rgba(0, 255, 136, 0.04), transparent),
    var(--terminal-bg);
  font-family: var(--font-mono);
  color: var(--muted);
  -webkit-overflow-scrolling: touch;
}

.terminal-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 32px 20px 48px;
  min-height: 120px;
  color: var(--muted);
}
.terminal-empty.is-hidden { display: none; }
.empty-icon {
  font-size: 1.75rem;
  opacity: 0.35;
  margin-bottom: 10px;
}
.empty-title {
  margin: 0 0 8px;
  font-size: 1rem;
  font-weight: 600;
  color: var(--accent);
  font-family: var(--font-mono);
  text-shadow: 0 0 12px rgba(0, 255, 136, 0.35);
}
.empty-hint { margin: 0; max-width: 36ch; font-size: 13px; line-height: 1.45; }

.entry {
  margin: 0 0 14px;
  padding-bottom: 14px;
  border-bottom: 1px solid rgba(0, 255, 136, 0.12);
}
.entry.turn {
  margin: 0 0 14px;
  padding: 14px 14px 16px;
  border-bottom: none;
  border-radius: 14px;
  border: 1px solid rgba(0, 255, 136, 0.2);
  background: rgba(8, 16, 12, 0.85);
  box-shadow:
    inset 0 0 48px rgba(0, 255, 136, 0.03),
    0 0 20px rgba(0, 255, 136, 0.06);
}

.user-prompt {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}
.user-label {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--cyan);
  font-family: var(--font-mono);
  text-shadow: 0 0 10px rgba(46, 243, 217, 0.45);
}
.user-text {
  margin: 0;
  font-size: 14px;
  line-height: 1.45;
  color: var(--text);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  padding: 10px 12px;
  background: rgba(46, 243, 217, 0.06);
  border-radius: 8px;
  border-left: 3px solid var(--cyan);
  font-family: var(--font-mono);
  border-top: 1px solid rgba(46, 243, 217, 0.12);
  border-right: 1px solid rgba(46, 243, 217, 0.08);
  border-bottom: 1px solid rgba(46, 243, 217, 0.08);
}

.assistant { position: relative; }

.pending-line {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 10px 12px;
  background: rgba(0, 255, 136, 0.06);
  border-radius: 8px;
  border: 1px dashed rgba(0, 255, 136, 0.4);
  color: var(--accent-dim);
  font-size: 13px;
  font-family: var(--font-mono);
}

.spinner {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  border: 2px solid var(--line);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: yamx-spin 0.65s linear infinite;
}
@keyframes yamx-spin {
  to { transform: rotate(360deg); }
}

.pending-text { flex: 1; min-width: 100px; }
.pending-elapsed {
  font-variant-numeric: tabular-nums;
  font-size: 12px;
  opacity: 0.9;
}

.result-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 4px;
}
.kind-chip {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding: 3px 9px;
  border-radius: 999px;
  background: rgba(0, 255, 136, 0.12);
  border: 1px solid rgba(0, 255, 136, 0.45);
  color: var(--accent);
  font-family: var(--font-mono);
  text-shadow: 0 0 8px rgba(0, 255, 136, 0.55);
}
.kind-chip.shell {
  color: var(--cyan);
  background: rgba(46, 243, 217, 0.1);
  border-color: rgba(46, 243, 217, 0.45);
  text-shadow: 0 0 10px rgba(46, 243, 217, 0.5);
}
.kind-chip.err {
  color: var(--bad);
  background: rgba(255, 77, 125, 0.1);
  border-color: rgba(255, 77, 125, 0.5);
  text-shadow: 0 0 8px rgba(255, 77, 125, 0.45);
}
.kind-chip.offline {
  color: #d4f57a;
  background: rgba(180, 230, 90, 0.12);
  border-color: rgba(200, 240, 120, 0.45);
  text-shadow: 0 0 8px rgba(200, 240, 120, 0.45);
}

/* Legacy single-block layout (if ever used) */
.cmdline {
  display: flex;
  gap: 8px;
  color: var(--accent);
  overflow-wrap: anywhere;
}

.meta {
  margin: 6px 0 8px;
  color: var(--muted);
  font-size: 12px;
}
.meta.fail { color: var(--bad); }
.meta.warn { color: var(--warn); }
pre.out {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--reply-shell);
  font-size: 13px;
  line-height: 1.5;
  text-shadow: 0 0 1px rgba(92, 255, 154, 0.35);
}
.entry.turn:has(.kind-chip:not(.shell):not(.err):not(.offline)) pre.out {
  color: var(--reply-chat);
  text-shadow: 0 0 1px rgba(122, 252, 255, 0.35);
}
.entry.turn:has(.kind-chip.offline) pre.out {
  color: var(--reply-shell);
  text-shadow: 0 0 1px rgba(92, 255, 154, 0.35);
}
.entry.turn:has(.kind-chip.err) pre.out {
  color: var(--bad);
  text-shadow: none;
}
.terminal-tools {
  flex-shrink: 0;
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  padding: 8px 14px;
  border-top: 1px solid rgba(0, 255, 136, 0.2);
  background: #080e0b;
  font-family: var(--font-mono);
}
.terminal-tools button {
  height: 32px;
  min-width: 0;
  font-size: 12px;
  padding: 0 10px;
}

.commandbar {
  flex-shrink: 0;
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 10px;
  align-items: center;
  padding: 12px 16px;
  padding-bottom: max(12px, var(--safe-bottom));
  border-top: 1px solid rgba(0, 255, 136, 0.25);
  background: linear-gradient(180deg, #0a110e 0%, #050807 100%);
  font-family: var(--font-mono);
}
.prompt { color: var(--accent); font-weight: 700; text-shadow: 0 0 10px rgba(0, 255, 136, 0.5); }
.commandbar input {
  width: 100%;
  min-width: 0;
  height: 50px;
  border: 1px solid rgba(0, 255, 136, 0.35);
  background: var(--terminal-bg);
  color: var(--reply-shell);
  border-radius: 10px;
  padding: 0 11px;
  font: inherit;
  outline: none;
}
.commandbar input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(0, 255, 136, 0.25), 0 0 16px rgba(0, 255, 136, 0.15);
}

button {
  height: 38px;
  min-width: 64px;
  border: 1px solid rgba(0, 255, 136, 0.35);
  border-radius: 10px;
  background: var(--panel-2);
  color: var(--accent-dim);
  font: inherit;
  font-family: var(--font-mono);
  cursor: pointer;
  transition: background .16s, border-color .16s, transform .08s ease, box-shadow .15s;
}
button:hover {
  background: rgba(0, 255, 136, 0.1);
  border-color: var(--accent);
  color: var(--accent);
  box-shadow: 0 0 12px rgba(0, 255, 136, 0.15);
}
button:active {
  transform: translateY(1px);
}
button:disabled { opacity: .55; cursor: wait; }
button:focus-visible,
.menu-toggle:focus-visible,
.nav-item:focus-visible,
.mode-select:focus-visible,
.commandbar input:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.settings-tablist .settings-tab {
  height: auto;
}

.menu-toggle { min-width: unset; }

@media (max-width: 1024px) {
  :root {
    --sidebar-w: 236px;
  }
}

@media (max-width: 900px) {
  .tools-api-grid.tools-api-grid-dual {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 768px) {
  .app-shell { position: relative; }
  .menu-toggle { display: flex; }

  .sidebar {
    position: fixed;
    top: 0;
    left: env(safe-area-inset-left, 0);
    bottom: 0;
    z-index: 100;
    width: min(300px, calc(88vw - env(safe-area-inset-left, 0px)));
    max-width: 100%;
    transform: translateX(-102%);
    transition: transform 0.22s ease;
    box-shadow: 12px 0 40px rgba(28, 45, 58, 0.28);
    padding-top: max(20px, var(--safe-top));
    padding-bottom: max(22px, var(--safe-bottom));
  }
  .sidebar.open {
    transform: translateX(0);
  }
  .sidebar-backdrop.show {
    display: block;
  }

  .mainbar-title { font-size: 0.95rem; }
  .pill { min-width: 0; padding: 5px 8px; font-size: 11px; }

  .panel-inner {
    padding: 16px 14px 28px;
  }

  table.sessions {
    font-size: 12px;
  }
  table.sessions th,
  table.sessions td {
    padding: 6px 8px;
  }

  .shell-split {
    grid-template-columns: 1fr;
    gap: 12px;
  }
  .shell-sessions-panel {
    max-height: min(52vh, 420px);
  }

  .chrome-hint { display: none; }

  .shell-stage {
    padding: 10px 12px 14px;
    overflow: hidden;
  }
  .shell-card {
    max-width: 100%;
    max-height: min(82vh, calc(100dvh - var(--mainbar-h) - var(--safe-top) - var(--safe-bottom) - 52px));
    border-radius: 12px;
    min-height: min(300px, 48vh);
  }

  .execution-toolbar {
    padding: 10px 12px;
  }
  .provider-readiness-row {
    padding: 6px 12px 10px;
  }
  .execution-lab-grid {
    grid-template-columns: 1fr;
  }
  .mode-select {
    width: 100%;
    max-width: 220px;
  }
  .runbook-row .inline-check {
    width: 100%;
  }
}

@media (max-width: 560px) {
  .mainbar {
    padding-left: 8px;
    padding-right: 12px;
  }
  .execution-lab > summary {
    padding: 10px 12px;
  }
  .execution-lab-grid,
  .execution-profiles,
  .runbook-block {
    padding-left: 12px;
    padding-right: 12px;
  }
  .execution-profiles {
    gap: 6px;
  }
  .exec-profile {
    height: 28px;
    padding: 0 8px;
    font-size: 10px;
  }
  .terminal-tools {
    padding: 8px 12px;
    gap: 6px;
  }
  .terminal-tools button {
    height: 30px;
    font-size: 11px;
    padding: 0 8px;
  }
  .commandbar {
    grid-template-columns: auto 1fr auto;
    padding: 10px 12px;
    gap: 8px;
  }
  .btn-row button {
    width: 100%;
    justify-self: stretch;
  }

  .split-cards.tools-api-grid.tools-api-grid-dual > .card {
    min-height: 0;
  }
  .api-doc-card .api-doc-mount,
  .tools-mount {
    max-height: min(50vh, 360px);
    min-height: 160px;
  }
  .engineering-card-wide .engineering-json {
    max-height: min(42vh, 280px);
    min-height: 96px;
  }
}

@media (max-width: 400px) {
  .commandbar {
    grid-template-columns: 1fr;
    gap: 8px;
  }
  .commandbar .prompt {
    display: none;
  }
  .commandbar button[type="submit"] {
    width: 100%;
    min-width: 0;
  }
}`;

export const WEB_JS = `
(function () {
  const terminal = document.getElementById('terminal');
  const form = document.getElementById('command-form');
  const input = document.getElementById('command-input');
  const state = document.getElementById('state');
  const brandTag = document.getElementById('brand-tag');
  const cwd = document.getElementById('cwd');
  const appVer = document.getElementById('app-ver');
  const providerReadiness = document.getElementById('provider-readiness');
  const sidebar = document.getElementById('sidebar');
  const sidebarBackdrop = document.getElementById('sidebar-backdrop');
  const menuToggle = document.getElementById('menu-toggle');
  const mainbarTitle = document.getElementById('mainbar-title');
  const settingsMount = document.getElementById('settings-mount');
  const settingsStatus = document.getElementById('settings-status');
  const sessionsMount = document.getElementById('sessions-mount');
  const shellSessionsMount = document.getElementById('shell-sessions-mount');
  const shellSessionsStatus = document.getElementById('shell-sessions-status');
  const sessionsStatus = document.getElementById('sessions-status');
  const toolsMount = document.getElementById('tools-mount');
  const toolFilter = document.getElementById('tool-filter');
  const btnClearTerminal = document.getElementById('btn-clear-terminal');
  const btnCopyLastOutput = document.getElementById('btn-copy-last-output');
  const btnExportTranscript = document.getElementById('btn-export-transcript');
  const sendBtn = form.querySelector('button[type="submit"]') || form.querySelector('button');
  var toolsListCache = [];
  var executionBusy = false;

  const PANEL_TITLES = {
    terminal: 'Shell',
    settings: 'Settings',
    sessions: 'Sessions',
    tools: 'Tools'
  };

  function renderProviderReadiness(data) {
    if (!providerReadiness) return;
    if (!data || typeof data.agentCanRun !== 'boolean') {
      providerReadiness.textContent = 'Model status unavailable.';
      providerReadiness.className = 'provider-readiness-row';
      return;
    }
    var model = String(data.model || '').trim();
    var hint = String(data.providerHint || '').trim();
    if (data.agentCanRun) {
      providerReadiness.textContent = (model || 'model') + ' · endpoint ready';
      providerReadiness.className = 'provider-readiness-row provider-readiness-ok';
      return;
    }
    providerReadiness.textContent = hint || 'Add a model under Settings, Model.';
    providerReadiness.className = 'provider-readiness-row provider-readiness-bad';
  }

  function text(value) {
    return String(value == null ? '' : value);
  }

  function crewLabel(data) {
    var provider = String((data && data.provider) || '');
    var model = String((data && data.model) || '');
    if (!data || data.agentCanRun === false || !provider || provider === 'offline' || !model || model === 'local') {
      return 'local · offline';
    }
    return model + ' · ' + provider;
  }

  function showCrew(data) {
    if (!data || !data.provider) return;
    var label = crewLabel(data);
    if (brandTag) brandTag.textContent = label;
    setState(label, data && data.allowDangerous ? 'bad' : 'ok');
  }

  function setState(label, cls) {
    if (!state) return;
    state.textContent = label;
    state.className = 'pill' + (cls ? ' ' + cls : '');
  }

  function setSettingsStatus(msg, kind) {
    if (!settingsStatus) return;
    settingsStatus.textContent = msg || '';
    settingsStatus.className = 'status show ' + (kind || '');
    if (!msg) settingsStatus.className = 'status';
  }

  function setSessionsStatus(msg, kind) {
    function apply(el) {
      if (!el) return;
      el.textContent = msg || '';
      el.className = 'status show ' + (kind || '');
      if (!msg) el.className = 'status';
    }
    apply(sessionsStatus);
    apply(shellSessionsStatus);
  }

  function getPath(obj, path) {
    const parts = path.split('.');
    let v = obj;
    for (const p of parts) {
      if (v == null) return undefined;
      v = v[p];
    }
    return v;
  }

  function closeMobileNav() {
    sidebar.classList.remove('open');
    sidebarBackdrop.classList.remove('show');
    sidebarBackdrop.setAttribute('aria-hidden', 'true');
    if (menuToggle) menuToggle.setAttribute('aria-expanded', 'false');
  }

  function openMobileNav() {
    sidebar.classList.add('open');
    sidebarBackdrop.classList.add('show');
    sidebarBackdrop.setAttribute('aria-hidden', 'false');
    if (menuToggle) menuToggle.setAttribute('aria-expanded', 'true');
  }

  function toggleMobileNav() {
    if (sidebar.classList.contains('open')) closeMobileNav();
    else openMobileNav();
  }

  function showPanel(name) {
    document.querySelectorAll('.nav-item').forEach(function (t) {
      var on = t.dataset.panel === name;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('.panel').forEach(function (p) {
      p.classList.toggle('active', p.id === 'panel-' + name);
    });
    if (mainbarTitle) mainbarTitle.textContent = PANEL_TITLES[name] || name;
    closeMobileNav();

    if (name === 'settings') loadSettings();
    if (name === 'sessions') loadSessions();
    if (name === 'tools') loadTools();
    if (name === 'terminal') {
      loadSessions();
      if (input) input.focus();
    }
  }

  document.querySelectorAll('.nav-item').forEach(function (btn) {
    btn.addEventListener('click', function () {
      showPanel(btn.dataset.panel);
    });
  });

  if (menuToggle) {
    menuToggle.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleMobileNav();
    });
  }
  sidebarBackdrop.addEventListener('click', closeMobileNav);
  window.addEventListener('resize', function () {
    if (window.matchMedia('(min-width: 769px)').matches) closeMobileNav();
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') closeMobileNav();
  });

  function hideTerminalEmpty() {
    var el = document.getElementById('terminal-empty');
    if (el) el.classList.add('is-hidden');
  }

  function pendingLabelFor(cmd) {
    var t = String(cmd || '').trim();
    if (/^(npm|npx|pnpm|yarn|git|node|cd|dir|ls|pwd|curl|wget|python|py|go\\s|cargo\\s|dotnet\\s|docker\\s)/i.test(t)) return 'Running command...';
    if (/\b(scan|analyze|analyse)\s+(my\s+)?(the\s+)?(project|codebase|repo)\b/i.test(t)) return 'Scanning project locally…';
    if (/^[a-zA-Z0-9_.\\/~+-]+$/.test(t) && t.length < 72 && !/\\s/.test(t)) return 'Running command...';
    if (t.length > 96 || /[?]/.test(t) || /^(why|how|what|explain|write|create|fix|help|show|list|describe)\\b/i.test(t)) return 'YamX is responding...';
    return 'Working...';
  }

  function metaLineText(result) {
    if (result.kind === 'error') return '';
    var failed = result.blocked || result.code !== 0 || result.timedOut;
    if (result.kind === 'chat') {
      return ['provider=' + (result.provider || ''), 'model=' + (result.model || ''), 'cwd=' + (result.cwd || ''), (result.durationMs != null ? result.durationMs + 'ms' : '')].filter(Boolean).join(' | ');
    }
    if (result.kind === 'offline_scan') {
      return ['offline scan', 'cwd=' + (result.cwd || ''), (result.durationMs != null ? result.durationMs + 'ms' : ''), result.sessionId ? 'session=' + result.sessionId : ''].filter(Boolean).join(' | ');
    }
    return ['shell=' + (result.shell || ''), 'cwd=' + (result.cwd || ''), (result.durationMs != null ? result.durationMs + 'ms' : ''), result.blocked ? 'blocked' : 'exit=' + result.code].filter(Boolean).join(' | ');
  }

  function startTurn(command) {
    hideTerminalEmpty();
    var entry = document.createElement('section');
    entry.className = 'entry turn';

    var userRow = document.createElement('div');
    userRow.className = 'user-prompt';
    var ul = document.createElement('span');
    ul.className = 'user-label';
    ul.textContent = 'You';
    var ut = document.createElement('p');
    ut.className = 'user-text';
    ut.textContent = command;
    userRow.appendChild(ul);
    userRow.appendChild(ut);

    var assist = document.createElement('div');
    assist.className = 'assistant';

    var pending = document.createElement('div');
    pending.className = 'pending-line';
    pending.setAttribute('aria-busy', 'true');
    var spinner = document.createElement('span');
    spinner.className = 'spinner';
    spinner.setAttribute('aria-hidden', 'true');
    var pt = document.createElement('span');
    pt.className = 'pending-text';
    pt.textContent = pendingLabelFor(command);
    var pe = document.createElement('span');
    pe.className = 'pending-elapsed';
    pe.textContent = '0 ms';
    pending.appendChild(spinner);
    pending.appendChild(pt);
    pending.appendChild(pe);
    assist.appendChild(pending);
    entry.appendChild(userRow);
    entry.appendChild(assist);
    terminal.appendChild(entry);

    var t0 = Date.now();
    var iv = setInterval(function () {
      if (!entry.isConnected) { clearInterval(iv); return; }
      var dt = Date.now() - t0;
      pe.textContent = dt < 1000 ? dt + ' ms' : (dt / 1000).toFixed(1) + ' s';
    }, 100);

    terminal.setAttribute('aria-busy', 'true');
    terminal.scrollTop = terminal.scrollHeight;

    function finishResult(result) {
      clearInterval(iv);
      if (pending.parentNode) pending.remove();
      terminal.setAttribute('aria-busy', 'false');

      var head = document.createElement('div');
      head.className = 'result-head';
      var chip = document.createElement('span');
      var chipKind = result.kind === 'chat' ? '' : result.kind === 'error' ? ' err' : result.kind === 'offline_scan' ? ' offline' : ' shell';
      chip.className = 'kind-chip' + chipKind;
      chip.textContent = result.kind === 'chat' ? 'YamX' : result.kind === 'error' ? 'Error' : result.kind === 'offline_scan' ? 'Offline' : 'Shell';
      head.appendChild(chip);
      var metaStr = metaLineText(result);
      if (metaStr) {
        var meta = document.createElement('div');
        var failed = result.blocked || result.code !== 0 || result.timedOut;
        meta.className = 'meta ' + (result.blocked ? 'warn' : failed ? 'fail' : '');
        meta.textContent = metaStr;
        head.appendChild(meta);
      }
      var pre = document.createElement('pre');
      pre.className = 'out';
      pre.textContent = text(result.output);
      assist.appendChild(head);
      assist.appendChild(pre);
      terminal.scrollTop = terminal.scrollHeight;
    }

    return { finish: finishResult };
  }

  async function refreshState() {
    const res = await fetch('/api/state');
    if (!res.ok) throw new Error('state failed');
    const data = await res.json();
    if (cwd) cwd.textContent = 'cwd: ' + data.cwd + (data.model ? ' | ' + data.model : '');
    renderProviderReadiness(data);
    showCrew(data);
  }

  async function refreshInfo() {
    try {
      const res = await fetch('/api/info');
      if (res.ok) {
        const j = await res.json();
        if (appVer) appVer.textContent = 'v' + j.version + ' | ' + j.node;
      }
    } catch (e) {}
  }

  function setExecutionBusy(on) {
    var busy = !!on;
    executionBusy = busy;
    if (input) input.disabled = busy;
    if (sendBtn) sendBtn.disabled = busy;
    if (btnClearTerminal) btnClearTerminal.disabled = busy;
    if (btnCopyLastOutput) btnCopyLastOutput.disabled = busy;
    if (btnExportTranscript) btnExportTranscript.disabled = busy;
  }

  async function executeTurn(rawCommand) {
    var command = String(rawCommand || '').trim();
    if (!command) return null;
    setState('running', '');
    var turn = startTurn(command);
    try {
      var res = await fetch('/api/command', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ command: command })
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        var failure = {
          ok: false,
          kind: 'error',
          blocked: false,
          code: 1,
          output: (data && data.error) ? String(data.error) : 'HTTP ' + res.status,
          cwd: '.',
          allowDangerous: false
        };
        turn.finish(failure);
        setState('error', 'bad');
        return failure;
      }
      turn.finish(data);
      if (cwd) cwd.textContent = 'cwd: ' + (data.cwd || '.') + (data.model ? ' | ' + data.model : '');
      showCrew(data);
      refreshState().catch(function () {});
      return data;
    } catch (error) {
      var networkFail = {
        ok: false,
        kind: 'error',
        blocked: false,
        code: 1,
        output: 'Request failed: ' + (error && error.message ? error.message : String(error)),
        cwd: '.',
        allowDangerous: false
      };
      turn.finish(networkFail);
      setState('error', 'bad');
      return networkFail;
    }
  }

  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    var command = input.value.trim();
    if (!command) return;
    input.value = '';
    setExecutionBusy(true);
    try {
      await executeTurn(command);
    } finally {
      setExecutionBusy(false);
      input.focus();
    }
  });

  function clearTerminalView() {
    terminal.innerHTML = [
      '<div class="terminal-empty" id="terminal-empty">',
      '  <div class="empty-icon" aria-hidden="true">[#]</div>',
      '  <p class="empty-title">Start a turn</p>',
      '  <p class="muted empty-hint">Your message appears here right away. YamX or the shell replies below when ready.</p>',
      '</div>'
    ].join('');
    terminal.scrollTop = 0;
  }

  function latestOutputText() {
    var outputs = terminal.querySelectorAll('pre.out');
    if (!outputs || outputs.length === 0) return '';
    var last = outputs[outputs.length - 1];
    return (last && last.textContent) ? String(last.textContent).trim() : '';
  }

  function buildTranscriptText() {
    var rows = [];
    var turns = terminal.querySelectorAll('.entry.turn');
    rows.push('YamX Web Transcript');
    rows.push('Generated: ' + new Date().toISOString());
    rows.push('');
    turns.forEach(function (turn, idx) {
      var user = turn.querySelector('.user-text');
      var kind = turn.querySelector('.kind-chip');
      var meta = turn.querySelector('.meta');
      var out = turn.querySelector('pre.out');
      rows.push('Turn ' + (idx + 1));
      rows.push('You: ' + (user && user.textContent ? user.textContent.trim() : ''));
      rows.push('Kind: ' + (kind && kind.textContent ? kind.textContent.trim() : ''));
      if (meta && meta.textContent) rows.push('Meta: ' + meta.textContent.trim());
      rows.push('Output:');
      rows.push(out && out.textContent ? out.textContent : '');
      rows.push('---');
    });
    return rows.join('\\n');
  }

  if (btnClearTerminal) {
    btnClearTerminal.addEventListener('click', function () {
      clearTerminalView();
      setState('terminal cleared', 'ok');
      setTimeout(function () { refreshState().catch(function () {}); }, 800);
    });
  }

  if (btnCopyLastOutput) {
    btnCopyLastOutput.addEventListener('click', async function () {
      var out = latestOutputText();
      if (!out) {
        setState('no output', 'bad');
        setTimeout(function () { refreshState().catch(function () {}); }, 800);
        return;
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(out);
        setState('output copied', 'ok');
        setTimeout(function () { refreshState().catch(function () {}); }, 800);
      }
    });
  }

  if (btnExportTranscript) {
    btnExportTranscript.addEventListener('click', function () {
      var textDump = buildTranscriptText();
      var blob = new Blob([textDump], { type: 'text/plain;charset=utf-8' });
      var stamp = new Date().toISOString().replace(/[:.]/g, '-');
      var link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'yamx-transcript-' + stamp + '.txt';
      document.body.appendChild(link);
      link.click();
      setTimeout(function () {
        URL.revokeObjectURL(link.href);
        link.remove();
      }, 0);
      setState('transcript exported', 'ok');
      setTimeout(function () { refreshState().catch(function () {}); }, 900);
    });
  }

  function renderSettingsForm(cfg) {
    if (!settingsMount) return;

    settingsMount.innerHTML = '';

    var shell = document.createElement('div');
    shell.className = 'settings-shell';
    var tablist = document.createElement('div');
    tablist.className = 'settings-tablist';
    tablist.setAttribute('role', 'tablist');
    var panelsRoot = document.createElement('div');
    panelsRoot.className = 'settings-panels';

    var firstTabId = null;

    function addSettingsTab(id, label, fill) {
      if (!firstTabId) firstTabId = id;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'settings-tab';
      btn.dataset.settingsTab = id;
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', 'false');
      btn.setAttribute('aria-controls', 'settings-panel-' + id);
      btn.textContent = label;
      var pan = document.createElement('div');
      pan.className = 'settings-tab-panel';
      pan.id = 'settings-panel-' + id;
      pan.dataset.settingsTab = id;
      pan.setAttribute('role', 'tabpanel');
      fill(pan);
      tablist.appendChild(btn);
      panelsRoot.appendChild(pan);
    }

    function showSettingsTab(id) {
      tablist.querySelectorAll('.settings-tab').forEach(function (b) {
        var on = b.dataset.settingsTab === id;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      panelsRoot.querySelectorAll('.settings-tab-panel').forEach(function (p) {
        var on = p.dataset.settingsTab === id;
        p.classList.toggle('active', on);
      });
    }

    tablist.addEventListener('click', function (e) {
      var t = e.target && e.target.closest && e.target.closest('.settings-tab');
      if (!t || !tablist.contains(t)) return;
      showSettingsTab(t.dataset.settingsTab);
    });

    function addField(parent, label, child) {
      var f = document.createElement('div');
      f.className = 'field';
      var l = document.createElement('label');
      l.textContent = label;
      f.appendChild(l);
      f.appendChild(child);
      parent.appendChild(f);
    }

    var s = cfg.settings || {};

    addSettingsTab('model', 'Model', function (pan) {
      var box = document.createElement('div');
      box.className = 'form-section';
      var h = document.createElement('h4');
      h.textContent = 'Custom model';
      box.appendChild(h);
      var lead = document.createElement('p');
      lead.className = 'muted';
      lead.textContent = 'Any OpenAI-compatible chat model. Leave the API key blank to keep the saved key.';
      box.appendChild(lead);
      var custom = (cfg.providers && cfg.providers.custom) || {};
      var baseIn = document.createElement('input');
      baseIn.type = 'text';
      baseIn.value = custom.baseUrl || '';
      baseIn.placeholder = 'https://api.example.com/v1';
      addField(box, 'Base URL', baseIn);
      var keyIn = document.createElement('input');
      keyIn.type = 'password';
      keyIn.autocomplete = 'new-password';
      keyIn.placeholder = (custom.apiKeyPresent || custom.apiKey === '********') ? '******** (enter a new key to replace)' : 'API key (optional)';
      addField(box, 'API key', keyIn);
      var modelIn = document.createElement('input');
      modelIn.type = 'text';
      modelIn.value = custom.model || '';
      modelIn.placeholder = 'any model id';
      addField(box, 'Model name', modelIn);
      var hdr = document.createElement('textarea');
      hdr.rows = 4;
      var lines = [];
      var extra = custom.extraHeaders || {};
      Object.keys(extra).forEach(function (key) {
        lines.push(key + ': ' + String(extra[key] == null ? '' : extra[key]));
      });
      hdr.value = lines.join('\\n');
      hdr.placeholder = 'Header-Name: value';
      addField(box, 'Extra headers (one Name: value per line)', hdr);
      var row = document.createElement('div');
      row.className = 'btn-row';
      var saveModel = document.createElement('button');
      saveModel.type = 'button';
      saveModel.className = 'primary';
      saveModel.textContent = 'Save model';
      var clearModel = document.createElement('button');
      clearModel.type = 'button';
      clearModel.textContent = 'Disconnect';
      row.appendChild(saveModel);
      row.appendChild(clearModel);
      box.appendChild(row);
      pan.appendChild(box);
      function headerRecord() {
        var headers = {};
        String(hdr.value || '').split(/\\n/).forEach(function (line) {
          var rowLine = String(line || '').trim();
          if (!rowLine) return;
          var idx = rowLine.indexOf(':');
          if (idx <= 0) return;
          var name = rowLine.slice(0, idx).trim();
          var value = rowLine.slice(idx + 1).trim();
          if (name) headers[name] = value;
        });
        return headers;
      }
      saveModel.addEventListener('click', function () {
        setSettingsStatus('Saving model...', 'ok');
        fetch('/api/connect', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            baseUrl: baseIn.value,
            apiKey: keyIn.value,
            model: modelIn.value,
            extraHeaders: headerRecord()
          })
        }).then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (data) {
            if (!res.ok) throw new Error((data && data.error) || 'save failed');
            renderSettingsForm(data.config || {});
            setSettingsStatus('Model saved. The next message uses it.', 'ok');
            refreshState().catch(function () {});
          });
        }).catch(function (e) {
          setSettingsStatus(e.message || String(e), 'err');
        });
      });
      clearModel.addEventListener('click', function () {
        setSettingsStatus('Disconnecting...', 'ok');
        fetch('/api/connect', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ clear: true })
        }).then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (data) {
            if (!res.ok) throw new Error((data && data.error) || 'disconnect failed');
            renderSettingsForm(data.config || {});
            setSettingsStatus('Disconnected. YamX is offline until you add a model.', 'ok');
            refreshState().catch(function () {});
          });
        }).catch(function (e) {
          setSettingsStatus(e.message || String(e), 'err');
        });
      });
    });

    addSettingsTab('behavior', 'Behavior', function (pan) {
      var st = document.createElement('div');
      st.className = 'form-section';
      var h = document.createElement('h4');
      h.textContent = 'Runtime & permissions';
      st.appendChild(h);

      function boolField(path, label) {
        var wrap = document.createElement('div');
        wrap.className = 'field inline-check';
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.dataset.cfgPath = path;
        cb.checked = !!getPath(cfg, path);
        var lab = document.createElement('label');
        lab.appendChild(cb);
        lab.appendChild(document.createTextNode(' ' + label));
        wrap.appendChild(lab);
        st.appendChild(wrap);
      }
      boolField('settings.autoApprove', 'Auto-approve tools');
      boolField('settings.streamOutput', 'Stream output (CLI; web chat is non-streaming)');
      boolField('settings.autoCommit', 'Auto-commit');
      boolField('settings.hooksEnabled', 'Hooks enabled');
      boolField('settings.verboseCli', 'Verbose CLI');
      boolField('settings.preflightRuntimeProbes', 'Preflight runtime probes');
      boolField('settings.checkForUpdates', 'Check for CLI updates');

      function numField(path, label, min, max, step) {
        var i = document.createElement('input');
        i.type = 'number';
        i.dataset.cfgPath = path;
        i.min = min;
        i.max = max;
        i.step = step || 1;
        i.value = String(getPath(cfg, path) ?? '');
        addField(st, label, i);
      }
      numField('settings.maxTokens', 'Max tokens', 256, 200000, 1);
      numField('settings.temperature', 'Temperature', 0, 2, 0.05);
      numField('settings.contextBudgetChars', 'Context budget (chars)', 10000, 2000000, 1000);
      numField('settings.contextKeepLastMessages', 'Context keep-last messages', 4, 40, 1);
      numField('settings.maxToolResultChars', 'Max tool result chars', 1000, 500000, 500);
      numField('settings.maxAssistantMarkdownChars', 'Max assistant markdown chars', 500, 100000, 100);

      var roll = document.createElement('select');
      roll.dataset.cfgPath = 'settings.contextRolloverMode';
      ['off', 'summary-next-session'].forEach(function (v) {
        var o = document.createElement('option');
        o.value = v;
        o.textContent = v;
        roll.appendChild(o);
      });
      roll.value = s.contextRolloverMode || 'off';
      addField(st, 'Context rollover mode', roll);

      var pm = document.createElement('select');
      pm.dataset.cfgPath = 'settings.permissionMode';
      ['default', 'ask', 'read-only', 'auto-safe'].forEach(function (v) {
        var o = document.createElement('option');
        o.value = v;
        o.textContent = v;
        pm.appendChild(o);
      });
      pm.value = s.permissionMode || 'default';
      addField(st, 'Permission mode', pm);

      pan.appendChild(st);
    });

    addSettingsTab('council', 'Model council', function (pan) {
      var mc = document.createElement('div');
      mc.className = 'form-section';
      var h = document.createElement('h4');
      h.textContent = 'Council';
      mc.appendChild(h);
      var mcRow = document.createElement('div');
      mcRow.className = 'field inline-check';
      var mcEn = document.createElement('input');
      mcEn.type = 'checkbox';
      mcEn.dataset.cfgPath = 'settings.modelCouncil.enabled';
      mcEn.checked = !!(s.modelCouncil && s.modelCouncil.enabled);
      var mcLab = document.createElement('label');
      mcLab.appendChild(mcEn);
      mcLab.appendChild(document.createTextNode(' Enable council'));
      mcRow.appendChild(mcLab);
      mc.appendChild(mcRow);
      var mcMode = document.createElement('select');
      mcMode.dataset.cfgPath = 'settings.modelCouncil.mode';
      ['adaptive', 'always', 'off'].forEach(function (v) {
        var o = document.createElement('option');
        o.value = v;
        o.textContent = v;
        mcMode.appendChild(o);
      });
      mcMode.value = (s.modelCouncil && s.modelCouncil.mode) || 'adaptive';
      addField(mc, 'Council mode', mcMode);
      pan.appendChild(mc);
    });

    addSettingsTab('subagents', 'Subagents', function (pan) {
      var sa = document.createElement('div');
      sa.className = 'form-section';
      var h = document.createElement('h4');
      h.textContent = 'Subagents';
      sa.appendChild(h);
      var saRow = document.createElement('div');
      saRow.className = 'field inline-check';
      var saEn = document.createElement('input');
      saEn.type = 'checkbox';
      saEn.dataset.cfgPath = 'settings.subagents.enabled';
      saEn.checked = !!(s.subagents && s.subagents.enabled);
      var saLab = document.createElement('label');
      saLab.appendChild(saEn);
      saLab.appendChild(document.createTextNode(' Enable subagents'));
      saRow.appendChild(saLab);
      sa.appendChild(saRow);
      var saMod = document.createElement('input');
      saMod.type = 'text';
      saMod.dataset.cfgPath = 'settings.subagents.defaultModel';
      saMod.value = (s.subagents && s.subagents.defaultModel) || '';
      addField(sa, 'Default subagent model', saMod);
      var saParallel = document.createElement('input');
      saParallel.type = 'number';
      saParallel.min = '1';
      saParallel.dataset.cfgPath = 'settings.subagents.maxParallel';
      saParallel.value = String((s.subagents && s.subagents.maxParallel) || 3);
      addField(sa, 'Max parallel readers', saParallel);
      var saIters = document.createElement('input');
      saIters.type = 'number';
      saIters.min = '1';
      saIters.dataset.cfgPath = 'settings.subagents.maxIterations';
      saIters.value = String((s.subagents && s.subagents.maxIterations) || 12);
      addField(sa, 'Max iterations per subagent', saIters);
      pan.appendChild(sa);
    });

    addSettingsTab('shell', 'Shell policy', function (pan) {
      var arr = document.createElement('div');
      arr.className = 'form-section';
      var h = document.createElement('h4');
      h.textContent = 'Allow / deny lists';
      arr.appendChild(h);
      var al = document.createElement('textarea');
      al.dataset.cfgPath = 'settings.allowedShellCommands';
      al.value = Array.isArray(s.allowedShellCommands) ? s.allowedShellCommands.join('\\n') : '';
      addField(arr, 'Allowed shell commands (newline or comma; empty = no extra allowlist)', al);
      var dn = document.createElement('textarea');
      dn.dataset.cfgPath = 'settings.deniedShellPatterns';
      dn.value = Array.isArray(s.deniedShellPatterns) ? s.deniedShellPatterns.join('\\n') : '';
      addField(arr, 'Denied shell patterns', dn);
      pan.appendChild(arr);
    });

    shell.appendChild(tablist);
    shell.appendChild(panelsRoot);
    settingsMount.appendChild(shell);
    showSettingsTab(firstTabId);
  }

  function buildPatchFromForm() {
    var patch = { settings: {}, providers: {} };
    if (!settingsMount) return patch;
    settingsMount.querySelectorAll('[data-cfg-path]').forEach(function (el) {
      var path = el.dataset.cfgPath;
      var parts = path.split('.');
      var val;
      if (el.type === 'checkbox') val = el.checked;
      else if (el.type === 'number') {
        val = parseFloat(el.value);
        if (!isFinite(val)) return;
      } else val = el.value;

      if (el.dataset.optionalSecret && (!val || !String(val).trim())) return;

      if (el.dataset.extraHeaders) {
        var headers = {};
        String(val || '').split(/\\n/).forEach(function (line) {
          var row = String(line || '').trim();
          if (!row) return;
          var idx = row.indexOf(':');
          if (idx <= 0) return;
          var hk = row.slice(0, idx).trim();
          var hv = row.slice(idx + 1).trim();
          if (hk) headers[hk] = hv;
        });
        val = headers;
      }

      if (path === 'settings.allowedShellCommands' || path === 'settings.deniedShellPatterns') {
        var raw = String(val || '').split(/[\\n,]+/).map(function (x) { return x.trim(); }).filter(Boolean);
        val = raw;
      }

      if (parts[0] === 'providers') {
        var pname = parts[1];
        var key = parts[2];
        if (!patch.providers[pname]) patch.providers[pname] = {};
        patch.providers[pname][key] = val;
        return;
      }
      if (parts[0] === 'settings') {
        var k = parts.slice(1);
        var cur = patch.settings;
        for (var i = 0; i < k.length - 1; i++) {
          if (!cur[k[i]]) cur[k[i]] = {};
          cur = cur[k[i]];
        }
        cur[k[k.length - 1]] = val;
        return;
      }
      if (path === 'defaultProvider') patch.defaultProvider = val;
      if (path === 'defaultModel') patch.defaultModel = val;
    });
    if (Object.keys(patch.providers).length === 0) delete patch.providers;
    if (Object.keys(patch.settings).length === 0) delete patch.settings;
    return patch;
  }

  var settingsLoaded = false;
  async function loadSettings() {
    setSettingsStatus('', '');
    try {
      const res = await fetch('/api/config');
      if (!res.ok) throw new Error('config GET failed');
      const data = await res.json();
      renderSettingsForm(data.config || {});
      settingsLoaded = true;
    } catch (e) {
      setSettingsStatus('Failed to load config: ' + e.message, 'err');
    }
  }

  document.getElementById('btn-save-config').addEventListener('click', async function () {
    setSettingsStatus('Saving...', 'ok');
    try {
      const patch = buildPatchFromForm();
      const res = await fetch('/api/config', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'save failed');
      renderSettingsForm(data.config || {});
      setSettingsStatus('Saved. Agent cache cleared for next chat.', 'ok');
      refreshState().catch(function () {});
    } catch (e) {
      setSettingsStatus('Save failed: ' + e.message, 'err');
    }
  });

  document.getElementById('btn-reload-runtime').addEventListener('click', async function () {
    try {
      const res = await fetch('/api/runtime/reload', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      const data = await res.json();
      setSettingsStatus(data.message || 'OK', 'ok');
    } catch (e) {
      setSettingsStatus(e.message, 'err');
    }
  });

  document.getElementById('btn-reset-config').addEventListener('click', async function () {
    if (!confirm('Reset ~/.yamx/config.json to defaults?')) return;
    try {
      const res = await fetch('/api/config/reset', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'reset failed');
      renderSettingsForm(data.config || {});
      setSettingsStatus('Reset to defaults.', 'ok');
      refreshState().catch(function () {});
    } catch (e) {
      setSettingsStatus(e.message, 'err');
    }
  });

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function renderToolsList(filter) {
    var q = (filter || '').trim().toLowerCase();
    var shown = 0;
    var html = '';
    toolsListCache.forEach(function (t) {
      var hay = (t.name + ' ' + (t.description || '')).toLowerCase();
      if (q && hay.indexOf(q) === -1) return;
      shown++;
      var paramsJson = '';
      try { paramsJson = JSON.stringify(t.parameters, null, 2); } catch (e) { paramsJson = '{}'; }
      html += '<details class="tool-block">';
      html += '<summary><div class="tool-name">' + escapeHtml(t.name) + '</div>';
      html += '<div class="tool-desc">' + escapeHtml(t.description || '') + '</div></summary>';
      html += '<pre class="code tool-schema">' + escapeHtml(paramsJson) + '</pre>';
      html += '</details>';
    });
    toolsMount.innerHTML = '<p class="muted tools-count">' + shown + ' / ' + toolsListCache.length + ' tools</p>' + html;
  }

  async function sessionRowAction(ev) {
    var btn = ev.currentTarget;
    var act = btn.dataset.act;
    var id = btn.dataset.sid;
    setSessionsStatus('', '');
    if (act === 'active') {
      var r = await fetch('/api/sessions/active', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: id })
      });
      if (r.ok) loadSessions();
      else {
        var ej = await r.json().catch(function () { return {}; });
        setSessionsStatus((ej && ej.error) || 'Could not set active', 'err');
      }
      return;
    }
    if (act === 'rename') {
      var sessionRes = await fetch('/api/sessions/' + encodeURIComponent(id));
      var sj = await sessionRes.json();
      var cur = (sj.session && sj.session.title) || '';
      var nt = prompt('Session title:', cur);
      if (nt === null) return;
      var patch = await fetch('/api/sessions/' + encodeURIComponent(id), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: nt })
      });
      var pj = await patch.json().catch(function () { return {}; });
      if (patch.ok) loadSessions();
      else setSessionsStatus((pj && pj.error) || 'Rename failed', 'err');
      return;
    }
    if (act === 'delete') {
      if (!confirm('Delete this session permanently?')) return;
      var d = await fetch('/api/sessions/' + encodeURIComponent(id), { method: 'DELETE' });
      var dj = await d.json().catch(function () { return {}; });
      if (d.ok) loadSessions();
      else setSessionsStatus((dj && dj.error) || 'Delete failed', 'err');
    }
  }

  function renderSessionsTable(mountEl, data) {
    if (!mountEl) return;
    var rows = '';
    (data.sessions || []).forEach(function (s) {
      var isActive = s.id === data.activeSessionId;
      rows += '<tr' + (isActive ? ' class="active"' : '') + '>';
      rows += '<td>' + escapeHtml(s.title) + '</td>';
      rows += '<td>' + s.messageCount + '</td>';
      rows += '<td>' + escapeHtml(s.updatedAt) + '</td>';
      rows += '<td class="session-actions">';
      rows += '<button type="button" data-act="active" data-sid="' + escapeHtml(s.id) + '"' + (isActive ? ' disabled' : '') + '>Use</button>';
      rows += '<button type="button" data-act="rename" data-sid="' + escapeHtml(s.id) + '">Rename</button>';
      rows += '<button type="button" class="danger-text" data-act="delete" data-sid="' + escapeHtml(s.id) + '">Delete</button>';
      rows += '</td></tr>';
    });
    if (!data.sessions || data.sessions.length === 0) {
      mountEl.innerHTML =
        '<p class="muted">No sessions yet. Use <strong>New</strong> (or Sessions tab) to create one.</p>';
      return;
    }
    mountEl.innerHTML =
      '<table class="sessions"><thead><tr><th>Title</th><th>Msgs</th><th>Updated</th><th>Actions</th></tr></thead><tbody>' +
      rows +
      '</tbody></table>';
    mountEl.querySelectorAll('button[data-act]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        sessionRowAction(e).catch(function (err) {
          setSessionsStatus(err.message || String(err), 'err');
        });
      });
    });
  }

  async function loadSessions() {
    if (sessionsMount) sessionsMount.innerHTML = 'Loading...';
    if (shellSessionsMount) shellSessionsMount.innerHTML = 'Loading...';
    setSessionsStatus('', '');
    try {
      var res = await fetch('/api/sessions');
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || 'sessions failed');
      renderSessionsTable(sessionsMount, data);
      renderSessionsTable(shellSessionsMount, data);
    } catch (e) {
      if (sessionsMount) sessionsMount.innerHTML = '';
      if (shellSessionsMount) shellSessionsMount.innerHTML = '';
      setSessionsStatus('Error: ' + e.message, 'err');
    }
  }

  async function handleNewSessionClick() {
    var title = prompt('Optional title for the new session:', '');
    if (title === null) return;
    setSessionsStatus('Creating...', 'ok');
    try {
      var r = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: title ? title : undefined, activate: true })
      });
      var j = await r.json().catch(function () { return {}; });
      if (!r.ok) throw new Error((j && j.error) || 'Create failed');
      setSessionsStatus('Session created.', 'ok');
      loadSessions();
    } catch (e) {
      setSessionsStatus(e.message, 'err');
    }
  }

  document.querySelectorAll('.js-session-new').forEach(function (btn) {
    btn.addEventListener('click', handleNewSessionClick);
  });

  document.querySelectorAll('.js-session-refresh').forEach(function (btn) {
    btn.addEventListener('click', function () {
      loadSessions();
    });
  });

  document.querySelectorAll('.js-open-sessions-tab').forEach(function (btn) {
    btn.addEventListener('click', function () {
      showPanel('sessions');
    });
  });

  async function loadTools() {
    if (!toolsMount) return;
    toolsMount.innerHTML = 'Loading...';
    try {
      var res = await fetch('/api/tools');
      var data = await res.json();
      if (!res.ok) throw new Error((data && data.error) || 'tools failed');
      toolsListCache = data.tools || [];
      renderToolsList(toolFilter ? toolFilter.value : '');
    } catch (e) {
      toolsMount.textContent = 'Error: ' + e.message;
    }
  }

  if (toolFilter) {
    toolFilter.addEventListener('input', function () {
      renderToolsList(toolFilter.value);
    });
  }

  refreshState().catch(function () {
    setState('error', 'bad');
    if (providerReadiness) {
      providerReadiness.textContent =
        'Offline or server unreachable — provider status unavailable.';
      providerReadiness.className = 'provider-readiness-row provider-readiness-bad';
    }
  });
  refreshInfo().catch(function () {});
  loadSessions();
})();
`;
