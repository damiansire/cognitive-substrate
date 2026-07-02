import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        include: ['{packages,apps}/**/src/**/*.test.{ts,tsx}'],
        exclude: ['**/node_modules/**', '**/dist/**']
    }
});
