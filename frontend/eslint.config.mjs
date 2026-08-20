import coreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

const eslintConfig = [
  { ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'] },
  ...coreWebVitals,
  ...nextTypescript,
  {
    rules: {
      // React Compiler diagnostic: react-hook-form's `watch` makes the compiler skip
      // optimizing those components. RHF is mandated by the PRD — not actionable.
      'react-hooks/incompatible-library': 'off',
    },
  },
];

export default eslintConfig;
