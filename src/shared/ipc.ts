// Types shared by the main process, preload bridge and renderer.

export interface CassetteFile {
  path: string
  /** File name without the .4trk extension. */
  name: string
  data: Uint8Array
}

/** Commands the main process (menu, Finder) sends to the renderer. */
export type Command =
  | { type: "new" }
  | { type: "open" }
  | { type: "load"; file: CassetteFile }
  | { type: "save"; saveAs?: boolean; then?: "close" }

export type ConfirmResult = "save" | "discard" | "cancel"

export interface DocumentState {
  path: string | null
  dirty: boolean
}

export interface WriteRequest {
  data: Uint8Array
  /** Current file path; null for a cassette that was never saved. */
  path: string | null
  saveAs: boolean
}

export interface DesktopApi {
  onCommand(handler: (command: Command) => void): () => void
  ready(): void
  setDocumentState(state: DocumentState): void
  confirmDiscard(action: string): Promise<ConfirmResult>
  openDialog(): Promise<CassetteFile | null>
  write(req: WriteRequest): Promise<string | null>
  closeWindow(): void
  cancelClose(): void
}
