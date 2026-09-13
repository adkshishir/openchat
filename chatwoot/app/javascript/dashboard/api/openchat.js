/* global axios */
import ApiClient from './ApiClient';

class OpenchatAPI extends ApiClient {
  constructor() {
    super('openchat', { accountScoped: true });
  }

  createWebWidget(data) {
    return axios.post(`${this.url}/web_widget`, data);
  }

  getSettings() {
    return axios.get(`${this.url}/settings`);
  }

  updateSettings(data) {
    return axios.patch(`${this.url}/update_settings`, data);
  }

  startWhatsapp({ force = true } = {}) {
    return axios.post(`${this.url}/whatsapp_start`, null, {
      params: { force: force ? 1 : 0 },
    });
  }

  waitWhatsapp({ currentQr } = {}) {
    return axios.post(`${this.url}/whatsapp_wait`, {
      current_qr: currentQr || undefined,
    });
  }

  getChannels() {
    return axios.get(`${this.url}/channels`);
  }

  connectChannel(data) {
    return axios.post(`${this.url}/channel_connect`, data);
  }

  finalizeChannel(data) {
    return axios.post(`${this.url}/channel_finalize`, data);
  }

  getKnowledgeSources() {
    return axios.get(`${this.url}/knowledge`);
  }

  uploadKnowledge(file, { onUploadProgress } = {}) {
    const formData = new FormData();
    formData.append('file', file);
    return axios.post(`${this.url}/knowledge/upload`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress,
    });
  }

  deleteKnowledgeSource(id) {
    return axios.delete(`${this.url}/knowledge/${id}`);
  }

  searchKnowledge(query) {
    return axios.post(`${this.url}/knowledge/search`, { query });
  }
}

export default new OpenchatAPI();
