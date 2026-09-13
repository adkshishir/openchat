<script>
import { useAlert } from 'dashboard/composables';
import router from '../../../../../index';
import NextButton from 'dashboard/components-next/button/Button.vue';
import PageHeader from '../../../SettingsSubPageHeader.vue';
import OpenchatAPI from 'dashboard/api/openchat';

export default {
  components: { PageHeader, NextButton },
  data() {
    return {
      inboxName: '',
      websiteUrl: '',
      widgetColor: '#1f93ff',
      welcomeTitle: '',
      welcomeTagline: '',
      busy: false,
      created: null,
    };
  },
  methods: {
    async createChannel() {
      this.busy = true;
      try {
        const { data } = await OpenchatAPI.createWebWidget({
          name: this.inboxName?.trim(),
          website_url: this.websiteUrl,
          widget_color: this.widgetColor,
          welcome_title: this.welcomeTitle,
          welcome_tagline: this.welcomeTagline,
        });
        this.created = data;
        router.replace({
          name: 'settings_inboxes_add_agents',
          params: { page: 'new', inbox_id: data.id },
        });
      } catch (error) {
        useAlert(error.message || 'Could not create the OpenChat web widget.');
      } finally {
        this.busy = false;
      }
    },
    copyScript() {
      navigator.clipboard.writeText(this.created.web_widget_script);
      useAlert('Embed snippet copied.');
    },
  },
};
</script>

<template>
  <div class="h-full w-full p-6 col-span-6">
    <PageHeader
      header-title="Connect website chat"
      header-content="Same guided setup as OpenClaw: website URL, brand color, then a one-click embed snippet. OpenClaw is the agent and auto-replies by default."
    />
    <div class="flex flex-col gap-4 max-w-xl mt-6">
      <label class="flex flex-col gap-1">
        Inbox name
        <input v-model="inboxName" class="input" type="text" placeholder="Support" />
      </label>
      <label class="flex flex-col gap-1">
        Website URL
        <input v-model="websiteUrl" class="input" type="url" placeholder="https://example.com" />
      </label>
      <label class="flex flex-col gap-1">
        Widget color
        <input v-model="widgetColor" class="input" type="color" />
      </label>
      <label class="flex flex-col gap-1">
        Welcome title
        <input v-model="welcomeTitle" class="input" type="text" />
      </label>
      <label class="flex flex-col gap-1">
        Welcome tagline
        <input v-model="welcomeTagline" class="input" type="text" />
      </label>
      <NextButton
        :is-loading="busy"
        :disabled="!websiteUrl || busy"
        label="Connect website"
        @click="createChannel"
      />
    </div>
  </div>
</template>
