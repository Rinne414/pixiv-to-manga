const CMD_METACHARACTERS = /[&^%!"]/

/**
 * On Windows the studio is restarted through `cmd /c start`, which misparses these characters in
 * a path. Better to say so before downloading anything than to leave the user with a closed app.
 */
export function assertSafeForCmdRestart(appRoot: string, launcher: string, platform: string = process.platform): void {
  if (platform !== 'win32') return
  if (CMD_METACHARACTERS.test(appRoot) || CMD_METACHARACTERS.test(launcher)) {
    throw new Error(
      'The program folder path contains one of the characters & ^ % ! " which Windows cannot restart safely. Move the folder to a simpler path (for example C:\\PixivToManga) and update again.',
    )
  }
}
