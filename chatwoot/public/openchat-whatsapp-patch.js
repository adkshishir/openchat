/**
 * Runtime WhatsApp provider patch for Hub Chatwoot images that still serve
 * prebuilt dashboard JS. Adds an OpenClaw (QR) option beside Cloud / Twilio.
 */
(function openchatWhatsappPatch() {
  const STYLE_ID = 'openchat-wa-patch-style';
  const CARD_ID = 'openchat-wa-openclaw-card';
  const PANEL_ID = 'openchat-wa-openclaw-panel';

  function accountId() {
    const match = window.location.pathname.match(/\/accounts\/(\d+)\//);
    return match ? match[1] : null;
  }

  function isWhatsappSetupPage() {
    return /\/settings\/inboxes\/new\/whatsapp\/?$/.test(window.location.pathname);
  }

  function provider() {
    return new URLSearchParams(window.location.search).get('provider');
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

  // Chatwoot dashboard APIs use devise-token-auth headers from cw_d_session_info.
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
      // fall through with CSRF only
    }
    return headers;
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${CARD_ID}, #${PANEL_ID} {
        font-family: inherit;
      }
      #${CARD_ID} {
        position: relative;
        background: var(--n-solid-1, #1f232a);
        gap: 1.5rem;
        cursor: pointer;
        border-radius: 1rem;
        display: flex;
        flex-direction: column;
        justify-content: flex-start;
        transition: all 0.2s ease;
        margin: -1px;
        padding: 1.5rem 1.25rem;
        align-items: flex-start;
        border: 1px solid var(--n-weak, rgba(255,255,255,0.08));
        text-align: left;
        max-width: 220px;
        min-width: 200px;
        color: inherit;
        font: inherit;
      }
      #${CARD_ID}:hover {
        border-color: var(--n-blue-9, #3b82f6);
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
      }
      #${CARD_ID} .oc-icon {
        width: 2.5rem;
        height: 2.5rem;
        border-radius: 9999px;
        background: var(--n-alpha-2, rgba(255,255,255,0.06));
        color: #5eead4;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.25rem;
      }
      #${CARD_ID} h3 {
        margin: 0;
        font-size: 0.875rem;
        font-weight: 600;
        color: var(--n-slate-12, #f3f4f6);
      }
      #${CARD_ID} p {
        margin: 0.35rem 0 0;
        font-size: 0.875rem;
        color: var(--n-slate-11, #9ca3af);
      }
      #${CARD_ID} .oc-badge {
        position: absolute;
        top: 0.75rem;
        right: 0.75rem;
        background: rgba(15, 118, 110, 0.25);
        color: #5eead4;
        font-size: 0.65rem;
        font-weight: 600;
        letter-spacing: 0.02em;
        border-radius: 9999px;
        padding: 0.15rem 0.45rem;
        text-transform: uppercase;
      }
      #${PANEL_ID} {
        position: fixed;
        inset: 0;
        z-index: 9999;
        background: rgba(0, 0, 0, 0.55);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 1.5rem;
      }
      #${PANEL_ID} .oc-modal {
        width: min(520px, 100%);
        background: var(--n-solid-2, #16181d);
        color: var(--n-slate-12, #f3f4f6);
        border: 1px solid var(--n-weak, rgba(255,255,255,0.1));
        border-radius: 1rem;
        padding: 1.5rem;
        box-shadow: 0 20px 50px rgba(0,0,0,0.45);
        max-height: 90vh;
        overflow: auto;
      }
      #${PANEL_ID} h2 {
        margin: 0 0 0.5rem;
        font-size: 1.25rem;
        color: var(--n-slate-12, #f3f4f6);
      }
      #${PANEL_ID} .oc-copy {
        color: var(--n-slate-11, #9ca3af);
        font-size: 0.9rem;
        line-height: 1.5;
        margin-bottom: 1rem;
      }
      #${PANEL_ID} .oc-actions {
        display: flex;
        gap: 0.75rem;
        flex-wrap: wrap;
        margin-bottom: 1rem;
      }
      #${PANEL_ID} button {
        border: 0;
        border-radius: 0.5rem;
        padding: 0.65rem 1rem;
        font-weight: 600;
        cursor: pointer;
      }
      #${PANEL_ID} .oc-primary {
        background: #0F766E;
        color: #fff;
      }
      #${PANEL_ID} .oc-secondary {
        background: var(--n-alpha-2, rgba(255,255,255,0.08));
        color: var(--n-slate-12, #f3f4f6);
      }
      #${PANEL_ID} img {
        width: 16rem;
        height: 16rem;
        border: 1px solid var(--n-weak, rgba(255,255,255,0.12));
        border-radius: 0.75rem;
        background: #fff;
      }
      #${PANEL_ID} .oc-status {
        margin-top: 0.75rem;
        font-size: 0.9rem;
        color: var(--n-slate-11, #d1d5db);
      }
      #${PANEL_ID} .oc-error {
        color: #f87171;
        font-size: 0.875rem;
        margin-top: 0.5rem;
      }
    `;
    document.head.appendChild(style);
  }

  function findProviderRow() {
    const headings = Array.from(document.querySelectorAll('h1, h2'));
    const title = headings.find(el => /select your api provider|select your whatsapp/i.test(el.textContent || ''));
    if (!title) return null;
    let node = title.parentElement;
    while (node && node !== document.body) {
      const buttons = Array.from(node.querySelectorAll('button')).filter(btn =>
        /whatsapp cloud|twilio/i.test(btn.textContent || '')
      );
      if (buttons.length >= 2) {
        return buttons[0].parentElement;
      }
      node = node.parentElement;
    }
    return null;
  }

  function injectCard() {
    if (provider()) return;
    if (document.getElementById(CARD_ID)) return;
    const row = findProviderRow();
    if (!row) return;

    ensureStyles();
    const card = document.createElement('button');
    card.id = CARD_ID;
    card.type = 'button';
    card.innerHTML = `
      <span class="oc-badge">Recommended</span>
      <div class="oc-icon">▦</div>
      <div>
        <h3>OpenClaw (QR code)</h3>
        <p>Scan a QR code from WhatsApp — same as OpenClaw login</p>
      </div>
    `;
    card.addEventListener('click', () => {
      const url = new URL(window.location.href);
      url.searchParams.set('provider', 'openclaw');
      window.history.pushState({}, '', url.toString());
      openPanel();
    });
    row.insertBefore(card, row.firstChild);
  }

  let setupSocket = null;
  let linkingInProgress = false;

  function bridgeWsUrl(accountId, force) {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // Bridge runs on host :8090 (see local-dev-services). Browser talks to it directly.
    const host = window.location.hostname || 'localhost';
    const forceQ = force ? '1' : '0';
    return `${proto}//${host}:8090/tenants/${accountId}/channels/whatsapp/setup/stream?force=${forceQ}`;
  }

  function closeSetupSocket() {
    if (setupSocket) {
      try {
        setupSocket.close();
      } catch (_) {
        /* ignore */
      }
      setupSocket = null;
    }
  }

  function closePanel() {
    closeSetupSocket();
    linkingInProgress = false;
    const panel = document.getElementById(PANEL_ID);
    if (panel) panel.remove();
    const url = new URL(window.location.href);
    url.searchParams.delete('provider');
    window.history.replaceState({}, '', url.toString());
  }

  async function api(method, path, body) {
    const id = accountId();
    const headers = authHeaders();
    const opts = {
      method,
      credentials: 'include',
      headers,
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
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

  function openPanel() {
    if (document.getElementById(PANEL_ID)) return;
    ensureStyles();

    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div class="oc-modal">
        <h2>Connect with OpenClaw</h2>
        <p class="oc-copy">
          Scan the QR code from WhatsApp on your phone — same flow as OpenClaw.
          Keep this window open while the phone shows Verifying.
        </p>
        <ol class="oc-copy" style="padding-left:1.25rem;margin-top:0;">
          <li>Click Show QR code</li>
          <li>WhatsApp → Linked devices → Link a device</li>
          <li>Scan once — wait through Verifying (do not close)</li>
        </ol>
        <div class="oc-actions">
          <button type="button" class="oc-primary" data-action="start">Show QR code</button>
          <button type="button" class="oc-secondary" data-action="close">Close</button>
        </div>
        <div data-qr></div>
        <div class="oc-status" data-status></div>
        <div class="oc-error" data-error></div>
      </div>
    `;
    document.body.appendChild(panel);

    const statusEl = panel.querySelector('[data-status]');
    const errorEl = panel.querySelector('[data-error]');
    const qrEl = panel.querySelector('[data-qr]');
    const startBtn = panel.querySelector('[data-action="start"]');

    panel.querySelector('[data-action="close"]').addEventListener('click', closePanel);
    panel.addEventListener('click', event => {
      if (event.target === panel) closePanel();
    });

    function setQrImage(dataUrl) {
      if (!dataUrl) return;
      qrEl.innerHTML = `<img src="${dataUrl}" alt="WhatsApp QR code" />`;
    }

    async function onConnected(payload) {
      linkingInProgress = false;
      statusEl.textContent = payload.message || 'WhatsApp linked. Creating inbox…';
      startBtn.disabled = false;
      startBtn.textContent = 'Regenerate QR';
      closeSetupSocket();
      try {
        const finalized = await api('POST', 'whatsapp_finalize', {});
        const id = accountId();
        const inboxId = finalized.inbox_id || payload.inbox_id;
        statusEl.textContent = 'WhatsApp linked. Opening inbox setup…';
        if (inboxId) {
          window.location.assign(`/app/accounts/${id}/settings/inboxes/new/${inboxId}/finish`);
        } else {
          statusEl.textContent = 'Connected. Refresh Inboxes if the new WhatsApp inbox is not listed yet.';
        }
      } catch (error) {
        errorEl.textContent = error.message || 'Linked, but inbox setup failed. Refresh Inboxes.';
      }
    }

    async function startSocketStream() {
      const id = accountId();
      if (!id) {
        errorEl.textContent = 'Missing account id.';
        return;
      }
      closeSetupSocket();
      errorEl.textContent = '';
      statusEl.textContent = 'Opening live link to OpenClaw…';
      qrEl.innerHTML = '';
      linkingInProgress = true;
      startBtn.disabled = true;
      startBtn.textContent = 'Linking…';

      // The bridge's WhatsApp setup WebSocket is the one surface the browser talks
      // to directly (not proxied through this Rails controller) — use the bridge's
      // own tenant UUID here, not Chatwoot's guessable sequential account id.
      let tenantId;
      try {
        ({ tenant_id: tenantId } = await api('GET', 'bridge_tenant_id'));
      } catch (error) {
        linkingInProgress = false;
        startBtn.disabled = false;
        startBtn.textContent = 'Start';
        errorEl.textContent = error.message || 'Could not resolve tenant.';
        return;
      }
      if (!tenantId) {
        linkingInProgress = false;
        startBtn.disabled = false;
        startBtn.textContent = 'Start';
        errorEl.textContent = 'Tenant not provisioned yet — try again in a moment.';
        return;
      }

      const ws = new WebSocket(bridgeWsUrl(tenantId, true));
      setupSocket = ws;

      let finishedOk = false;

      ws.onmessage = event => {
        let data = {};
        try {
          data = JSON.parse(event.data);
        } catch (_) {
          return;
        }
        if (data.qr_data_url) setQrImage(data.qr_data_url);
        if (data.type === 'qr') {
          statusEl.textContent =
            data.message || 'Waiting for scan… keep this window open through Verifying.';
        } else if (data.type === 'status' || data.type === 'hello') {
          statusEl.textContent = data.message || statusEl.textContent;
        } else if (data.type === 'connected') {
          finishedOk = true;
          onConnected(data);
        } else if (data.type === 'expired' || data.type === 'error') {
          finishedOk = true;
          linkingInProgress = false;
          statusEl.textContent = '';
          errorEl.textContent = data.message || 'WhatsApp login failed.';
          startBtn.disabled = false;
          startBtn.textContent = 'Regenerate QR';
          closeSetupSocket();
        }
      };

      ws.onerror = () => {
        if (!linkingInProgress || finishedOk) return;
        errorEl.textContent =
          'Could not reach OpenChat bridge WebSocket on :8090. Is the bridge running?';
      };

      ws.onclose = () => {
        if (setupSocket === ws) setupSocket = null;
        if (linkingInProgress && !finishedOk) {
          linkingInProgress = false;
          startBtn.disabled = false;
          startBtn.textContent = 'Regenerate QR';
          if (!errorEl.textContent) {
            errorEl.textContent = 'Link socket closed before WhatsApp finished. Click Regenerate QR.';
          }
        }
      };
    }

    startBtn.addEventListener('click', () => {
      if (linkingInProgress) {
        statusEl.textContent =
          'Linking in progress — scan the QR and wait through Verifying on your phone.';
        return;
      }
      startSocketStream();
    });
  }

  function tick() {
    if (!isWhatsappSetupPage()) {
      const panel = document.getElementById(PANEL_ID);
      if (panel && provider() !== 'openclaw') return;
      return;
    }
    // Do not auto-open the modal — it polls wait/start and can kill a live QR handshake.
    // User must click the OpenChat card / Show QR intentionally.
    if (provider() === 'openclaw') {
      injectCard();
      return;
    }
    injectCard();
  }

  ensureStyles();
  tick();
  setInterval(tick, 800);
  window.addEventListener('popstate', tick);
})();
