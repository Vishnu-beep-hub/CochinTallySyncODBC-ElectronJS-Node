const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')

let mainWindow
let backendInstance = null

function createWindow () {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    icon: path.join(__dirname, 'public', 'co-icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  mainWindow.loadFile(path.join('renderer', 'index.html'))
}

app.whenReady().then(() => {
  try { app.setAppUserModelId('com.tallyconnect') } catch(e) {}
  createWindow()

  // Start backend Express server automatically when app starts
  try {
    const server = require('./server')
    const PORT = process.env.PORT || 9049

    // If server exposes start(), use it (old behavior)
    if (server && typeof server.start === 'function') {
      server.start().then(inst => {
        backendInstance = inst
        console.log('Backend started from main process via start()')
      }).catch(err => console.error('Backend failed to start via start()', err))

    // If server exports an Express `app`, listen on it
    } else if (server && server.app && typeof server.app.listen === 'function') {
      const httpServer = server.app.listen(PORT, () => {
        console.log(`Backend Express app started on http://localhost:${PORT}`)
      })
      backendInstance = { stop: () => new Promise(r => httpServer.close(r)) }

    // If server itself is an Express app
    } else if (server && typeof server.listen === 'function') {
      const httpServer = server.listen(PORT, () => {
        console.log(`Backend started on http://localhost:${PORT}`)
      })
      backendInstance = { stop: () => new Promise(r => httpServer.close(r)) }

    } else {
      console.warn('Server module does not expose a start() or app.listen(); backend not started')
    }
  } catch (err) {
    console.error('Failed to require server module:', err)
  }

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') {
    // stop backend when app quits
    if (backendInstance && backendInstance.stop) backendInstance.stop()
    app.quit()
  }
})

// IPC handlers (optional controls from renderer)
ipcMain.handle('backend:getUrl', async () => {
  return { url: 'http://localhost:9049' }
})

ipcMain.handle('backend:status', async () => {
  return { running: !!backendInstance }
})

ipcMain.handle('backend:stop', async () => {
  if (backendInstance && backendInstance.stop) {
    await backendInstance.stop()
    backendInstance = null
  }
  return { ok: true }
})
