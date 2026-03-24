/**
 * Jest configuration for Detox E2E tests
 */
module.exports = {
  preset: 'detox',
  testEnvironment: 'node',
  testMatch: ['**/*.e2e.test.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: 'tsconfig.json',
    }],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  setupFilesAfterEnv: ['./e2e/setup.ts'],
  testTimeout: 120000,
  verbose: true,
};