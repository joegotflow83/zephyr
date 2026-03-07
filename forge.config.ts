import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { version } from './package.json';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

// Conditionally load DMG maker only on macOS and only if appdmg is available
// Note: MakerDMG requires 'appdmg' to be installed as a dev dependency
let MakerDMG: any = null;
if (process.platform === 'darwin') {
  try {
    // First check if appdmg is available
    require.resolve('appdmg');
    // Only then import MakerDMG
    MakerDMG = require('@electron-forge/maker-dmg').MakerDMG;
  } catch (error) {
    console.warn('⚠️  MakerDMG not available - appdmg not installed. Only ZIP will be created for macOS.');
    console.warn('   To enable DMG creation, install appdmg: npm install --save-dev appdmg');
  }
}

const config: ForgeConfig = {
  packagerConfig: {
    asar: {
      // Native .node addons cannot be loaded from inside an asar archive.
      // Unpack them so Electron can require() them at runtime.
      unpack: '**/*.node',
    },
    name: 'Zephyr Desktop',
    executableName: 'zephyr-desktop',
    appBundleId: 'com.zephyr.desktop',
    appCategoryType: 'public.app-category.developer-tools',
    icon: './resources/icon',
    // App metadata
    appCopyright: 'Copyright © 2026 ralph',
    appVersion: version,
    // macOS code signing and notarization (only in CI when APPLE_ID env var is set)
    ...(process.platform === 'darwin' && process.env.APPLE_ID
      ? {
          osxSign: {} as unknown as true,
          osxNotarize: {
            appleId: process.env.APPLE_ID,
            appleIdPassword: process.env.APPLE_ID_PASSWORD!,
            teamId: process.env.APPLE_TEAM_ID!,
          },
        }
      : {}),
  },
  rebuildConfig: {},
  publishers: [
    {
      name: '@electron-forge/publisher-github',
      config: {
        repository: {
          owner: 'joegotflow83',
          name: 'zephyr',
        },
        prerelease: false,
        draft: true,
      },
    },
  ],
  makers: [
    // Windows - only on win32
    ...(process.platform === 'win32' ? [
      new MakerSquirrel({
        name: 'zephyr-desktop',
        authors: 'ralph',
        description: 'Zephyr Desktop - AI loop execution manager with Docker integration',
        setupIcon: './resources/icon.ico',
        iconUrl: 'https://raw.githubusercontent.com/joegotflow83/zephyr/master/resources/icon.ico',
      }),
    ] : []),
    // macOS - only on darwin
    ...(process.platform === 'darwin' ? [
      // Include DMG maker only if appdmg is available
      ...(MakerDMG ? [
        new MakerDMG({
          name: 'Zephyr Desktop',
          icon: './resources/icon.icns',
          background: undefined,
          format: 'ULFO',
        }),
      ] : []),
      // Always include ZIP maker for macOS
      new MakerZIP({}, ['darwin']),
    ] : []),
    // Linux - only on linux
    ...(process.platform === 'linux' ? [
      new MakerRpm({
        options: {
          name: 'zephyr-desktop',
          productName: 'Zephyr Desktop',
          genericName: 'AI Loop Execution Manager',
          description: 'Zephyr Desktop - AI loop execution manager with Docker integration',
          categories: ['Development'],
          icon: './resources/icon.png',
        },
      }),
      new MakerDeb({
        options: {
          name: 'zephyr-desktop',
          productName: 'Zephyr Desktop',
          genericName: 'AI Loop Execution Manager',
          description: 'Zephyr Desktop - AI loop execution manager with Docker integration',
          categories: ['Development'],
          icon: './resources/icon.png',
          maintainer: 'ralph',
          homepage: 'https://github.com/joegotflow83/zephyr',
        },
      }),
    ] : []),
  ],
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/main/index.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/main/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
