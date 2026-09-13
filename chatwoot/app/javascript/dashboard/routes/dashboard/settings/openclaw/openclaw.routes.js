import { frontendURL } from '../../../../helper/URLHelper';
import SettingsWrapper from '../SettingsWrapper.vue';
import Index from './Index.vue';

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
  ],
};
