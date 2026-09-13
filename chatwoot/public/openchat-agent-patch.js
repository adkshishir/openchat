/**
 * OpenClaw Agent status + training page for Hub Chatwoot.
 * Open via Settings → "OpenClaw Agent" or /app/accounts/:id/settings/openclaw
 */
(function openchatAgentPatch() {
  const STYLE_ID = 'openchat-agent-patch-style';
  const PAGE_ID = 'openchat-agent-page';
  const NAV_ID = 'openchat-agent-nav';
  const FILES = ['SOUL.md', 'IDENTITY.md', 'AGENTS.md', 'USER.md', 'TOOLS.md', 'HEARTBEAT.md'];
  const FILE_HELP = {
    'SOUL.md': 'Personality, tone, boundaries — main training file',
    'IDENTITY.md': 'Name, vibe, how the agent presents itself',
    'AGENTS.md': 'Operating rules and how it should behave',
    'USER.md': 'Who you are / customer context',
    'TOOLS.md': 'Tool usage notes',
    'HEARTBEAT.md': 'Periodic check-in instructions',
  };

  let activeFile = 'SOUL.md';
  let dirty = false;
  let statusTimer = null;

  function accountId() {
    const match = window.location.pathname.match(/\/accounts\/(\d+)\//);
    return match ? match[1] : null;
  }

  function isAgentPage() {
    return /\/settings\/openclaw\/?$/.test(window.location.pathname) ||
      new URLSearchParams(window.location.search).get('openclaw') === 'agent';
  }

  function csrfToken() {
    const meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.getAttribute('content') : '';
  }

  function readCookie(name) {
    const match = document.cookie.match(
      new RegExp('(?:^|; )' + name.replace(/([.$?*|{}()[\]\\/+^])/g, '\\$1') + '=([^;]*)')
    );
    return match ? decodeURIComponent(match[1]) : '';
  }

  function authHeaders() {
    const headers = {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken(),
    };
    try {
      const raw = readCookie('cw_d_session_info');
      if (!raw) return headers;
      const data = JSON.parse(raw);
      headers['access-token'] = data['access-token'] || '';
      headers['token-type'] = data['token-type'] || 'Bearer';
      headers.client = data.client || '';
      headers.expiry = String(data.expiry || '');
      headers.uid = data.uid || '';
    } catch (_) {
      /* CSRF only */
    }
    return headers;
  }

  async function api(method, path, body) {
    const id = accountId();
    const opts = { method, credentials: 'include', headers: authHeaders() };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const response = await fetch(`/api/v1/accounts/${id}/openchat/${path}`, opts);
    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch (_) {
      data = { error: text };
    }
    if (!response.ok) {
      throw new Error(data.error || data.message || `Request failed (${response.status})`);
    }
    return data;
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${PAGE_ID} {
        position: fixed;
        inset: 0;
        z-index: 80;
        background: var(--n-solid-1, #0f1115);
        color: var(--n-slate-12, #f3f4f6);
        overflow: auto;
        font-family: inherit;
      }
      #${PAGE_ID} .oc-shell {
        max-width: 1100px;
        margin: 0 auto;
        padding: 1.5rem 1.75rem 3rem;
      }
      #${PAGE_ID} .oc-top {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 1rem;
        margin-bottom: 1.5rem;
        flex-wrap: wrap;
      }
      #${PAGE_ID} h1 {
        margin: 0;
        font-size: 1.5rem;
        font-weight: 600;
      }
      #${PAGE_ID} .oc-sub {
        margin: 0.35rem 0 0;
        color: var(--n-slate-11, #9ca3af);
        font-size: 0.9rem;
      }
      #${PAGE_ID} .oc-actions { display: flex; gap: 0.5rem; flex-wrap: wrap; }
      #${PAGE_ID} button, #${PAGE_ID} .oc-btn {
        border: 0;
        border-radius: 0.5rem;
        padding: 0.55rem 0.9rem;
        font-weight: 600;
        cursor: pointer;
        font: inherit;
        text-decoration: none;
        display: inline-flex;
        align-items: center;
      }
      #${PAGE_ID} .oc-primary { background: #0F766E; color: #fff; }
      #${PAGE_ID} .oc-secondary {
        background: var(--n-alpha-2, rgba(255,255,255,0.08));
        color: var(--n-slate-12, #f3f4f6);
      }
      #${PAGE_ID} .oc-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
        gap: 0.75rem;
        margin-bottom: 1.5rem;
      }
      #${PAGE_ID} .oc-card {
        border: 1px solid var(--n-weak, rgba(255,255,255,0.1));
        background: var(--n-solid-2, #16181d);
        border-radius: 0.85rem;
        padding: 0.9rem 1rem;
      }
      #${PAGE_ID} .oc-card h3 {
        margin: 0 0 0.35rem;
        font-size: 0.8rem;
        font-weight: 600;
        color: var(--n-slate-11, #9ca3af);
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      #${PAGE_ID} .oc-card .oc-val {
        font-size: 1rem;
        font-weight: 600;
      }
      #${PAGE_ID} .ok { color: #5eead4; }
      #${PAGE_ID} .bad { color: #f87171; }
      #${PAGE_ID} .warn { color: #fbbf24; }
      #${PAGE_ID} .oc-issues {
        border: 1px solid rgba(248,113,113,0.35);
        background: rgba(248,113,113,0.08);
        border-radius: 0.75rem;
        padding: 0.9rem 1rem;
        margin-bottom: 1.25rem;
      }
      #${PAGE_ID} .oc-issues h2 { margin: 0 0 0.5rem; font-size: 0.95rem; }
      #${PAGE_ID} .oc-issues ul { margin: 0; padding-left: 1.1rem; color: #fecaca; }
      #${PAGE_ID} .oc-train {
        display: grid;
        grid-template-columns: 200px 1fr;
        gap: 1rem;
        min-height: 420px;
      }
      @media (max-width: 800px) {
        #${PAGE_ID} .oc-train { grid-template-columns: 1fr; }
      }
      #${PAGE_ID} .oc-files {
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
      }
      #${PAGE_ID} .oc-file {
        text-align: left;
        background: transparent;
        border: 1px solid transparent;
        color: var(--n-slate-11, #9ca3af);
        border-radius: 0.5rem;
        padding: 0.55rem 0.7rem;
      }
      #${PAGE_ID} .oc-file.active {
        background: var(--n-solid-2, #16181d);
        border-color: var(--n-weak, rgba(255,255,255,0.12));
        color: var(--n-slate-12, #f3f4f6);
      }
      #${PAGE_ID} .oc-editor-wrap {
        border: 1px solid var(--n-weak, rgba(255,255,255,0.1));
        background: var(--n-solid-2, #16181d);
        border-radius: 0.85rem;
        padding: 1rem;
        display: flex;
        flex-direction: column;
        min-height: 420px;
      }
      #${PAGE_ID} .oc-editor-wrap label {
        font-size: 0.8rem;
        color: var(--n-slate-11, #9ca3af);
        margin-bottom: 0.5rem;
      }
      #${PAGE_ID} textarea {
        flex: 1;
        width: 100%;
        min-height: 320px;
        box-sizing: border-box;
        resize: vertical;
        background: var(--n-solid-1, #0f1115);
        color: var(--n-slate-12, #f3f4f6);
        border: 1px solid var(--n-weak, rgba(255,255,255,0.1));
        border-radius: 0.5rem;
        padding: 0.75rem;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 0.85rem;
        line-height: 1.45;
      }
      #${PAGE_ID} .oc-editor-actions {
        display: flex;
        gap: 0.5rem;
        margin-top: 0.75rem;
        align-items: center;
        flex-wrap: wrap;
      }
      #${PAGE_ID} .oc-hint {
        font-size: 0.8rem;
        color: var(--n-slate-11, #9ca3af);
      }
      #${NAV_ID} {
        display: block;
        width: calc(100% - 1rem);
        margin: 0.35rem 0.5rem;
        text-align: left;
        border: 1px solid var(--n-weak, rgba(255,255,255,0.1));
        background: var(--n-solid-2, #16181d);
        color: var(--n-slate-12, #f3f4f6);
        border-radius: 0.65rem;
        padding: 0.65rem 0.8rem;
        cursor: pointer;
        font: inherit;
        font-weight: 600;
        font-size: 0.85rem;
      }
      #${NAV_ID}:hover { border-color: #0F766E; }
      #${NAV_ID} small {
        display: block;
        font-weight: 400;
        color: var(--n-slate-11, #9ca3af);
        margin-top: 0.15rem;
      }
    `;
    document.head.appendChild(style);
  }

  function goToAgentPage() {
    const id = accountId();
    if (!id) return;
    const url = `/app/accounts/${id}/settings/openclaw`;
    window.history.pushState({}, '', url);
    renderPage();
  }

  function leavePage() {
    const id = accountId();
    dirty = false;
    const page = document.getElementById(PAGE_ID);
    if (page) page.remove();
    if (statusTimer) {
      clearInterval(statusTimer);
      statusTimer = null;
    }
    window.location.assign(`/app/accounts/${id}/settings/inboxes/list`);
  }

  function injectNav() {
    if (document.getElementById(NAV_ID)) return;
    ensureStyles();
    const btn = document.createElement('button');
    btn.id = NAV_ID;
    btn.type = 'button';
    btn.innerHTML = `OpenClaw Agent<small>Status check &amp; train persona</small>`;
    btn.addEventListener('click', goToAgentPage);

    const settingsNav =
      document.querySelector('nav') ||
      document.querySelector('[class*="sidebar"]') ||
      document.querySelector('aside');
    if (settingsNav) {
      settingsNav.appendChild(btn);
    } else {
      // Floating fallback
      btn.style.position = 'fixed';
      btn.style.right = '1rem';
      btn.style.bottom = '1rem';
      btn.style.zIndex = '70';
      btn.style.width = 'auto';
      document.body.appendChild(btn);
    }
  }

  function pill(ok, labelOk, labelBad) {
    return ok
      ? `<span class="ok">${labelOk}</span>`
      : `<span class="bad">${labelBad}</span>`;
  }

  async function loadStatus(root) {
    const statusEl = root.querySelector('[data-status]');
    if (!statusEl.dataset.loaded) {
      statusEl.innerHTML = `<div class="oc-hint">Checking OpenClaw…</div>`;
    }
    try {
      const data = await api('GET', 'openclaw_status');
      const ready = data.gateway?.ready;
      const readyOk = ready && ready.ready !== false && !ready.error;
      const issues = data.issues || [];
      statusEl.dataset.loaded = '1';
      statusEl.innerHTML = `
        <div class="oc-grid">
          <div class="oc-card"><h3>Overall</h3><div class="oc-val">${pill(data.ok, 'Healthy', 'Needs attention')}</div></div>
          <div class="oc-card"><h3>Gateway</h3><div class="oc-val">${pill(data.gateway?.live, 'Live', 'Down')}</div></div>
          <div class="oc-card"><h3>Ready</h3><div class="oc-val">${pill(readyOk, 'Ready', ready?.failing?.join(', ') || 'Not ready')}</div></div>
          <div class="oc-card"><h3>Bridge</h3><div class="oc-val">${pill(data.bridge?.ok, 'OK', 'Down')}</div></div>
          <div class="oc-card"><h3>Discord</h3><div class="oc-val">${
            data.discord?.enabled && data.discord?.hasToken
              ? '<span class="warn">Token set — check intents / guilds</span>'
              : data.discord?.enabled
                ? '<span class="warn">Enabled — add a bot token</span>'
                : '<span class="warn">Not connected</span>'
          }</div></div>
          <div class="oc-card"><h3>Model</h3><div class="oc-val">${
            data.discord?.model?.primary || data.discord?.model || '—'
          }</div></div>
        </div>
        ${
          issues.length
            ? `<div class="oc-issues"><h2>Fix these next</h2><ul>${issues
                .map(i => `<li>${i}</li>`)
                .join('')}</ul></div>`
            : `<p class="oc-hint">OpenClaw looks reachable. Train the agent below, then message a connected channel.</p>`
        }
        <p class="oc-hint">Control UI: <a class="oc-btn oc-secondary" href="${data.controlUi || 'http://127.0.0.1:18789/'}" target="_blank" rel="noreferrer">Open OpenClaw UI</a></p>
      `;
    } catch (err) {
      statusEl.dataset.loaded = '1';
      statusEl.innerHTML = `<div class="oc-issues"><h2>Status check failed</h2><ul><li>${err.message}</li></ul></div>`;
    }
  }

  async function loadFile(root, name) {
    activeFile = name;
    dirty = false;
    root.querySelectorAll('.oc-file').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-file') === name);
    });
    const help = root.querySelector('[data-file-help]');
    const area = root.querySelector('[data-editor]');
    const meta = root.querySelector('[data-file-meta]');
    help.textContent = FILE_HELP[name] || '';
    area.value = 'Loading…';
    area.disabled = true;
    try {
      const data = await api('GET', `openclaw_workspace/${encodeURIComponent(name)}`);
      area.value = data.content || '';
      meta.textContent = data.updatedAt ? `Updated ${new Date(data.updatedAt).toLocaleString()}` : 'New file';
    } catch (err) {
      if (/not_found/i.test(err.message)) {
        area.value = '';
        meta.textContent = 'File does not exist yet — save to create it';
      } else {
        area.value = '';
        meta.textContent = err.message;
      }
    }
    area.disabled = false;
  }

  async function saveFile(root) {
    const area = root.querySelector('[data-editor]');
    const meta = root.querySelector('[data-file-meta]');
    meta.textContent = 'Saving…';
    try {
      const data = await api('PUT', `openclaw_workspace/${encodeURIComponent(activeFile)}`, {
        content: area.value,
      });
      dirty = false;
      meta.textContent = `Saved ${new Date(data.updatedAt || Date.now()).toLocaleString()}`;
    } catch (err) {
      meta.textContent = err.message;
    }
  }

  function renderPage() {
    ensureStyles();
    let page = document.getElementById(PAGE_ID);
    if (page) return; // already mounted — do not rebuild (was causing blink)

    page = document.createElement('div');
    page.id = PAGE_ID;
    document.body.appendChild(page);
    page.innerHTML = `
      <div class="oc-shell">
        <div class="oc-top">
          <div>
            <h1>OpenClaw Agent</h1>
            <p class="oc-sub">Check whether OpenClaw is working, then train its persona for Chatwoot replies.</p>
          </div>
          <div class="oc-actions">
            <button type="button" class="oc-secondary" data-action="refresh">Refresh status</button>
            <button type="button" class="oc-secondary" data-action="close">Back to Chatwoot</button>
          </div>
        </div>
        <div data-status></div>
        <h2 style="font-size:1.1rem;margin:1.5rem 0 0.75rem;">Train agent</h2>
        <p class="oc-sub" style="margin-bottom:1rem;">Edits go to the OpenClaw workspace files used on every reply.</p>
        <div class="oc-train">
          <div class="oc-files" data-files></div>
          <div class="oc-editor-wrap">
            <label data-file-help></label>
            <textarea data-editor spellcheck="false"></textarea>
            <div class="oc-editor-actions">
              <button type="button" class="oc-primary" data-action="save">Save training</button>
              <span class="oc-hint" data-file-meta></span>
            </div>
          </div>
        </div>
      </div>`;

    const filesEl = page.querySelector('[data-files]');
    FILES.forEach(name => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'oc-file';
      btn.setAttribute('data-file', name);
      btn.textContent = name;
      btn.addEventListener('click', () => {
        if (dirty && !window.confirm('Discard unsaved changes?')) return;
        loadFile(page, name);
      });
      filesEl.appendChild(btn);
    });

    page.querySelector('[data-action="refresh"]').onclick = () => loadStatus(page);
    page.querySelector('[data-action="close"]').onclick = leavePage;
    page.querySelector('[data-action="save"]').onclick = () => saveFile(page);
    page.querySelector('[data-editor]').addEventListener('input', () => {
      dirty = true;
    });

    loadStatus(page);
    loadFile(page, activeFile);
    if (statusTimer) clearInterval(statusTimer);
    statusTimer = setInterval(() => {
      if (document.getElementById(PAGE_ID)) loadStatus(page);
    }, 20000);
  }

  function tick() {
    injectNav();
    if (isAgentPage()) {
      renderPage();
      return;
    }
    const page = document.getElementById(PAGE_ID);
    if (page && !/openclaw/i.test(window.location.pathname + window.location.search)) {
      page.remove();
      if (statusTimer) {
        clearInterval(statusTimer);
        statusTimer = null;
      }
    }
  }

  tick();
  setInterval(tick, 2000);
  window.addEventListener('popstate', tick);
})();
