// electron-builder afterSign hook: notarizes the signed app with Apple's
// notarytool and staples the ticket, before the .dmg is built from it.
//
// Replaces electron-builder's built-in notarization (mac.notarize: false):
// that one runs `codesign <basename>` and codesign parses "4Track.app" as
// process ID 4 ("No such process"), so any app name starting with a digit fails.

const { execFileSync } = require("node:child_process")
const fs = require("node:fs")
const path = require("node:path")

exports.default = async function notarize(context) {
  if (context.electronPlatformName !== "darwin") return

  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env
  if (!APPLE_ID || !APPLE_APP_SPECIFIC_PASSWORD || !APPLE_TEAM_ID) {
    console.log("  • skipped notarization  reason=APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID not set (see .env.example)")
    return
  }

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  const zipPath = path.join(context.appOutDir, "notarize-upload.zip")

  console.log(`  • notarizing  file=${path.relative(process.cwd(), appPath)} (usually takes a few minutes)`)
  execFileSync("ditto", ["-c", "-k", "--keepParent", appPath, zipPath])

  let result
  try {
    const output = execFileSync(
      "xcrun",
      [
        "notarytool", "submit", zipPath,
        "--apple-id", APPLE_ID,
        "--password", APPLE_APP_SPECIFIC_PASSWORD,
        "--team-id", APPLE_TEAM_ID,
        "--wait",
        "--output-format", "json",
      ],
      { encoding: "utf8" },
    )
    result = JSON.parse(output)
  } finally {
    fs.rmSync(zipPath, { force: true })
  }

  if (result.status !== "Accepted") {
    throw new Error(
      `Notarization ${result.status} (submission ${result.id}). ` +
        `See why with: xcrun notarytool log ${result.id} --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID"`,
    )
  }

  execFileSync("xcrun", ["stapler", "staple", appPath], { stdio: "inherit" })
  console.log(`  • notarized  submission=${result.id}`)
}
