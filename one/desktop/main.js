const { app, BrowserWindow, Menu } = require("electron");
const path = require("path");

const createWindow = () => {
  const win = new BrowserWindow({
    width: 700,
    height: 800,

    // FIX: minimum size now matches actual content requirements
    minWidth: 660,
    minHeight: 760,

    resizable: false,          // recommended for grid-precise games
    fullscreenable: false,

    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#0a0a0a",

    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      enableRemoteModule: false,
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

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
