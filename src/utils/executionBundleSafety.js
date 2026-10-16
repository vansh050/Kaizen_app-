import Toast from 'react-native-toast-message';

// Monotonic safety contract understood by the Node execution-intent boundary.
export const EXECUTION_BUNDLE_VERSION = 2026091102;

export const executionBundleHeaders = () => ({
  'X-AQ-Execution-Client': 'mobile',
  'X-AQ-Execution-Bundle': String(EXECUTION_BUNDLE_VERSION),
});

export const handleStaleExecutionBundle = async error => {
  if (error?.response?.data?.code !== 'EXECUTION_BUNDLE_STALE') return false;
  Toast.show({
    type: 'info',
    text1: 'App update required',
    text2: 'Update the app before trying again. No order was sent.',
    visibilityTime: 7000,
  });
  return true;
};
