import {defineConfig} from 'vitest/config';
import {svelte} from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  base: './',
  resolve: process.env.VITEST ? {conditions: ['browser']} : undefined,
  test: {
    environment: 'happy-dom',
    include: ['tests/**/*.test.js'],
    setupFiles: ['tests/setup.js'],
    clearMocks: true,
    pool: 'forks',
    maxWorkers: 1,
    minWorkers: 1,
  },
});
