<script>
import { useAlert } from 'dashboard/composables';
import OpenchatAPI from 'dashboard/api/openchat';

// Reuses the exact same whatsapp_start/whatsapp_wait endpoints (and the same
// live-refresh/auto-detect behavior) as the dedicated WhatsApp setup page at
// settings/inbox/channels/openchat/Whatsapp.vue — this is just that same flow
// rendered inline in the copilot chat instead of a standalone settings page.
export default {
  data() {
    return {
      qrDataUrl: null,
      connected: false,
      waiting: false,
      errorMessage: '',
      pollTimer: null,
    };
  },
  mounted() {
    this.start();
  },
  unmounted() {
    this.stopPolling();
  },
  methods: {
    stopPolling() {
      if (this.pollTimer) {
        clearInterval(this.pollTimer);
        this.pollTimer = null;
      }
    },
    async start() {
      this.errorMessage = '';
      try {
        const { data } = await OpenchatAPI.startWhatsapp({ force: true });
        this.qrDataUrl = data.qr_data_url || null;
        this.connected = Boolean(data.connected);
        if (!this.qrDataUrl && !this.connected) {
          this.errorMessage =
            data.message || data.error || 'No QR received — ask the copilot to try again.';
          return;
        }
        if (!this.connected) {
          this.waiting = true;
          this.pollTimer = setInterval(this.wait, 5000);
        }
      } catch (error) {
        this.errorMessage =
          error?.response?.data?.error || error.message || 'Could not start WhatsApp QR login.';
      }
    },
    async wait() {
      try {
        const { data } = await OpenchatAPI.waitWhatsapp();
        if (data.qr_data_url) this.qrDataUrl = data.qr_data_url;
        this.connected = Boolean(data.connected);
        if (this.connected) {
          this.stopPolling();
          this.waiting = false;
          useAlert('WhatsApp connected!');
        } else if (data.message && /expired|515|restart required|logged out/i.test(data.message)) {
          this.stopPolling();
          this.waiting = false;
          this.errorMessage = data.message;
        }
      } catch (error) {
        if (error?.response?.status && error.response.status >= 500) {
          this.errorMessage =
            error?.response?.data?.error || error.message || 'Still waiting for the scan…';
        }
      }
    },
  },
};
</script>

<template>
  <div class="flex flex-col items-start gap-2 p-4 border border-n-weak rounded-2xl bg-n-solid-1 max-w-xs">
    <img
      v-if="qrDataUrl"
      :src="qrDataUrl"
      alt="WhatsApp QR code"
      class="w-56 h-56 border rounded bg-white"
    />
    <p v-if="connected" class="text-green-600 text-sm font-medium">
      WhatsApp connected!
    </p>
    <p v-else-if="qrDataUrl" class="text-xs text-n-slate-11">
      Scan with WhatsApp → Linked devices → Link a device.
    </p>
    <p v-if="errorMessage" class="text-xs text-red-600">{{ errorMessage }}</p>
  </div>
</template>
