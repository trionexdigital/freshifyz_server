module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  clearMocks: true,
  transform: { '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }] },
  collectCoverageFrom: ['src/server/**/*.ts'],
};
