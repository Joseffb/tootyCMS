import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docsSidebar: [
    'intro',
    {
      type: 'category',
      label: 'Code Research',
      items: [
        'code-research/index',
        'code-research/service-map',
        'code-research/route-map',
        'code-research/plugin-api-surface'
      ]
    }
  ]
};

export default sidebars;
