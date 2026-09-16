import { frontendURL } from '../../../../helper/URLHelper';
import SettingsWrapper from '../SettingsWrapper.vue';
import Index from './Index.vue';
import Orders from './Orders.vue';

export default {
  routes: [
    {
      // A legacy runtime script (openchat-agent-patch.js) owns the bare
      // /settings/openclaw path for its own "Agent status + train persona"
      // page — nest under /knowledge so this page doesn't collide with it.
      path: frontendURL('accounts/:accountId/settings/openclaw/knowledge'),
      component: SettingsWrapper,
      children: [
        {
          path: '',
          name: 'settings_openclaw_knowledge',
          component: Index,
          meta: {
            permissions: ['administrator'],
          },
        },
      ],
    },
    {
      path: frontendURL('accounts/:accountId/settings/openclaw/orders'),
      component: SettingsWrapper,
      children: [
        {
          path: '',
          name: 'settings_openclaw_orders',
          component: Orders,
          meta: {
            permissions: ['administrator'],
          },
        },
      ],
    },
  ],
};
