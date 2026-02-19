/**
 * macOS Notarization Hook for Electron Forge
 *
 * This script is called by Electron Forge during the packaging process
 * to notarize the macOS application with Apple.
 *
 * Requirements:
 * - macOS 10.13.6 or later
 * - Xcode Command Line Tools
 * - Apple Developer account
 * - App-specific password for notarization
 *
 * Environment variables required:
 * - APPLE_ID: Your Apple ID email
 * - APPLE_ID_PASSWORD: App-specific password (not your Apple ID password)
 * - APPLE_TEAM_ID: Your Apple Developer Team ID
 */

const { notarize } = require('@electron/notarize');
const path = require('path');

/**
 * Notarize the macOS application
 * @param {Object} context - Forge build context
 */
module.exports = async function notarizeApp(context) {
  const { electronPlatformName, appOutDir } = context;

  // Only notarize on macOS
  if (electronPlatformName !== 'darwin') {
    console.log('Skipping notarization: not building for macOS');
    return;
  }

  // Check if running in CI with required credentials
  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_ID_PASSWORD;
  const appleTeamId = process.env.APPLE_TEAM_ID;

  if (!appleId || !appleIdPassword || !appleTeamId) {
    console.warn('⚠️  Skipping notarization: Apple credentials not provided');
    console.warn('   Set APPLE_ID, APPLE_ID_PASSWORD, and APPLE_TEAM_ID environment variables');
    console.warn('   to enable automatic notarization.');
    return;
  }

  const appName = context.packager.appPaths.appPath;
  const appPath = path.join(appOutDir, `${appName}.app`);

  console.log(`Notarizing ${appPath}...`);

  try {
    await notarize({
      appPath,
      appleId,
      appleIdPassword,
      teamId: appleTeamId,
      // Use notarytool (faster than legacy altool)
      tool: 'notarytool',
    });

    console.log('✅ Notarization complete');
  } catch (error) {
    console.error('❌ Notarization failed:', error);
    throw error;
  }
};
