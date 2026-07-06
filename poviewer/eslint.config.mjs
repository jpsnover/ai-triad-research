import requireFlightRecorderInCatch from '../lib/eslint-rules/require-flight-recorder-in-catch.js';

const localPlugin = {
  rules: {
    'require-flight-recorder-in-catch': requireFlightRecorderInCatch,
  },
};

export default [
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    plugins: { local: localPlugin },
    rules: {
      'local/require-flight-recorder-in-catch': 'warn',
    },
  },
];
