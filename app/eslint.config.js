const expoConfig = require('eslint-config-expo/flat');

module.exports = [
  ...expoConfig,
  {
    files: ['src/__tests__/**', 'src/testing/**', 'jest.setup*.ts'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  { ignores: ['dist/*', 'android/*', 'ios/*', '.expo/*', 'coverage/*'] },
];
