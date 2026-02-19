import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    name: 'Zephyr Desktop',
    executableName: 'zephyr-desktop',
    appBundleId: 'com.zephyr.desktop',
    appCategoryType: 'public.app-category.developer-tools',
    icon: './resources/icon',
    // App metadata
    appCopyright: 'Copyright © 2026 ralph',
    appVersion: '0.1.0',
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
    // Windows
    new MakerSquirrel({
      name: 'zephyr-desktop',
      authors: 'ralph',
      description: 'Zephyr Desktop - AI loop execution manager with Docker integration',
      setupIcon: './resources/icon.ico',
      iconUrl: 'https://raw.githubusercontent.com/ralph/zephyr-desktop/master/resources/icon.ico',
    }),
    // macOS
    new MakerDMG({
      name: 'Zephyr Desktop',
      icon: './resources/icon.icns',
      background: undefined,
      format: 'ULFO',
    }),
    new MakerZIP({}, ['darwin']),
    // Linux
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
        homepage: 'https://github.com/ralph/zephyr-desktop',
      },
    }),
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
