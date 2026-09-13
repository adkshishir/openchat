<script>
import { mapGetters } from 'vuex';
import LoadingState from 'dashboard/components/widgets/LoadingState.vue';
import SettingsFieldSection from 'dashboard/components-next/Settings/SettingsFieldSection.vue';

export default {
  components: {
    LoadingState,
    SettingsFieldSection,
  },
  props: {
    inbox: {
      type: Object,
      default: () => ({}),
    },
  },
  computed: {
    ...mapGetters({
      uiFlags: 'agentBots/getUIFlags',
    }),
    currentInboxId() {
      return this.inbox?.id || this.$route.params.inboxId;
    },
    activeAgentBot() {
      return this.$store.getters['agentBots/getActiveAgentBot'](
        this.currentInboxId
      );
    },
    agentName() {
      return this.activeAgentBot?.name || 'OpenClaw';
    },
  },
  mounted() {
    this.$store.dispatch('agentBots/get');
    this.$store.dispatch('agentBots/fetchAgentBotInbox', this.currentInboxId);
  },
};
</script>

<template>
  <div class="mx-6 max-w-4xl">
    <LoadingState v-if="uiFlags.isFetching || uiFlags.isFetchingAgentBot" />
    <SettingsFieldSection
      v-else
      label="OpenClaw agent"
      help-text="OpenClaw is attached as the bot for every channel. Model and gateway settings live in OpenClaw."
      class="[&>div]:!items-start"
    >
      <div
        class="rounded-lg border border-n-weak bg-n-surface-2 px-4 py-3 text-sm text-n-slate-12"
      >
        Active agent: <strong>{{ agentName }}</strong>
      </div>
    </SettingsFieldSection>
  </div>
</template>
