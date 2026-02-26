import type { Config } from '@docusaurus/types';

const config: Config = {
  title: 'Tooty Docs',
  tagline: 'Code research and architecture notes',
  favicon: 'img/favicon.ico',
  url: 'https://example.com',
  baseUrl: '/',
  organizationName: 'tooty',
  projectName: 'tooty-docs',
  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',
  i18n: {
    defaultLocale: 'en',
    locales: ['en']
  },
  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          routeBasePath: '/',
          editUrl: undefined
        },
        blog: false,
        pages: false,
        theme: {
          customCss: './src/css/custom.css'
        }
      }
    ]
  ],
  themeConfig: {
    navbar: {
      title: 'Tooty Docs',
      items: [
        { to: '/', label: 'Docs', position: 'left' }
      ]
    }
  }
};

export default config;
