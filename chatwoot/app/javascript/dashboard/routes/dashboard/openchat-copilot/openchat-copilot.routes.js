import { frontendURL } from '../../../helper/URLHelper';
import Index from './Index.vue';

export const routes = [
  {
    path: frontendURL('accounts/:accountId/openchat-copilot'),
    name: 'openchat_copilot_index',
    component: Index,
    meta: {
      permissions: ['administrator'],
    },
  },
];
