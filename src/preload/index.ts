import { contextBridge, ipcRenderer } from "electron"
import type { IpcRendererEvent } from "electron"
import type { Command, DesktopApi } from "../shared/ipc"

const api: DesktopApi = {
  onCommand(handler) {
    const listener = (_event: IpcRendererEvent, command: Command) => handler(command)
    ipcRenderer.on("command", listener)
    return () => ipcRenderer.off("command", listener)
  },
  ready: () => ipcRenderer.send("renderer:ready"),
  setDocumentState: (state) => ipcRenderer.send("document:state", state),
  confirmDiscard: (action) => ipcRenderer.invoke("document:confirm-discard", action),
  openDialog: () => ipcRenderer.invoke("cassette:open-dialog"),
  write: (req) => ipcRenderer.invoke("cassette:write", req),
  closeWindow: () => ipcRenderer.send("window:close"),
  cancelClose: () => ipcRenderer.send("window:close-cancelled"),
}

contextBridge.exposeInMainWorld("desktop", api)
