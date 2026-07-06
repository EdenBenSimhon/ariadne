import nx from '@nx/eslint-plugin';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: ['**/dist', '**/out-tsc'],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'],
          depConstraints: [
            // Layering: protocol < transport < sdk < app (spec §2).
            {
              sourceTag: 'scope:protocol',
              onlyDependOnLibsWithTags: ['scope:protocol'],
            },
            {
              sourceTag: 'scope:transport',
              onlyDependOnLibsWithTags: ['scope:protocol', 'scope:transport'],
            },
            {
              sourceTag: 'scope:sdk',
              onlyDependOnLibsWithTags: ['scope:protocol', 'scope:transport', 'scope:sdk'],
            },
            {
              sourceTag: 'scope:storage',
              onlyDependOnLibsWithTags: ['scope:protocol', 'scope:storage'],
            },
            {
              sourceTag: 'scope:graph',
              onlyDependOnLibsWithTags: ['scope:protocol', 'scope:graph'],
            },
            {
              sourceTag: 'scope:app',
              onlyDependOnLibsWithTags: [
                'scope:protocol',
                'scope:transport',
                'scope:sdk',
                'scope:storage',
                'scope:graph',
                'scope:app',
              ],
            },
            // Keep Node-only code (ALS, kafkajs) out of the browser bundle.
            {
              sourceTag: 'platform:browser',
              onlyDependOnLibsWithTags: ['platform:shared', 'platform:browser'],
            },
            {
              sourceTag: 'platform:node',
              onlyDependOnLibsWithTags: ['platform:shared', 'platform:node'],
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.cts',
      '**/*.mts',
      '**/*.js',
      '**/*.jsx',
      '**/*.cjs',
      '**/*.mjs',
    ],
    // Override or add rules here
    rules: {},
  },
  {
    // Library code is the reusable surface — no `any` leaks allowed.
    files: ['libs/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
];
