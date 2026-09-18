/** @type {import('@storybook/html-vite').StorybookConfig} */
export default {
  stories: ['../src/**/*.stories.js'],
  addons: ['@storybook/addon-essentials', '@storybook/addon-a11y', '@storybook/addon-themes'],
  framework: { name: '@storybook/html-vite', options: {} },
  // No phoning home from a build that runs in CI and on Cloudflare.
  core: { disableTelemetry: true },
  // Cloudflare Pages serves the built site from a subpath-free root.
  staticDirs: [],
};
