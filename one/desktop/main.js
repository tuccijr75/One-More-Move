const { app, BrowserWindow, Menu, ipcMain } = require("electron");
const path = require("path");

const createWindow = () => {
  const win = new BrowserWindow({
    width: 700,
    height: 800,
    minWidth: 640,
    minHeight: 720,
    show: false,
    backgroundColor: "#0a0a0a",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      enableRemoteModule: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  if (process.platform !== "darwin") {
    win.setMenuBarVisibility(false);
  }

  win.once("ready-to-show", () => {
    win.show();
  });

  win.loadFile(path.join(__dirname, "..", "app", "index.html"));
};

app.whenReady().then(() => {
  if (process.platform === "darwin") {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: app.name,
          submenu: [{ role: "quit" }],
        },
      ])
    );
  } else {
    Menu.setApplicationMenu(null);
  }

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

ipcMain.on("app:quit", () => {
  app.quit();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
