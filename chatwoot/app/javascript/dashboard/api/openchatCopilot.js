/* global axios */
import ApiClient from './ApiClient';

class OpenchatCopilotAPI extends ApiClient {
  constructor() {
    super('openchat', { accountScoped: true });
  }

  chat(message, messageHistory = '') {
    return axios.post(`${this.url}/agent_chat`, {
      message,
      message_history: messageHistory,
    });
  }
}

export default new OpenchatCopilotAPI();
