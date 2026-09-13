<script>
import { useAlert } from 'dashboard/composables';
import NextButton from 'dashboard/components-next/button/Button.vue';
import SettingsLayout from '../SettingsLayout.vue';
import BaseSettingsHeader from '../components/BaseSettingsHeader.vue';
import OpenchatAPI from 'dashboard/api/openchat';

const ACCEPTED_EXTENSIONS = '.md,.txt,.json,.csv,.xlsx,.xls';

export default {
  components: { NextButton, SettingsLayout, BaseSettingsHeader },
  data() {
    return {
      sources: [],
      isLoadingSources: false,
      isUploading: false,
      uploadError: '',
      deletingId: null,
      searchQuery: '',
      isSearching: false,
      searchError: '',
      searchResults: null,
      acceptedExtensions: ACCEPTED_EXTENSIONS,
    };
  },
  mounted() {
    this.fetchSources();
  },
  methods: {
    async fetchSources() {
      this.isLoadingSources = true;
      try {
        const { data } = await OpenchatAPI.getKnowledgeSources();
        this.sources = data.sources || [];
      } catch (error) {
        useAlert(
          error?.response?.data?.error || 'Could not load knowledge base.'
        );
      } finally {
        this.isLoadingSources = false;
      }
    },
    triggerFilePicker() {
      this.$refs.fileInput.click();
    },
    async onFileSelected(event) {
      const [file] = event.target.files || [];
      event.target.value = '';
      if (!file) return;
      this.isUploading = true;
      this.uploadError = '';
      try {
        await OpenchatAPI.uploadKnowledge(file);
        useAlert(`${file.name} added to the knowledge base.`);
        await this.fetchSources();
      } catch (error) {
        this.uploadError =
          error?.response?.data?.error || 'Could not process this file.';
        useAlert(this.uploadError);
      } finally {
        this.isUploading = false;
      }
    },
    async deleteSource(source) {
      this.deletingId = source.id;
      try {
        await OpenchatAPI.deleteKnowledgeSource(source.id);
        this.sources = this.sources.filter(s => s.id !== source.id);
      } catch (error) {
        useAlert(
          error?.response?.data?.error || 'Could not remove this item.'
        );
      } finally {
        this.deletingId = null;
      }
    },
    async runSearch() {
      if (!this.searchQuery.trim()) return;
      this.isSearching = true;
      this.searchError = '';
      this.searchResults = null;
      try {
        const { data } = await OpenchatAPI.searchKnowledge(this.searchQuery);
        this.searchResults = data.matches || [];
      } catch (error) {
        this.searchError =
          error?.response?.data?.error || 'Search failed.';
      } finally {
        this.isSearching = false;
      }
    },
    formatDate(value) {
      return new Date(value).toLocaleString();
    },
  },
};
</script>

<template>
  <SettingsLayout :is-loading="false">
    <template #header>
      <BaseSettingsHeader
        title="OpenClaw Knowledge Base"
        description="Upload documents or a product catalog (JSON, CSV, Excel). OpenClaw's AI automatically looks up relevant matches when replying to customers on WhatsApp and other connected channels."
      />
    </template>
    <template #body>
      <div class="flex-grow flex-shrink overflow-auto max-w-3xl flex flex-col gap-8">
        <div class="border border-n-weak rounded-2xl p-6 flex flex-col gap-3">
          <h3 class="text-base font-medium text-n-slate-12">Add a file</h3>
          <p class="text-sm text-n-slate-11">
            Plain docs (.md, .txt) get chunked and indexed as knowledge. Structured files
            (.json, .csv, .xlsx) are parsed row-by-row — each row becomes a searchable product
            or record.
          </p>
          <input
            ref="fileInput"
            type="file"
            class="hidden"
            :accept="acceptedExtensions"
            @change="onFileSelected"
          />
          <div>
            <NextButton
              :is-loading="isUploading"
              :disabled="isUploading"
              label="Upload file"
              icon="i-lucide-upload"
              @click="triggerFilePicker"
            />
          </div>
          <p v-if="uploadError" class="text-sm text-red-600">{{ uploadError }}</p>
        </div>

        <div class="flex flex-col gap-3">
          <h3 class="text-base font-medium text-n-slate-12">Uploaded knowledge</h3>
          <p v-if="!isLoadingSources && !sources.length" class="text-sm text-n-slate-11">
            Nothing uploaded yet.
          </p>
          <div
            v-for="source in sources"
            :key="source.id"
            class="flex items-center justify-between border border-n-weak rounded-xl px-4 py-3"
          >
            <div class="flex flex-col">
              <span class="text-sm font-medium text-n-slate-12">{{ source.filename }}</span>
              <span class="text-xs text-n-slate-11">
                {{ source.kind === 'catalog' ? 'Product catalog' : 'Document' }} ·
                {{ source.chunk_count }} {{ source.kind === 'catalog' ? 'records' : 'chunks' }} ·
                {{ formatDate(source.created_at) }}
              </span>
            </div>
            <NextButton
              variant="ghost"
              color="ruby"
              size="sm"
              :is-loading="deletingId === source.id"
              label="Remove"
              @click="deleteSource(source)"
            />
          </div>
        </div>

        <div class="border border-n-weak rounded-2xl p-6 flex flex-col gap-3">
          <h3 class="text-base font-medium text-n-slate-12">Test search</h3>
          <p class="text-sm text-n-slate-11">
            Preview what the AI would find for a customer question, before it goes live.
          </p>
          <div class="flex gap-2">
            <input
              v-model="searchQuery"
              type="text"
              placeholder="e.g. do you have anything for hiking?"
              class="flex-1 border border-n-weak rounded-lg px-3 py-2 text-sm bg-n-solid-1"
              @keyup.enter="runSearch"
            />
            <NextButton
              :is-loading="isSearching"
              label="Search"
              @click="runSearch"
            />
          </div>
          <p v-if="searchError" class="text-sm text-red-600">{{ searchError }}</p>
          <p
            v-if="searchResults && !searchResults.length"
            class="text-sm text-n-slate-11"
          >
            No relevant matches found.
          </p>
          <div
            v-for="(match, index) in searchResults"
            :key="index"
            class="text-sm text-n-slate-11 border-t border-n-weak pt-2"
          >
            {{ match.content }}
          </div>
        </div>
      </div>
    </template>
  </SettingsLayout>
</template>
