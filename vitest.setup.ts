import { vi } from 'vitest';

vi.mock('expo-modules-core', () => {
  return {
    NativeModulesProxy: {},
    requireNativeModule: vi.fn(),
    EventEmitter: vi.fn(),
    CodedError: vi.fn(),
  };
});
