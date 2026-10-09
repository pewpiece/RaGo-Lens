/**
 * Wraps app.json. RaGo Lens makes no network calls, so for a hard guarantee you can build with
 * RAGO_BLOCK_INTERNET=1 to strip the INTERNET permission (and the debug-only overlay permission) from the
 * manifest. Left off by default because Metro/dev builds need INTERNET and the release build is untested
 * on a device without it (see WEAKNESSES.md).
 */
module.exports = ({ config }) => {
  if (process.env.RAGO_BLOCK_INTERNET !== '1') return config;
  const blocked = new Set(config.android?.blockedPermissions ?? []);
  blocked.add('android.permission.INTERNET');
  blocked.add('android.permission.SYSTEM_ALERT_WINDOW');
  return { ...config, android: { ...config.android, blockedPermissions: [...blocked] } };
};
