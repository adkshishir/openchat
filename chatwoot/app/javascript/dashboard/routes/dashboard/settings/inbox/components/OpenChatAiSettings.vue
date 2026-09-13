<script>
import OpenchatAPI from 'dashboard/api/openchat';
import SettingsToggleSection from 'dashboard/components-next/Settings/SettingsToggleSection.vue';

export default {
  components: { SettingsToggleSection },
  data() {
    return {
      aiEnabled: true,
      loaded: false,
    };
  },
  async mounted() {
    try {
      const { data } = await OpenchatAPI.getSettings();
      this.aiEnabled = data.ai_enabled !== false;
      this.loaded = true;
    } catch {
      this.loaded = true;
    }
  },
  watch: {
    aiEnabled(value) {
      if (this.loaded) {
        OpenchatAPI.updateSettings({ ai_enabled: value });
      }
    },
  },
};
</script>

<template>
  <div class="mb-6 p-4 border rounded">
    <h3 class="text-base font-medium mb-2">OpenClaw agent</h3>
    <p class="text-sm text-n-slate-11 mb-3">
      OpenClaw is the agent for every channel (website, WhatsApp, and others).
      Configure models in OpenClaw — not here.
    </p>
    <SettingsToggleSection
      v-if="loaded"
      header="Enable OpenClaw auto-replies"
      v-model="aiEnabled"
    />
  </div>
</template>
