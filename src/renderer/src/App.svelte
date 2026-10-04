<script lang="ts">
  import { FourTrack, type AudioEngine, type LoadStatus } from "4track"
  import type { CassetteFile, Command } from "../../shared/ipc"

  const desktop = window.desktop

  // Every New / Load mounts a fresh <FourTrack> (and with it a fresh
  // AudioEngine), so no state from the previous cassette can leak over.
  let session = $state<{ id: number; file: File | null }>({ id: 0, file: null })

  let save = $state<() => Promise<Blob>>()
  let status = $state<LoadStatus>("idle")
  let loadProgress = $state(0)
  let engine = $state<AudioEngine | null>(null)

  let path = $state<string | null>(null)
  let errorMessage = $state("")
  let busy = false

  // --- Unsaved-changes tracking -------------------------------------------
  // The package has no change events, so a cassette counts as edited when a
  // take was recorded or the mix (volume / pan / master) differs from the
  // last saved or loaded state.
  let recordedSinceClean = $state(false)
  let cleanMix = $state("")

  function mixSnapshot(e: AudioEngine | null) {
    if (!e) return ""
    const tracks = e.tracks.filter((t) => !t.hidden).map((t) => [t.volume, t.pan])
    return JSON.stringify([tracks, e.masterVolume])
  }

  const dirty = $derived(!!engine && (recordedSinceClean || mixSnapshot(engine) !== cleanMix))

  function markClean() {
    recordedSinceClean = false
    cleanMix = mixSnapshot(engine)
  }

  $effect(() => {
    if (engine?.playState === "recording") recordedSinceClean = true
  })

  $effect(() => {
    desktop.setDocumentState({ path, dirty })
  })

  // A cassette that fails to load falls back to a blank one.
  $effect(() => {
    if (status === "error") {
      errorMessage = "Could not load this cassette."
      path = null
      startSession(null)
    }
  })

  // --- Commands from the macOS menu ---------------------------------------
  function startSession(file: File | null) {
    engine = null
    save = undefined
    status = "idle"
    session = { id: session.id + 1, file }
  }

  function handleReady({ engine: e }: { engine: AudioEngine }) {
    engine = e
    markClean()
  }

  /** Asks to save unsaved changes first. Resolves false if the user cancelled. */
  async function okToReplace(action: string): Promise<boolean> {
    if (!dirty) return true
    const choice = await desktop.confirmDiscard(action)
    if (choice === "save") return saveCassette(false)
    return choice === "discard"
  }

  async function saveCassette(saveAs: boolean): Promise<boolean> {
    if (!save || status !== "ready") return false
    const blob = await save()
    const data = new Uint8Array(await blob.arrayBuffer())
    const savedPath = await desktop.write({ data, path, saveAs })
    if (!savedPath) return false
    path = savedPath
    markClean()
    return true
  }

  function loadCassette(file: CassetteFile) {
    errorMessage = ""
    path = file.path
    startSession(new File([file.data as Uint8Array<ArrayBuffer>], `${file.name}.4trk`))
  }

  async function handleCommand(command: Command) {
    if (busy) return
    busy = true
    try {
      switch (command.type) {
        case "new":
          if (await okToReplace("starting a new cassette")) {
            errorMessage = ""
            path = null
            startSession(null)
          }
          break
        case "open":
          if (await okToReplace("loading another cassette")) {
            const file = await desktop.openDialog()
            if (file) loadCassette(file)
          }
          break
        case "load":
          if (await okToReplace("loading another cassette")) loadCassette(command.file)
          break
        case "save": {
          const saved = await saveCassette(!!command.saveAs)
          if (command.then === "close") {
            if (saved) desktop.closeWindow()
            else desktop.cancelClose()
          }
          break
        }
      }
    } finally {
      busy = false
    }
  }

  $effect(() => {
    const off = desktop.onCommand(handleCommand)
    desktop.ready()
    return off
  })
</script>

<main>
  <div class="fourtrack-wrapper">
    {#key session.id}
      <FourTrack
        initialProject={session.file ?? undefined}
        onready={handleReady}
        bind:save
        bind:status
        bind:loadProgress
      />
    {/key}
  </div>

  <div class="status">
    {#if status === "loading"}
      Loading cassette… {Math.round(loadProgress * 100)}%
    {:else if errorMessage}
      <span class="error">{errorMessage}</span>
    {/if}
  </div>
</main>

<style>
  :global(*) {
    box-sizing: border-box;
    -webkit-user-select: none;
    user-select: none;
  }

  :global(html, body) {
    margin: 0;
    height: 100%;
    overflow: hidden;
  }

  :global(body) {
    font-family: system-ui, sans-serif;
    background: radial-gradient(ellipse at top left, #f4f3ef, #ebeae6);

    &::before {
      content: "";
      position: fixed;
      inset: 0;
      background: radial-gradient(ellipse at center, transparent 60%, rgba(0, 0, 0, 0.2) 100%);
      pointer-events: none;
      z-index: 101;
    }
  }

  main {
    height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }

  /* The recorder is 1 : 0.6; fit it inside the window with room for the status line. */
  .fourtrack-wrapper {
    width: min(100%, calc((100vh - 48px - 32px) / 0.6));
  }

  .status {
    height: 32px;
    padding-top: 12px;
    font-size: 13px;
    opacity: 0.65;
    text-align: center;

    .error {
      color: rgb(120, 20, 20);
    }
  }
</style>
