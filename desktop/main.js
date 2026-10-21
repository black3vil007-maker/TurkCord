const { app, BrowserWindow, session, desktopCapturer, shell } = require('electron');
const path = require('path');
const http = require('http');
const https = require('https');

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
let mainWindow = null;

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  function createWindow() {
    const iconPath = path.join(__dirname, 'icon.png');

    // Windows 10/11 Discord-style frameless window with dark title bar overlay
    mainWindow = new BrowserWindow({
      width: 1280,
      height: 820,
      minWidth: 960,
      minHeight: 640,
      backgroundColor: '#0d1117',
      title: 'TurkCord',
      icon: iconPath,
      autoHideMenuBar: true,
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: '#0d1117',
        symbolColor: '#8b949e',
        height: 36
      },
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js'),
        backgroundThrottling: false, // Keep WebRTC audio completely active when in background/gaming
        webSecurity: true
      }
    });

    // Permission handler for Microphone, Audio & Screen Capture
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
      const allowed = ['media', 'audioCapture', 'videoCapture', 'display-capture', 'notifications'];
      if (allowed.includes(permission)) {
        callback(true);
      } else {
        callback(false);
      }
    });

    session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
      return true;
    });

    // Native Screen Sharing Request Handler
    if (session.defaultSession.setDisplayMediaRequestHandler) {
      session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
        desktopCapturer.getSources({ types: ['screen', 'window'] }).then((sources) => {
          if (sources.length > 0) {
            callback({ video: sources[0], audio: 'loopback' });
          } else {
            callback(null);
          }
        }).catch((err) => {
          console.error('Screen capture error:', err);
          callback(null);
        });
      });
    }

    // External links open in system browser
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('http:') || url.startsWith('https:')) {
        shell.openExternal(url);
      }
      return { action: 'deny' };
    });

    // Allow Ctrl+R or F5 to reload current page
    mainWindow.webContents.on('before-input-event', (event, input) => {
      if ((input.control && input.key.toLowerCase() === 'r') || input.key === 'F5') {
        mainWindow.reload();
      }
    });

    // DISCORD-STYLE AUTO-SYNC ARCHITECTURE:
    // When desktop app launches, it checks:
    // 1. Local development server (http://localhost:3000)
    // 2. Live production cloud server (https://turk-cord.vercel.app)
    // 3. Bundled offline app files (app/index.html)
    const localDevServer = 'http://localhost:3000';
    const cloudProductionServer = 'https://turk-cord.vercel.app';
    const appHtml = path.join(__dirname, 'app', 'index.html');

    const checkServer = (targetUrl, timeoutMs = 2500) => {
      return new Promise((resolve) => {
        try {
          const client = targetUrl.startsWith('https:') ? https : http;
          const req = client.get(targetUrl, (res) => {
            if (res.statusCode >= 200 && res.statusCode < 400) {
              resolve(true);
            } else {
              resolve(false);
            }
          });
          req.on('error', () => resolve(false));
          req.setTimeout(timeoutMs, () => {
            req.destroy();
            resolve(false);
          });
        } catch (e) {
          resolve(false);
        }
      });
    };

    async function initializeApp() {
      // 1. First check if local dev server is active
      const hasLocalDev = await checkServer(localDevServer, 800);
      if (hasLocalDev) {
        console.log('[TurkCord Desktop] Auto-sync connected to local dev:', localDevServer);
        mainWindow.loadURL(localDevServer);
        return;
      }

      // 2. Check live production server (Vercel) so restarting PC app pulls updates instantly!
      const hasCloudProduction = await checkServer(cloudProductionServer, 3000);
      if (hasCloudProduction) {
        console.log('[TurkCord Desktop] Auto-sync connected to live production:', cloudProductionServer);
        mainWindow.loadURL(cloudProductionServer);
        return;
      }

      // 3. Offline fallback
      console.log('[TurkCord Desktop] Offline fallback to bundled local app...');
      mainWindow.loadFile(appHtml);
    }

    initializeApp();

    mainWindow.on('closed', () => {
      mainWindow = null;
    });
  }

  app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
