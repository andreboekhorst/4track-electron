import { app, BrowserWindow, dialog, ipcMain, Menu, session, shell, systemPreferences } from "electron"
import type { MenuItemConstructorOptions } from "electron"
import { readFile, writeFile } from "node:fs/promises"
import { basename, join } from "node:path"
import type { CassetteFile, Command, ConfirmResult, DocumentState, WriteRequest } from "../shared/ipc"

const EXTENSION = "4trk"
const FILE_FILTERS = [{ name: "4Track Cassette", extensions: [EXTENSION] }]

// The window is just the recorder: its body is 1 : 0.6, plus the lip on top
// that sticks out by 0.5% of the width (see App.svelte).
const WINDOW_RATIO = 0.6 + 0.005

let win: BrowserWindow | null = null
let rendererReady: Promise<void> = Promise.resolve()
let doc: DocumentState = { path: null, dirty: false }
let closeConfirmed = false
let quitting = false
// Files opened from Finder / the Dock before the app finished launching.
const pendingOpenPaths: string[] = []

function createWindow(): BrowserWindow {
  const w = new BrowserWindow({
    width: 1200,
    height: Math.round(1200 * WINDOW_RATIO),
    minWidth: 800,
    title: app.name,
    // Transparent and without a title bar, so only the device itself shows;
    // its rounded corners and lip sit directly on the desktop. The traffic
    // lights go on the casing, in the strip above the top row of controls.
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: true,
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 20, y: 16 },
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
    },
  })
  w.setAspectRatio(1 / WINDOW_RATIO)
  w.once("ready-to-show", () => w.show())
  // macOS derives the shadow of a transparent window from its content's shape;
  // recompute it once the recorder is drawn and whenever its size changes.
  w.webContents.on("did-finish-load", () => setTimeout(() => w.invalidateShadow(), 300))
  w.on("resize", () => w.invalidateShadow())

  rendererReady = new Promise((resolve) => {
    ipcMain.once("renderer:ready", (event) => {
      if (event.sender === w.webContents) resolve()
    })
  })

  w.on("close", (event) => {
    if (closeConfirmed || !doc.dirty) return
    event.preventDefault()
    confirmDiscard(w, "closing").then((choice) => {
      if (choice === "save") sendCommand({ type: "save", then: "close" })
      else if (choice === "discard") forceClose()
      else quitting = false
    })
  })

  // The window title follows the cassette's file name, not the page <title>.
  w.on("page-title-updated", (event) => event.preventDefault())

  w.on("closed", () => {
    win = null
    closeConfirmed = false
    doc = { path: null, dirty: false }
  })

  // Keep external links (e.g. Help) out of the app window.
  w.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: "deny" }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    w.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    w.loadFile(join(__dirname, "../renderer/index.html"))
  }

  return w
}

function forceClose() {
  if (!win) return
  closeConfirmed = true
  win.close()
  if (quitting) app.quit()
}

/** Delivers a menu command to the renderer, opening a window first if needed. */
async function sendCommand(command: Command) {
  if (!win) win = createWindow()
  await rendererReady
  win?.webContents.send("command", command)
}

async function readCassette(path: string): Promise<CassetteFile> {
  const data = await readFile(path)
  return { path, name: basename(path, `.${EXTENSION}`), data: new Uint8Array(data) }
}

async function openPath(path: string) {
  try {
    await sendCommand({ type: "load", file: await readCassette(path) })
  } catch (e) {
    dialog.showErrorBox("Could not open cassette", `${basename(path)}\n\n${(e as Error).message}`)
  }
}

function confirmDiscard(w: BrowserWindow, action: string): Promise<ConfirmResult> {
  const name = doc.path ? basename(doc.path) : "Untitled Cassette"
  return dialog
    .showMessageBox(w, {
      type: "warning",
      message: `Do you want to save the changes to “${name}” before ${action}?`,
      detail: "Your recordings will be lost if you don't save them.",
      buttons: ["Save", "Cancel", "Don't Save"],
      defaultId: 0,
      cancelId: 1,
    })
    .then(({ response }) => (["save", "cancel", "discard"] as const)[response])
}

function updateWindowForDocument() {
  if (!win) return
  win.setTitle(doc.path ? basename(doc.path) : "Untitled Cassette")
  win.setRepresentedFilename(doc.path ?? "")
  win.setDocumentEdited(doc.dirty)
}

