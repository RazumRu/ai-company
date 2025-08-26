import { setupNodeEvents as _setupNodeEvents } from '@packages/cypress';
import { defineConfig } from 'cypress';
import * as dotenv from 'dotenv';

dotenv.config({
  path: '../.env',
});

export default defineConfig({
  video: false,
  screenshotOnRunFailure: false,
  e2e: {
    supportFile: false,
    baseUrl: 'http://localhost:5000',
    specPattern: './e2e/**/*.cy.ts',
    setupNodeEvents(on, config) {
      return _setupNodeEvents(on, config);
    },
    env: {
      STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    },
  },
});
