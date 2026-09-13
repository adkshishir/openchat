<script>
import { useAlert } from 'dashboard/composables';
import NextButton from 'dashboard/components-next/button/Button.vue';
import PageHeader from '../../../SettingsSubPageHeader.vue';
import OpenchatAPI from 'dashboard/api/openchat';
import router from '../../../../../index';

export default {
  components: { PageHeader, NextButton },
  data() {
    return {
      busy: false,
      waiting: false,
      qrDataUrl: null,
      connected: false,
      inboxId: null,
      pollTimer: null,
      errorMessage: '',
    };
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
      this.busy = true;
      this.errorMessage = '';
      this.connected = false;
      try {
        // Always force on explicit Show/Regenerate so stale logged-out creds clear.
        const { data } = await OpenchatAPI.startWhatsapp({ force: true });
        this.qrDataUrl = data.qr_data_url || null;
        this.connected = Boolean(data.connected);
        this.inboxId = data.inbox_id || null;
        this.stopPolling();
        if (!this.qrDataUrl && !this.connected) {
          this.errorMessage =
            data.message || data.error || 'No QR received. Click Regenerate QR and try again.';
          useAlert(this.errorMessage);
          return;
        }
        if (this.connected && this.inboxId) {
          this.goToAgents();
          return;
        }
        this.waiting = true;
        this.pollTimer = setInterval(this.wait, 5000);
        this.wait();
      } catch (error) {
        this.errorMessage =
          error?.response?.data?.error ||
          error.message ||
          'Could not start WhatsApp QR login.';
        useAlert(this.errorMessage);
      } finally {
        this.busy = false;
      }
    },
    async wait() {
      try {
        const { data } = await OpenchatAPI.waitWhatsapp();
        if (data.qr_data_url) {
          this.qrDataUrl = data.qr_data_url;
        }
        this.connected = Boolean(data.connected);
        this.inboxId = data.inbox_id || this.inboxId;
        if (this.connected) {
          this.stopPolling();
          this.waiting = false;
          useAlert('WhatsApp linked via OpenClaw.');
          if (this.inboxId) {
            this.goToAgents();
          }
        } else if (data.message && /expired|515|restart required|logged out/i.test(data.message)) {
          this.stopPolling();
          this.waiting = false;
          this.errorMessage = data.message;
        }
      } catch (error) {
        // Keep polling while OpenClaw waits for the phone scan.
        if (error?.response?.status && error.response.status >= 500) {
          this.errorMessage =
            error?.response?.data?.error ||
            error.message ||
            'WhatsApp login is still waiting.';
        }
      }
    },
    goToAgents() {
      if (!this.inboxId) return;
      // Current admin is already an inbox member; skip the agents step (avoids 404 on stale/missing inbox).
      router.replace({
        name: 'settings_inbox_finish',
        params: { page: 'new', inbox_id: this.inboxId },
      });
    },
  },
};
</script>

<template>
  <div class="h-full w-full">
    <PageHeader
      header-title="Connect with OpenClaw"
      header-content="Scan the QR code from WhatsApp on your phone — same flow as OpenClaw. OpenClaw keeps the WhatsApp session; OpenChat shows the shared inbox and can auto-reply."
    />
    <div class="flex flex-col gap-4 max-w-xl mt-6">
      <ol class="list-decimal ms-5 text-sm text-n-slate-11 space-y-1">
        <li>Click Show QR code</li>
        <li>Open WhatsApp → Linked devices → Link a device</li>
        <li>Scan the code — when it connects, your inbox is ready</li>
      </ol>

      <NextButton
        :is-loading="busy"
        :disabled="busy || waiting"
        :label="qrDataUrl ? 'Regenerate QR' : 'Show QR code'"
        @click="start"
      />

      <div
        v-if="qrDataUrl"
        class="flex flex-col items-start gap-3 p-4 border border-n-weak rounded-2xl bg-n-solid-1"
      >
        <img
          :src="qrDataUrl"
          alt="WhatsApp QR code"
          class="w-64 h-64 border rounded bg-white"
        />
        <p v-if="connected" class="text-green-600 text-sm font-medium">
          WhatsApp linked. Finishing inbox setup…
        </p>
        <p v-else class="text-sm text-n-slate-11">
          Waiting for scan… keep this page open.
        </p>
      </div>

      <p v-if="errorMessage" class="text-sm text-red-600">{{ errorMessage }}</p>
    </div>
  </div>
</template>
