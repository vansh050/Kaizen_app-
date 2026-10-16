jest.mock('react-native-toast-message', () => ({show: jest.fn()}));
jest.mock('../../utils/Logging', () => ({logZerodhaDiagnostic: jest.fn()}));

import Toast from 'react-native-toast-message';
import {
  EXECUTION_BUNDLE_VERSION,
  executionBundleHeaders,
  handleStaleExecutionBundle,
} from '../../utils/executionBundleSafety';
import {isKiteUrl} from '../../hooks/useKiteHandoffGuard';
import {accountRecoveryMetadata} from '../../utils/accountRecoveryUx';

describe('execution safety guards', () => {
  beforeEach(() => jest.clearAllMocks());

  test('marks execution intents with a monotonic mobile bundle', () => {
    expect(EXECUTION_BUNDLE_VERSION).toBe(2026091102);
    expect(executionBundleHeaders()).toEqual({
      'X-AQ-Execution-Client': 'mobile',
      'X-AQ-Execution-Bundle': '2026091102',
    });
  });

  test('blocks only for the typed stale-bundle response', async () => {
    expect(await handleStaleExecutionBundle(new Error('network'))).toBe(false);

    expect(await handleStaleExecutionBundle({
      response: {data: {code: 'EXECUTION_BUNDLE_STALE'}},
    })).toBe(true);
    expect(Toast.show).toHaveBeenCalledWith(expect.objectContaining({
      text1: 'App update required',
    }));
  });

  test('recognizes only Zerodha Kite hosts', () => {
    expect(isKiteUrl('https://kite.zerodha.com/connect/login')).toBe(true);
    expect(isKiteUrl('https://publisher.kite.zerodha.com/basket')).toBe(true);
    expect(isKiteUrl('https://kite.zerodha.com.attacker.example/')).toBe(false);
  });

  test('bounds account recovery retries and carries operator correlation', () => {
    expect(accountRecoveryMetadata({response: {data: {
      reason: 'account_recovery_running',
      operation_id: 'op-123',
      retry_after_seconds: 90,
    }}})).toEqual({
      running: true,
      operationId: 'op-123',
      retryAfterSeconds: 30,
    });
  });
});
