/**
 * electron-builder.config.js
 * Icon: place build/icon.ico (Windows) and build/icon.icns (macOS) for custom icon.
 * Branded build: set BUILD_PRODUCT_NAME, BUILD_APP_ID, BUILD_ICON (e.g. icon-other.ico).
 */

const path = require('path')
const fs = require('fs')
const buildDir = path.join(__dirname, 'build')
const hasIcon = (name) => fs.existsSync(path.join(buildDir, name))
const productName = process.env.BUILD_PRODUCT_NAME || 'Loha Studio'
const appId = process.env.BUILD_APP_ID || 'com.flowautomation.app'
// Path relative to buildResources (build/) so electron-builder finds the icon
const iconFile = process.env.BUILD_ICON && hasIcon(process.env.BUILD_ICON) ? process.env.BUILD_ICON : 'icon.ico'
const genericPublishUrl = process.env.AUTO_UPDATE_URL
const githubOwner = process.env.GH_OWNER
const githubRepo = process.env.GH_REPO
const disableWinSignAndEdit = process.env.WIN_SIGN_AND_EDIT === '0'
const publish = genericPublishUrl
  ? [{ provider: 'generic', url: genericPublishUrl }]
  : (githubOwner && githubRepo
      ? [{ provider: 'github', owner: githubOwner, repo: githubRepo, private: false, releaseType: 'release' }]
      : undefined)

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId:       appId,
  productName: productName,
  copyright:   'Copyright © 2025',
  forceCodeSigning: false,

  files: [
    'out/**/*',
    'dist/**/*',
    '!src/**/*',
    '!profiles/**/*',
    '!outputs/**/*',
  ],

  extraResources: [
    {
      from:   'profiles',
      to:     'profiles',
      filter: ['**/*'],
    },
    {
      from:   'build',
      to:     'build',
      filter: ['*.ico', '*.icns'],
    },
  ],

  directories: {
    output:         'release',
    buildResources: 'build',
  },
  publish,

  win: {
    target: [
      { target: 'nsis', arch: ['x64'] },
      { target: 'zip', arch: ['x64'] },
    ],
    icon: hasIcon(iconFile) ? iconFile : undefined,
    // Enable by default so installed app .exe gets custom icon.
    // Set WIN_SIGN_AND_EDIT=0 only if your environment cannot extract winCodeSign cache.
    signAndEditExecutable: !disableWinSignAndEdit,
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    installerIcon: hasIcon(iconFile) ? iconFile : undefined,
    uninstallerIcon: hasIcon(iconFile) ? iconFile : undefined,
  },

  // ── macOS ─────────────────────────────────────────────────
  mac: {
    target: 'dmg',
    icon: hasIcon('icon.icns') ? 'build/icon.icns' : undefined,
  },
}