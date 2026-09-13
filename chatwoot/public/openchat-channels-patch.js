/**
 * OpenClaw multi-channel connector for Hub Chatwoot.
 * Channel cards live in the native Choose Channel list (dashboard bundle).
 * This script only renders the connect form on /settings/inboxes/new/:channel
 * when the Vue ChannelFactory does not already handle that channel.
 */
(function openchatChannelsPatch() {
  const STYLE_ID = 'openchat-channels-patch-style';
  const PANEL_ID = 'openchat-channel-panel';
  const INLINE_ID = 'openchat-channel-setup';
  const NATIVE_MARKER = '[data-openchat-native-channel-setup]';
  const OPENCLAW_CHANNELS = new Set([
    'discord',
    'slack',
    'signal',
    'googlechat',
    'matrix',
    'irc',
    'mattermost',
    'feishu',
    'msteams',
  ]);

  let catalogCache = null;
  let catalogPromise = null;

  function accountId() {
    const match = window.location.pathname.match(/\/accounts\/(\d+)\//);
    return match ? match[1] : null;
  }

  function channelFromPath() {
    const match = window.location.pathname.match(
      /\/settings\/inboxes\/new\/([a-z0-9_]+)\/?$/i
    );
    if (!match) return null;
    const key = match[1].toLowerCase();
    return OPENCLAW_CHANNELS.has(key) ? key : null;
  }

  function isInboxNewChooser() {
    return /\/settings\/inboxes\/new\/?$/.test(window.location.pathname);
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
    const headers = authHeaders();
    const opts = { method, credentials: 'include', headers };
    if (body !== undefined) {
      opts.body = JSON.stringify(body);
    }
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

  async function loadCatalog() {
    if (catalogCache) return catalogCache;
    if (catalogPromise) return catalogPromise;
    catalogPromise = api('GET', 'channels')
      .then(data => {
        catalogCache = data.catalog || [];
        return catalogCache;
      })
      .catch(err => {
        catalogPromise = null;
        throw err;
      });
    return catalogPromise;
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${INLINE_ID} {
        box-sizing: border-box;
        width: 100%;
        max-width: 36rem;
        margin: 0;
        padding: 0;
        font-family: inherit;
        color: var(--n-slate-12, #f3f4f6);
      }
      #${INLINE_ID} h2 {
        margin: 0 0 0.5rem;
        font-size: 1.25rem;
        font-weight: 600;
        color: var(--n-slate-12, #f3f4f6);
      }
      #${INLINE_ID} .oc-copy {
        color: var(--n-slate-11, #9ca3af);
        font-size: 0.9rem;
        line-height: 1.5;
        margin: 0 0 1.25rem;
      }
      #${INLINE_ID} label {
        display: block;
        font-size: 0.8rem;
        font-weight: 600;
        margin: 0.85rem 0 0.35rem;
        color: var(--n-slate-12, #e5e7eb);
      }
      #${INLINE_ID} input {
        width: 100%;
        box-sizing: border-box;
        border: 1px solid var(--n-weak, rgba(255,255,255,0.12));
        border-radius: 0.5rem;
        padding: 0.6rem 0.75rem;
        font-size: 0.9rem;
        background: var(--n-solid-1, #1f232a);
        color: var(--n-slate-12, #f3f4f6);
      }
      #${INLINE_ID} input::placeholder { color: var(--n-slate-10, #6b7280); }
      #${INLINE_ID} .oc-help {
        font-size: 0.75rem;
        color: var(--n-slate-11, #9ca3af);
        margin-top: 0.25rem;
      }
      #${INLINE_ID} .oc-actions {
        display: flex;
        gap: 0.75rem;
        margin-top: 1.5rem;
        flex-wrap: wrap;
      }
      #${INLINE_ID} button {
        border: 0;
        border-radius: 0.5rem;
        padding: 0.65rem 1rem;
        font-weight: 600;
        cursor: pointer;
      }
      #${INLINE_ID} .oc-primary { background: #0F766E; color: #fff; }
      #${INLINE_ID} .oc-secondary {
        background: var(--n-alpha-2, rgba(255,255,255,0.08));
        color: var(--n-slate-12, #f3f4f6);
      }
      #${INLINE_ID} .oc-status {
        margin-top: 0.75rem;
        font-size: 0.9rem;
        color: var(--n-slate-11, #d1d5db);
      }
      #${INLINE_ID} .oc-error {
        color: #f87171;
        font-size: 0.875rem;
        margin-top: 0.5rem;
      }
      #${PANEL_ID} { display: none !important; }
    `;
    document.head.appendChild(style);
  }

  function cleanupLegacy() {
    const hub = document.getElementById('openchat-channels-hub');
    if (hub) hub.remove();
    document.querySelectorAll('[data-openchat-channel]').forEach(el => el.remove());
    const panel = document.getElementById(PANEL_ID);
    if (panel) panel.remove();
  }

  /** Same shell as Telegram/API: right column of the inbox wizard. */
  function findWizardContentCol() {
    const wizard = Array.from(document.querySelectorAll('div.grid')).find(g =>
      /lg:grid-cols-8|grid-cols-8/.test(g.className || '')
    );
    if (wizard) {
      const col = Array.from(wizard.children).find(child =>
        /col-span-6/.test(child.className || '')
      );
      if (col) return col;
    }

    // Fallback: content area that sits beside the stepper, not page chrome.
    const steppers = Array.from(document.querySelectorAll('div')).filter(el =>
      /col-span-2/.test(el.className || '') && /Create|Channel|Inbox|Agent/i.test(el.textContent || '')
    );
    for (const step of steppers) {
      const parent = step.parentElement;
      if (!parent) continue;
      const sibling = Array.from(parent.children).find(
        child => child !== step && /col-span-6|overflow/.test(child.className || '')
      );
      if (sibling) return sibling;
    }
    return null;
  }

  function backToChooser() {
    window.location.assign(`/app/accounts/${accountId()}/settings/inboxes/new`);
  }

  async function renderSetup(channelId) {
    // Vue ChannelFactory already owns this channel — do not double-inject.
    if (document.querySelector(NATIVE_MARKER)) {
      const legacy = document.getElementById(INLINE_ID);
      if (legacy) legacy.remove();
      return;
    }

    ensureStyles();
    cleanupLegacy();

    let channel;
    try {
      const catalog = await loadCatalog();
      channel = catalog.find(c => c.id === channelId);
    } catch (err) {
      console.warn('[OpenChat] catalog', err);
    }
    if (!channel) {
      channel = {
        id: channelId,
        label: channelId,
        description: 'Connect this channel through OpenClaw.',
        fields: [],
      };
    }

    if (document.querySelector(NATIVE_MARKER)) {
      const legacy = document.getElementById(INLINE_ID);
      if (legacy) legacy.remove();
      return;
    }

    const existing = document.getElementById(INLINE_ID);
    if (existing) {
      if (existing.getAttribute('data-channel') === channelId) return;
      existing.remove();
    }

    const contentCol = findWizardContentCol();
    if (!contentCol) return;

    const fieldsHtml = (channel.fields || [])
      .map(
        f => `
        <label for="oc-${f.key}">${f.label}${f.optional ? ' (optional)' : ''}</label>
        <input id="oc-${f.key}" data-key="${f.key}" type="${f.secret ? 'password' : 'text'}"
          placeholder="${f.placeholder || ''}" autocomplete="off" />
        ${f.help ? `<div class="oc-help">${f.help}</div>` : ''}`
      )
      .join('');

    const shell = document.createElement('div');
    shell.className = 'h-full w-full p-6 col-span-6';
    shell.setAttribute('data-openchat-channel-shell', '1');

    const wrap = document.createElement('div');
    wrap.id = INLINE_ID;
    wrap.setAttribute('data-channel', channelId);
    wrap.innerHTML = `
      <h2>${channel.label} via OpenClaw</h2>
      <p class="oc-copy">${channel.description || ''}</p>
      <form data-form>
        ${fieldsHtml || '<p class="oc-copy">No extra fields required.</p>'}
        <div class="oc-actions">
          <button type="submit" class="oc-primary">Connect</button>
          <button type="button" class="oc-secondary" data-action="back">Back</button>
        </div>
      </form>
      <div class="oc-status" data-status></div>
      <div class="oc-error" data-error></div>`;

    shell.appendChild(wrap);

    // Clear stale patch shells; keep Vue router-view if present.
    contentCol.querySelectorAll('[data-openchat-channel-shell]').forEach(el => el.remove());
    contentCol.appendChild(shell);

    wrap.querySelector('[data-action="back"]').onclick = backToChooser;

    const statusEl = wrap.querySelector('[data-status]');
    const errorEl = wrap.querySelector('[data-error]');
    const form = wrap.querySelector('[data-form]');

    form.addEventListener('submit', async e => {
      e.preventDefault();
      errorEl.textContent = '';
      statusEl.textContent = `Connecting ${channel.label} to OpenClaw…`;
      const fields = {};
      form.querySelectorAll('input[data-key]').forEach(input => {
        fields[input.getAttribute('data-key')] = input.value;
      });
      try {
        const data = await api('POST', 'channel_connect', {
          channel: channel.id,
          fields,
          label: channel.label,
        });
        statusEl.textContent = data.message || 'Connected.';
        let inboxId = data.inbox_id;
        if (!inboxId) {
          const fin = await api('POST', 'channel_finalize', {
            channel: channel.id,
            label: channel.label,
          });
          inboxId = fin.inbox_id;
        }
        if (inboxId) {
          window.location.assign(
            `/app/accounts/${accountId()}/settings/inboxes/new/${inboxId}/finish`
          );
        }
      } catch (err) {
        statusEl.textContent = '';
        errorEl.textContent = err.message || 'Connect failed';
      }
    });
  }

  function tick() {
    cleanupLegacy();
    const channelId = channelFromPath();
    if (channelId) {
      renderSetup(channelId);
      return;
    }
    const inline = document.getElementById(INLINE_ID);
    if (inline && isInboxNewChooser()) {
      inline.closest('[data-openchat-channel-shell]')?.remove();
      inline.remove();
    }
  }

  tick();
  setInterval(tick, 800);
  window.addEventListener('popstate', tick);
})();