function registerIpc() {
  ipcMain.on("document:state", (_event, state: DocumentState) => {
    doc = state
    updateWindowForDocument()
  })

  ipcMain.handle("document:confirm-discard", (_event, action: string) =>
    win ? confirmDiscard(win, action) : "discard",
  )

  ipcMain.handle("cassette:open-dialog", async (): Promise<CassetteFile | null> => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win!, {
      title: "Load Cassette",
      filters: FILE_FILTERS,
      properties: ["openFile"],
    })
    if (canceled || !filePaths[0]) return null
    const file = await readCassette(filePaths[0])
    app.addRecentDocument(file.path)
    return file
  })

  ipcMain.handle("cassette:write", async (_event, req: WriteRequest): Promise<string | null> => {
    let path = req.saveAs ? null : req.path
    if (!path) {
      const { canceled, filePath } = await dialog.showSaveDialog(win!, {
        title: "Save Cassette",
        defaultPath: req.path ?? `Untitled Cassette.${EXTENSION}`,
        filters: FILE_FILTERS,
      })
      if (canceled || !filePath) return null
      path = filePath.endsWith(`.${EXTENSION}`) ? filePath : `${filePath}.${EXTENSION}`
    }
    try {
      await writeFile(path, req.data)
    } catch (e) {
      dialog.showErrorBox("Could not save cassette", `${basename(path)}\n\n${(e as Error).message}`)
      return null
    }
    app.addRecentDocument(path)
    return path
  })

  ipcMain.on("window:close", () => forceClose())
  // The "Save" before closing was cancelled (e.g. Save dialog dismissed): stay open.
  ipcMain.on("window:close-cancelled", () => {
    quitting = false
  })
}

function buildMenu() {
  const template: MenuItemConstructorOptions[] = [
    { role: "appMenu" },
    {
      label: "File",
      submenu: [
        { label: "New Cassette", accelerator: "CmdOrCtrl+N", click: () => sendCommand({ type: "new" }) },
        { label: "Load Cassette…", accelerator: "CmdOrCtrl+O", click: () => sendCommand({ type: "open" }) },
        {
          label: "Open Recent",
          role: "recentDocuments",
          submenu: [{ label: "Clear Menu", role: "clearRecentDocuments" }],
        },
        { type: "separator" },
        { role: "close" },
        { label: "Save Cassette", accelerator: "CmdOrCtrl+S", click: () => sendCommand({ type: "save" }) },
        {
          label: "Save Cassette As…",
          accelerator: "CmdOrCtrl+Shift+S",
          click: () => sendCommand({ type: "save", saveAs: true }),
        },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [{ label: "4Track on GitHub", click: () => shell.openExternal("https://github.com/andreboekhorst/4track.cc") }],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function allowMicrophone() {
  session.defaultSession.setPermissionRequestHandler(async (_wc, permission, callback, details) => {
    if (permission !== "media") return callback(false)
    const wantsAudio = "mediaTypes" in details && details.mediaTypes?.includes("audio")
    if (wantsAudio && process.platform === "darwin") {
      // macOS only shows its prompt while access is "not-determined"; once
      // denied, the request fails silently, so explain how to turn it back on.
      const granted = await systemPreferences.askForMediaAccess("microphone")
      callback(granted)
      if (!granted) explainMicrophoneDenied()
    } else {
      callback(!!wantsAudio)
    }
  })
}

let micDialogOpen = false

async function explainMicrophoneDenied() {
  if (micDialogOpen || !win) return
  micDialogOpen = true
  const { response } = await dialog.showMessageBox(win, {
    type: "warning",
    message: `${app.name} can't use the microphone`,
    detail: app.isPackaged
      ? `Microphone access is turned off for ${app.name}. Turn it on in System Settings → Privacy & Security → Microphone, then try recording again.`
      : "Microphone access is turned off. In development, macOS checks the app you launched it from (e.g. Terminal or Visual Studio Code). Turn it on for that app in System Settings → Privacy & Security → Microphone, then restart it.",
    buttons: ["Open System Settings", "Cancel"],
    defaultId: 0,
    cancelId: 1,
  })
  micDialogOpen = false
  if (response === 0) {
    shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone")
  }
}

// macOS: double-clicking a .4trk in Finder, dropping it on the Dock icon, or Open Recent.
app.on("open-file", (event, path) => {
  event.preventDefault()
  if (app.isReady()) openPath(path)
  else pendingOpenPaths.push(path)
})

app.on("before-quit", () => {
  quitting = true
})

app.whenReady().then(() => {
  registerIpc()
  buildMenu()
  allowMicrophone()
  win = createWindow()
  for (const path of pendingOpenPaths.splice(0)) openPath(path)

  app.on("activate", () => {
    if (!win) win = createWindow()
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})
