<script>
import { useAlert } from 'dashboard/composables';
import { useAccount } from 'dashboard/composables/useAccount';
import NextButton from 'dashboard/components-next/button/Button.vue';
import PageHeader from '../../../SettingsSubPageHeader.vue';
import OpenchatAPI from 'dashboard/api/openchat';
import router from '../../../../../index';

export default {
  name: 'OpenClawChannelSetup',
  components: { PageHeader, NextButton },
  props: {
    channelName: {
      type: String,
      required: true,
    },
  },
  setup() {
    const { accountId } = useAccount();
    return { accountId };
  },
  data() {
    return {
      busy: false,
      loading: true,
      channel: null,
      fieldValues: {},
      statusMessage: '',
      errorMessage: '',
    };
  },
  computed: {
    fields() {
      return this.channel?.fields || [];
    },
    title() {
      return this.channel?.label
        ? `${this.channel.label} via OpenClaw`
        : `${this.channelName} via OpenClaw`;
    },
    description() {
      return (
        this.channel?.description ||
        'Connect this channel through OpenClaw.'
      );
    },
  },
  watch: {
    channelName: {
      immediate: true,
      handler() {
        this.loadChannel();
      },
    },
  },
  methods: {
    async loadChannel() {
      this.loading = true;
      this.errorMessage = '';
      this.fieldValues = {};
      try {
        const { data } = await OpenchatAPI.getChannels();
        const catalog = data.catalog || [];
        this.channel =
          catalog.find(c => c.id === this.channelName) || {
            id: this.channelName,
            label: this.channelName,
            description: 'Connect this channel through OpenClaw.',
            fields: [],
          };
        (this.channel.fields || []).forEach(field => {
          this.fieldValues[field.key] = '';
        });
      } catch (error) {
        this.channel = {
          id: this.channelName,
          label: this.channelName,
          description: 'Connect this channel through OpenClaw.',
          fields: [],
        };
        this.errorMessage =
          error?.response?.data?.error ||
          error.message ||
          'Could not load channel fields.';
      } finally {
        this.loading = false;
      }
    },
    backToChooser() {
      router.push({
        name: 'settings_inbox_new',
        params: { accountId: this.accountId },
      });
    },
    async connectChannel() {
      this.busy = true;
      this.errorMessage = '';
      this.statusMessage = `Connecting ${this.channel?.label || this.channelName} to OpenClaw…`;
      try {
        const { data } = await OpenchatAPI.connectChannel({
          channel: this.channelName,
          fields: { ...this.fieldValues },
          label: this.channel?.label,
        });
        let inboxId = data.inbox_id;
        if (!inboxId) {
          const fin = await OpenchatAPI.finalizeChannel({
            channel: this.channelName,
            label: this.channel?.label,
          });
          inboxId = fin.data.inbox_id;
        }
        this.statusMessage = data.message || 'Connected.';
        if (inboxId) {
          router.replace({
            name: 'settings_inbox_finish',
            params: { page: 'new', inbox_id: inboxId },
          });
        }
      } catch (error) {
        this.statusMessage = '';
        this.errorMessage =
          error?.response?.data?.error ||
          error.message ||
          'Connect failed';
        useAlert(this.errorMessage);
      } finally {
        this.busy = false;
      }
    },
  },
};
</script>

<template>
  <div
    data-openchat-native-channel-setup
    class="h-full w-full p-6 col-span-6"
  >
    <PageHeader :header-title="title" :header-content="description" />
    <div v-if="loading" class="mt-6 text-sm text-n-slate-11">Loading…</div>
    <form
      v-else
      class="flex flex-wrap flex-col mx-0 mt-6 max-w-xl gap-4"
      @submit.prevent="connectChannel"
    >
      <p v-if="!fields.length" class="text-sm text-n-slate-11">
        No extra fields required.
      </p>
      <div
        v-for="field in fields"
        :key="field.key"
        class="flex-shrink-0 flex-grow-0"
      >
        <label class="flex flex-col gap-1">
          {{ field.label }}{{ field.optional ? ' (optional)' : '' }}
          <input
            v-model="fieldValues[field.key]"
            class="input"
            :type="field.secret ? 'password' : 'text'"
            :placeholder="field.placeholder || ''"
            autocomplete="off"
          />
          <span v-if="field.help" class="text-xs text-n-slate-11">{{
            field.help
          }}</span>
        </label>
      </div>

      <div class="flex flex-wrap gap-3 mt-2">
        <NextButton
          type="submit"
          :is-loading="busy"
          :disabled="busy"
          label="Connect"
        />
        <NextButton
          type="button"
          variant="faded"
          color="slate"
          label="Back"
          :disabled="busy"
          @click="backToChooser"
        />
      </div>

      <p v-if="statusMessage" class="text-sm text-n-slate-11">
        {{ statusMessage }}
      </p>
      <p v-if="errorMessage" class="text-sm text-red-600">{{ errorMessage }}</p>
    </form>
  </div>
</template>
