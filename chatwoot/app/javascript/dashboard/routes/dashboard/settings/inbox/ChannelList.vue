<script setup>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useMapGetter } from 'dashboard/composables/store';

import { useAccount } from 'dashboard/composables/useAccount';

import ChannelItem from 'dashboard/components/widgets/ChannelItem.vue';

const { t } = useI18n();
const router = useRouter();
const { accountId, currentAccount, isOnChatwootCloud } = useAccount();

const globalConfig = useMapGetter('globalConfig/get');

const enabledFeatures = computed(() => currentAccount.value?.features || {});

const hasTiktokConfigured = computed(() => {
  return window.chatwootConfig?.tiktokAppId;
});

const channelList = computed(() => {
  const { apiChannelName } = globalConfig.value;
  const channels = [
    {
      key: 'website',
      title: t('INBOX_MGMT.ADD.AUTH.CHANNEL.WEBSITE.TITLE'),
      description: 'Guided OpenChat setup: URL, brand color, embed snippet, AI replies on.',
      icon: 'i-woot-website',
    },
    {
      key: 'facebook',
      title: t('INBOX_MGMT.ADD.AUTH.CHANNEL.FACEBOOK.TITLE'),
      description: t('INBOX_MGMT.ADD.AUTH.CHANNEL.FACEBOOK.DESCRIPTION'),
      icon: 'i-woot-messenger',
    },
    {
      key: 'whatsapp',
      title: t('INBOX_MGMT.ADD.AUTH.CHANNEL.WHATSAPP.TITLE'),
      description: 'Scan a QR code like OpenClaw to connect WhatsApp.',
      icon: 'i-woot-whatsapp',
    },
    {
      key: 'sms',
      title: t('INBOX_MGMT.ADD.AUTH.CHANNEL.SMS.TITLE'),
      description: t('INBOX_MGMT.ADD.AUTH.CHANNEL.SMS.DESCRIPTION'),
      icon: 'i-woot-sms',
    },
    {
      key: 'email',
      title: t('INBOX_MGMT.ADD.AUTH.CHANNEL.EMAIL.TITLE'),
      description: t('INBOX_MGMT.ADD.AUTH.CHANNEL.EMAIL.DESCRIPTION'),
      icon: 'i-woot-mail',
    },
    {
      key: 'api',
      title: apiChannelName || t('INBOX_MGMT.ADD.AUTH.CHANNEL.API.TITLE'),
      description: t('INBOX_MGMT.ADD.AUTH.CHANNEL.API.DESCRIPTION'),
      icon: 'i-woot-api',
    },
    {
      key: 'telegram',
      title: t('INBOX_MGMT.ADD.AUTH.CHANNEL.TELEGRAM.TITLE'),
      description: t('INBOX_MGMT.ADD.AUTH.CHANNEL.TELEGRAM.DESCRIPTION'),
      icon: 'i-woot-telegram',
    },
    {
      key: 'line',
      title: t('INBOX_MGMT.ADD.AUTH.CHANNEL.LINE.TITLE'),
      description: t('INBOX_MGMT.ADD.AUTH.CHANNEL.LINE.DESCRIPTION'),
      icon: 'i-woot-line',
    },
    {
      key: 'instagram',
      title: t('INBOX_MGMT.ADD.AUTH.CHANNEL.INSTAGRAM.TITLE'),
      description: t('INBOX_MGMT.ADD.AUTH.CHANNEL.INSTAGRAM.DESCRIPTION'),
      icon: 'i-woot-instagram',
    },
    {
      key: 'discord',
      title: 'Discord',
      description: 'Connect Discord via OpenClaw bot token.',
      icon: 'i-woot-api',
    },
    {
      key: 'slack',
      title: 'Slack',
      description: 'Connect Slack via OpenClaw Socket Mode tokens.',
      icon: 'i-woot-api',
    },
    {
      key: 'signal',
      title: 'Signal',
      description: 'Connect Signal via OpenClaw signal-cli daemon.',
      icon: 'i-woot-api',
    },
    {
      key: 'googlechat',
      title: 'Google Chat',
      description: 'Connect Google Chat via OpenClaw webhook.',
      icon: 'i-woot-api',
    },
    {
      key: 'matrix',
      title: 'Matrix',
      description: 'Connect Matrix via OpenClaw homeserver token.',
      icon: 'i-woot-api',
    },
    {
      key: 'irc',
      title: 'IRC',
      description: 'Connect IRC via OpenClaw server + nick.',
      icon: 'i-woot-api',
    },
    {
      key: 'mattermost',
      title: 'Mattermost',
      description: 'Connect Mattermost via OpenClaw bot token.',
      icon: 'i-woot-api',
    },
    {
      key: 'feishu',
      title: 'Feishu / Lark',
      description: 'Connect Feishu via OpenClaw app credentials.',
      icon: 'i-woot-api',
    },
    {
      key: 'msteams',
      title: 'Microsoft Teams',
      description: 'Connect Teams via OpenClaw Azure bot credentials.',
      icon: 'i-woot-api',
    },
  ];

  if (hasTiktokConfigured.value) {
    channels.push({
      key: 'tiktok',
      title: t('INBOX_MGMT.ADD.AUTH.CHANNEL.TIKTOK.TITLE'),
      description:
        currentAccount.value &&
        isOnChatwootCloud.value &&
        !enabledFeatures.value.channel_tiktok
          ? t('INBOX_MGMT.ADD.AUTH.CHANNEL.TIKTOK.ACCESS_REQUEST_DESCRIPTION')
          : t('INBOX_MGMT.ADD.AUTH.CHANNEL.TIKTOK.DESCRIPTION'),
      icon: 'i-woot-tiktok',
    });
  }

  channels.push({
    key: 'voice',
    title: t('INBOX_MGMT.ADD.AUTH.CHANNEL.VOICE.TITLE'),
    description: t('INBOX_MGMT.ADD.AUTH.CHANNEL.VOICE.DESCRIPTION'),
    icon: 'i-woot-voice',
  });

  channels.push({
    key: 'whatsapp_call',
    title: t('INBOX_MGMT.ADD.AUTH.CHANNEL.WHATSAPP_CALL.TITLE'),
    description: t('INBOX_MGMT.ADD.AUTH.CHANNEL.WHATSAPP_CALL.DESCRIPTION'),
    icon: 'i-woot-whatsapp',
  });

  return channels;
});

const initChannelAuth = channel => {
  const params = {
    sub_page: channel,
    accountId: accountId.value,
  };
  router.push({ name: 'settings_inboxes_page_channel', params });
};
</script>

<template>
  <div
    class="grid max-w-3xl grid-cols-1 xs:grid-cols-2 mx-0 gap-6 sm:grid-cols-3 p-8"
  >
    <ChannelItem
      v-for="channel in channelList"
      :key="channel.key"
      :channel="channel"
      :enabled-features="enabledFeatures"
      @channel-item-click="initChannelAuth"
    />
  </div>
</template>
