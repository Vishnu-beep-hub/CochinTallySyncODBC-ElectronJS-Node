const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");

let mainWindow;
let backendInstance = null;

function createWindow() {
  // Handle both development and production paths
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, "build", "co-icon.ico")
    : path.join(__dirname, "build", "co-icon.ico");

  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Use proper path for both dev and production
  const indexPath = app.isPackaged
    ? path.join(__dirname, "renderer", "index.html")
    : path.join(__dirname, "renderer", "index.html");

  mainWindow.loadFile(indexPath);
}

app.whenReady().then(() => {
  try {
    app.setAppUserModelId("com.tallyconnect");
  } catch (e) {}
  createWindow();

  // Start backend Express server automatically when app starts
  try {
    const server = require("./server");

    // If server exposes start(), use it
    if (server && typeof server.start === "function") {
      try {
        backendInstance = server.start();
        console.log("Backend started from main process via start()");
      } catch (err) {
        console.error("Backend failed to start via start():", err);
      }

      // If server exports an Express `app`, listen on it
    } else if (
      server &&
      server.app &&
      typeof server.app.listen === "function"
    ) {
      const httpServer = server.app.listen(3000, () => {
        console.log(`Backend Express app started on http://localhost:3000`);
      });
      backendInstance = { stop: () => new Promise((r) => httpServer.close(r)) };

      // If server itself is an Express app
    } else if (server && typeof server.listen === "function") {
      const httpServer = server.listen(3000, () => {
        console.log(`Backend started on http://localhost:3000`);
      });
      backendInstance = { stop: () => new Promise((r) => httpServer.close(r)) };
    } else {
      console.warn(
        "Server module does not expose a start() or app.listen(); backend not started",
      );
    }
  } catch (err) {
    console.error("Failed to require server module:", err);
  }

  app.on("activate", function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", function () {
  if (process.platform !== "darwin") {
    // stop backend when app quits
    if (backendInstance && backendInstance.stop) backendInstance.stop();
    app.quit();
  }
});

// IPC handlers (optional controls from renderer)
ipcMain.handle("backend:getUrl", async () => {
  return { url: "http://localhost:3000" };
});

ipcMain.handle("backend:status", async () => {
  return { running: !!backendInstance };
});

ipcMain.handle("backend:stop", async () => {
  if (backendInstance && backendInstance.stop) {
    await backendInstance.stop();
    backendInstance = null;
  }
  return { ok: true };
});
