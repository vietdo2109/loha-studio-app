/**
 * electron-builder.config.js
 * Icon: place build/icon.ico (Windows) and build/icon.icns (macOS) for custom icon.
 */

const path = require('path')
const fs = require('fs')
const buildDir = path.join(__dirname, 'build')
const hasIcon = (name) => fs.existsSync(path.join(buildDir, name))
// Path relative to buildResources (build/) so electron-builder finds the icon
const iconFile = 'icon.ico'
const genericPublishUrl = process.env.AUTO_UPDATE_URL
const githubOwner = process.env.GH_OWNER
const githubRepo = process.env.GH_REPO
const disableWinSignAndEdit = process.env.WIN_SIGN_AND_EDIT === '0'
const publish = genericPublishUrl
  ? [{ provider: 'generic', url: genericPublishUrl }]
  : (githubOwner && githubRepo
      ? [{ provider: 'github', owner: githubOwner, repo: githubRepo, private: false }]
      : undefined)

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId:       'com.flowautomation.app',
  productName: 'Loha Studio',
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
    icon: hasIcon('icon.ico') ? iconFile : undefined,
    // Enable by default so installed app .exe gets custom icon.
    // Set WIN_SIGN_AND_EDIT=0 only if your environment cannot extract winCodeSign cache.
    signAndEditExecutable: !disableWinSignAndEdit,
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    installerIcon: hasIcon('icon.ico') ? iconFile : undefined,
    uninstallerIcon: hasIcon('icon.ico') ? iconFile : undefined,
  },

  // ── macOS ─────────────────────────────────────────────────
  mac: {
    target: 'dmg',
    icon: hasIcon('icon.icns') ? 'build/icon.icns' : undefined,
  },
}