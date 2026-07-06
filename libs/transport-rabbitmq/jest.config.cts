module.exports = {
  displayName: 'transport-rabbitmq',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  moduleNameMapper: {
    '^@ariadne/protocol$': '<rootDir>/../../libs/protocol/src/index.ts',
    '^@ariadne/transport-core$': '<rootDir>/../../libs/transport-core/src/index.ts',
    '^@ariadne/transport-core/testing$': '<rootDir>/../../libs/transport-core/src/testing.ts',
  },
  coverageDirectory: '../../coverage/libs/transport-rabbitmq',
};
