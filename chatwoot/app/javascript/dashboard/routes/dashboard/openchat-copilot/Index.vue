<script setup>
import { computed, nextTick, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAlert } from 'dashboard/composables';
import MessageFormatter from 'shared/helpers/MessageFormatter.js';
import OpenchatAPI from 'dashboard/api/openchat';
import OpenchatCopilotAPI from 'dashboard/api/openchatCopilot';
import NextButton from 'dashboard/components-next/button/Button.vue';
import CopilotInput from 'dashboard/components-next/copilot/CopilotInput.vue';
import ChannelsPanel from './ChannelsPanel.vue';
import WhatsappQr from './WhatsappQr.vue';

// Deliberately not reusing CopilotAgentMessage/CopilotAssistantMessage/CopilotLoader —
// those hardcode "Captain" branding ($t('CAPTAIN.NAME')), a different, unrelated
// Chatwoot AI feature from this OpenChat admin agent.

const { t } = useI18n();

const EXAMPLE_PROMPT_KEYS = [
  'OPENCHAT_COPILOT.PROMPTS.CREATE_WIDGET',
  'OPENCHAT_COPILOT.PROMPTS.LIST_CHANNELS',
  'OPENCHAT_COPILOT.PROMPTS.CONNECT_WHATSAPP',
];

const messages = ref([]);
const isSending = ref(false);
const chatContainer = ref(null);
const connectedCount = ref(0);
const channelTotal = ref(0);
const agentOnline = ref(true);
const statusIssues = ref([]);

const hasMessages = computed(() => messages.value.length > 0);
const statusLabel = computed(() => {
  if (!agentOnline.value) return 'Offline';
  return statusIssues.value.length ? 'Needs attention' : 'Online';
});

onMounted(async () => {
  try {
    const { data } = await OpenchatAPI.getStatus();
    agentOnline.value = Boolean(data.ok || data.gateway?.live);
    statusIssues.value = data.issues || [];
  } catch {
    agentOnline.value = false;
  }
});

const onChannelsLoaded = ({ connectedCount: connected, total }) => {
  connectedCount.value = connected;
  channelTotal.value = total;
};

const scrollToBottom = async () => {
  await nextTick();
  if (chatContainer.value) {
    chatContainer.value.scrollTop = chatContainer.value.scrollHeight;
  }
};

const pushMessage = (messageType, content) => {
  messages.value.push({
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    messageType,
    content,
  });
};

const buildHistory = () =>
  messages.value
    .filter(message => message.messageType !== 'whatsapp_qr')
    .map(
      message =>
        `${message.messageType === 'user' ? 'User' : 'Assistant'}: ${message.content}`
    )
    .join('\n');

const sendMessage = async content => {
  const history = buildHistory();
  pushMessage('user', content);
  isSending.value = true;
  scrollToBottom();
  try {
    const { data } = await OpenchatCopilotAPI.chat(content, history);
    pushMessage('assistant', data.response);
    if (data.whatsapp_qr) {
      pushMessage('whatsapp_qr', '[Showed the WhatsApp QR code]');
    }
    return true;
  } catch (error) {
    useAlert(error?.response?.data?.error || t('OPENCHAT_COPILOT.ERROR'));
    return false;
  } finally {
    isSending.value = false;
    scrollToBottom();
  }
};

const resetConversation = () => {
  messages.value = [];
  // The copilot's OpenClaw session persists across page loads (fixed session key
  // per tenant) — clearing only this local array would leave stale conversation
  // history/state on the agent side. "/new" is OpenClaw's own reset command; fire
  // it in the background so the next message actually starts a fresh session.
  OpenchatCopilotAPI.chat('/new').catch(() => {});
};

const formatMessage = content => new MessageFormatter(content || '').formattedMessage;
</script>

