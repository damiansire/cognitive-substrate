import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
    {
        ignores: [
            '**/dist/**',
            '**/node_modules/**',
            '**/.angular/**',
            'workspaces/**',
            'runs/**',
            'artifacts/**',
            'evals-report/**',
            'apps/presentation/**'
        ]
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        languageOptions: {
            globals: { ...globals.node }
        },
        rules: {
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
            // Warn instead of error: the existing codebase has ~30 pre-existing `any` uses
            // at API/SDK boundaries (Gemini, Docker, Playwright). Tightening those is a
            // separate task; new code should still avoid `any` going forward.
            '@typescript-eslint/no-explicit-any': 'warn'
        }
    },
    eslintConfigPrettier
);
