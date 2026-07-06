module.exports = {
  displayName: 'storage',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  moduleNameMapper: {
    '^@ariadne/protocol$': '<rootDir>/../../libs/protocol/src/index.ts',
  },
  coverageDirectory: '../../coverage/libs/storage',
};
