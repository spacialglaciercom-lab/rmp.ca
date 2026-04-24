/**
 * Detox E2E Test Setup
 * 
 * This file runs before each test file and sets up the test environment.
 */

// Increase timeout for E2E tests
jest.setTimeout(120000);

// Global before/after hooks
beforeAll(async () => {
  // Ensure app is installed and ready
  console.log('Starting E2E test suite...');
});

afterAll(async () => {
  console.log('E2E test suite completed.');
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Export test utilities
export const waitForElement = async (
  elementId: string,
  timeout: number = 10000
) => {
  const { waitFor, element, by } = require('detox');
  await waitFor(element(by.id(elementId)))
    .toBeVisible()
    .withTimeout(timeout);
};

export const tapElement = async (elementId: string) => {
  const { element, by } = require('detox');
  await element(by.id(elementId)).tap();
};

export const typeText = async (elementId: string, text: string) => {
  const { element, by } = require('detox');
  await element(by.id(elementId)).replaceText(text);
};

export const expectVisible = async (elementId: string) => {
  const { expect: detoxExpect, element, by } = require('detox');
  await detoxExpect(element(by.id(elementId))).toBeVisible();
};

export const expectNotVisible = async (elementId: string) => {
  const { expect: detoxExpect, element, by } = require('detox');
  await detoxExpect(element(by.id(elementId))).not.toBeVisible();
};

export const expectText = async (elementId: string, text: string) => {
  const { expect: detoxExpect, element, by } = require('detox');
  await detoxExpect(element(by.id(elementId))).toHaveText(text);
};