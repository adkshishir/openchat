<script>
import OpenchatAPI from 'dashboard/api/openchat';

// Lucide has no brand-mark icons for these services, so each channel gets a
// distinct generic glyph rather than a lookalike logo — consistent with how
// the rest of the dashboard nav (Sidebar.vue) assigns one lucide icon per item.
const CHANNEL_ICONS = {
  web_widget: 'i-lucide-globe',
  whatsapp: 'i-lucide-qr-code',
  whatsapp_cloud: 'i-lucide-message-circle',
  whatsapp_360dialog: 'i-lucide-message-circle',
  telegram: 'i-lucide-send',
  discord: 'i-lucide-gamepad-2',
  slack: 'i-lucide-hash',
  signal: 'i-lucide-shield-check',
  googlechat: 'i-lucide-message-square',
  matrix: 'i-lucide-network',
  line: 'i-lucide-circle-dot',
  irc: 'i-lucide-terminal',
  mattermost: 'i-lucide-layout-grid',
  feishu: 'i-lucide-cloud',
  msteams: 'i-lucide-users',
};
const DEFAULT_ICON = 'i-lucide-radio';

export default {
  props: {
    // Lets a row hand the copilot input a ready-to-send prompt instead of
    // owning its own request — the channel actually gets connected through
    // the same tool-calling conversation, this panel is just the entry point.
    onRequestConnect: {
      type: Function,
      required: true,
    },
  },
  emits: ['loaded'],
  data() {
    return {
      catalog: [],
      linkedTypes: new Set(),
      isLoading: false,
    };
  },
  mounted() {
    this.fetchChannels();
  },
  methods: {
    async fetchChannels() {
      this.isLoading = true;
      try {
        const { data } = await OpenchatAPI.getChannels();
        this.catalog = data.catalog || [];
        this.linkedTypes = new Set((data.linked || []).map(l => l.channel_type));
        this.$emit('loaded', { connectedCount: this.linkedTypes.size, total: this.catalog.length });
      } catch {
        this.catalog = [];
      } finally {
        this.isLoading = false;
      }
    },
    iconFor(channelId) {
      return CHANNEL_ICONS[channelId] || DEFAULT_ICON;
    },
    isConnected(channelId) {
      return this.linkedTypes.has(channelId);
    },
    connect(channel) {
      this.onRequestConnect(`Connect ${channel.label}`);
    },
  },
};
</script>

<template>
  <div class="flex flex-col gap-1 py-2">
    <button
      v-for="channel in catalog"
      :key="channel.id"
      class="group flex items-center gap-3 px-4 py-2.5 text-start rounded-lg mx-2 hover:bg-n-alpha-2 disabled:cursor-default disabled:hover:bg-transparent"
      :disabled="isConnected(channel.id)"
      @click="!isConnected(channel.id) && connect(channel)"
    >
      <span
        class="flex items-center justify-center size-8 rounded-lg shrink-0"
        :class="isConnected(channel.id) ? 'bg-n-teal-3 text-n-teal-11' : 'bg-n-alpha-2 text-n-slate-11'"
      >
        <span :class="iconFor(channel.id)" class="size-4" />
      </span>
      <span class="flex-1 min-w-0">
        <span class="block text-sm font-medium text-n-slate-12 leading-snug">
          {{ channel.label }}
        </span>
        <span
          class="block text-xs"
          :class="isConnected(channel.id) ? 'text-n-teal-11' : 'text-n-slate-10 group-hover:text-n-slate-11'"
        >
          {{ isConnected(channel.id) ? 'Connected' : 'Tap to connect' }}
        </span>
      </span>
      <span
        v-if="isConnected(channel.id)"
        class="size-1.5 rounded-full bg-n-teal-9 shrink-0"
      />
    </button>
  </div>
</template>
