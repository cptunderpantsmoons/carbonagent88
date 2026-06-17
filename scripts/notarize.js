const { notarize } = require('@electron/notarize');
module.exports = async function(params) {
  if (process.platform !== 'darwin') return;
  if (!process.env.APPLE_ID || !process.env.APPLE_APP_SPECIFIC_PASSWORD) {
    console.log('Skipping notarization: Apple credentials not set');
    return;
  }
  await notarize({
    appBundleId: params.appBundleId,
    appPath: params.appPath,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID,
  });
};