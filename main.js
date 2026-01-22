// main.js
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");

let mainWindow;
let backendInstance = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    icon: path.join(__dirname, "public", "co-icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Load your frontend (renderer process)
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function startBackend() {
  try {
    const server = require("./server");
    const PORT = process.env.PORT || 9049;

    // Case 1: server exposes start()
    if (server && typeof server.start === "function") {
      server
        .start()
        .then((inst) => {
          backendInstance = inst;
          console.log("Backend started via start()");
        })
        .catch((err) =>
          console.error("Backend failed to start via start()", err),
        );

      // Case 2: server exports an Express app
    } else if (
      server &&
      server.app &&
      typeof server.app.listen === "function"
    ) {
      const httpServer = server.app.listen(PORT, () => {
        console.log(`Backend Express app running at http://localhost:${PORT}`);
      });
      backendInstance = {
        stop: () => new Promise((resolve) => httpServer.close(resolve)),
      };

      // Case 3: server itself is an HTTP server
    } else if (server && typeof server.listen === "function") {
      const httpServer = server.listen(PORT, () => {
        console.log(`Backend started at http://localhost:${PORT}`);
      });
      backendInstance = {
        stop: () => new Promise((resolve) => httpServer.close(resolve)),
      };
    } else {
      console.warn(
        "Server module does not expose start() or app.listen(); backend not started",
      );
    }
  } catch (err) {
    console.error("Failed to require server module:", err);
  }
}

// Electron lifecycle
app.whenReady().then(() => {
  try {
    app.setAppUserModelId("com.tallyconnect");
  } catch (e) {
    console.warn("AppUserModelId not set:", e);
  }

  createWindow();
  startBackend();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    if (backendInstance && backendInstance.stop) {
      backendInstance.stop().then(() => console.log("Backend stopped"));
    }
    app.quit();
  }
});

// IPC handlers for renderer → backend control
ipcMain.handle("backend:getUrl", async () => {
  return { url: "http://localhost:9049" };
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