<template>
  <div class="flex h-full w-full bg-n-background">
    <aside
      class="hidden md:flex flex-col w-72 shrink-0 border-e border-n-weak overflow-y-auto"
    >
      <div class="px-4 pt-5 pb-3">
        <h2 class="text-sm font-medium text-n-slate-12">Channels</h2>
        <p class="text-xs text-n-slate-10 mt-0.5">
          {{ connectedCount }} of {{ channelTotal }} connected
        </p>
      </div>
      <ChannelsPanel :on-request-connect="sendMessage" @loaded="onChannelsLoaded" />
    </aside>

    <div class="flex flex-col flex-1 min-w-0 h-full">
      <header
        class="flex items-center justify-between gap-3 px-6 py-4 border-b border-n-weak shrink-0"
      >
        <div class="flex items-center gap-3">
          <span
            class="flex items-center justify-center size-10 rounded-xl bg-n-solid-3 text-n-slate-12"
          >
            <span class="i-lucide-bot-message-square size-5" />
          </span>
          <div>
            <div class="flex items-center gap-2">
              <h1 class="text-base font-medium text-n-slate-12">
                {{ t('OPENCHAT_COPILOT.TITLE') }}
              </h1>
              <span class="inline-flex items-center gap-1.5 text-xs text-n-slate-10">
                <span
                  class="size-1.5 rounded-full"
                  :class="agentOnline ? (statusIssues.length ? 'bg-n-amber-9' : 'bg-n-teal-9') : 'bg-n-ruby-9'"
                />
                {{ statusLabel }}
              </span>
            </div>
            <p class="text-sm text-n-slate-11">
              {{ t('OPENCHAT_COPILOT.DESCRIPTION') }}
            </p>
          </div>
        </div>
        <NextButton
          v-if="hasMessages"
          ghost
          sm
          slate
          icon="i-lucide-refresh-ccw"
          @click="resetConversation"
        />
      </header>

      <div ref="chatContainer" class="flex-1 overflow-y-auto px-6 py-6">
        <div v-if="hasMessages" class="max-w-3xl mx-auto space-y-6">
          <template v-for="message in messages" :key="message.id">
            <div v-if="message.messageType === 'user'" class="flex justify-end">
              <div class="max-w-lg rounded-2xl rounded-br-md bg-n-solid-active px-4 py-2.5 text-sm text-n-slate-12">
                {{ message.content }}
              </div>
            </div>
            <div v-else-if="message.messageType === 'whatsapp_qr'" class="flex items-start gap-3">
              <span class="flex items-center justify-center size-8 rounded-lg bg-n-solid-3 shrink-0">
                <span class="i-lucide-bot-message-square size-4 text-n-slate-12" />
              </span>
              <WhatsappQr />
            </div>
            <div v-else class="flex items-start gap-3">
              <span class="flex items-center justify-center size-8 rounded-lg bg-n-solid-3 shrink-0 mt-0.5">
                <span class="i-lucide-bot-message-square size-4 text-n-slate-12" />
              </span>
              <div
                v-dompurify-html="formatMessage(message.content)"
                class="prose-sm break-words text-n-slate-12 max-w-lg pt-1"
              />
            </div>
          </template>
          <div
            v-if="isSending"
            class="flex items-center gap-2 text-n-iris-11 font-medium ms-11"
          >
            <span>{{ t('OPENCHAT_COPILOT.LOADER') }}</span>
            <div class="flex gap-1">
              <div class="w-2 h-2 rounded-full bg-n-iris-9 animate-bounce [animation-delay:-0.3s]" />
              <div class="w-2 h-2 rounded-full bg-n-iris-9 animate-bounce [animation-delay:-0.15s]" />
              <div class="w-2 h-2 rounded-full bg-n-iris-9 animate-bounce" />
            </div>
          </div>
        </div>
        <div
          v-else
          class="max-w-2xl mx-auto h-full flex flex-col items-center justify-center text-center gap-4"
        >
          <span
            class="flex items-center justify-center size-14 rounded-2xl bg-n-solid-3 text-n-slate-12"
          >
            <span class="i-lucide-bot-message-square size-7" />
          </span>
          <h2 class="text-lg font-medium text-n-slate-12">
            {{ t('OPENCHAT_COPILOT.EMPTY_TITLE') }}
          </h2>
          <p class="text-sm text-n-slate-11">
            {{ t('OPENCHAT_COPILOT.EMPTY_DESCRIPTION') }}
          </p>
          <div class="flex flex-col gap-2 w-full max-w-md">
            <button
              v-for="promptKey in EXAMPLE_PROMPT_KEYS"
              :key="promptKey"
              class="w-full text-start px-4 py-2.5 text-sm rounded-lg border border-n-weak text-n-slate-12 hover:bg-n-alpha-2"
              :disabled="isSending"
              @click="sendMessage(t(promptKey))"
            >
              {{ t(promptKey) }}
            </button>
          </div>
        </div>
      </div>

      <div class="border-t border-n-weak px-6 py-4 shrink-0">
        <div class="max-w-3xl mx-auto">
          <CopilotInput :on-send="sendMessage" />
        </div>
      </div>
    </div>
  </div>
</template>
