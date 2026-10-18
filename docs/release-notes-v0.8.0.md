## v0.8.0 — 免安裝 Node 的完整包 + 一鍵更新 / Self-contained Packages + One-click Update

Windows 與 Linux 安裝包現在自帶 Node.js，解壓縮後雙擊即可使用；程式內新增「版本與更新」，可檢查更新、驗證 SHA256 後一鍵更新，且不會動到你的專案與設定。

Windows and Linux packages now bundle Node.js: unzip and double-click. The new Version and updates panel checks for releases, verifies SHA256, and updates in one click without touching your projects or settings.

---

## Added / 新增

- **Self-contained Windows and Linux packages**: `win-x64.zip` and `linux-x64.tar.gz` include the Node.js 24 LTS runtime and production dependencies; no Node install or `npm install` on first run. The Node download is checked against the official SHASUMS256.txt when the package is built.
  - Windows 與 Linux 安裝包內建 Node.js 24 LTS 與所需套件，不必先安裝 Node，也不必在第一次啟動時執行 `npm install`。
- **Version and updates panel**: shows the current version, a **Check for updates** button, a short summary of what changed, and an **Update now** button with progress and clear success or failure messages. A badge appears in the top bar when a new version exists.
  - 設定中新增「版本與更新」：顯示目前版本、檢查更新、更新內容摘要與一鍵更新；有新版時頂端會出現提示徽章。
- **Verified updates**: the downloaded package must match the SHA256 published with the release; a mismatch is refused and nothing is changed. Downloads only follow HTTPS links on GitHub, and archives containing unsafe paths or symlinks are rejected.
  - 更新檔會以 SHA256 驗證，不符即拒絕且不做任何變更；只會從 GitHub 的 HTTPS 連結下載，並拒絕含有危險路徑或符號連結的壓縮檔。
- **Your data is never touched by an update**: only program files are replaced. Projects, settings, API keys, exports and `output/` stay as they are. A failed update rolls back to the previous version, and if the computer loses power in the middle, the next start puts the previous version back first.
  - 更新只替換程式檔案；專案、設定、金鑰、匯出檔案都不受影響。更新失敗時會還原為舊版；更新到一半電腦斷電，下次啟動會先把舊版放回去。
- **Automatic check is your choice**: by default the studio checks once when it starts (at most every 6 hours). Turn it off in the same panel; the manual button always works.
  - 預設在啟動時自動檢查更新（最多每 6 小時一次），可在同一面板關閉；手動按鈕隨時可用。
- **SHA256SUMS.txt** is published with every release.
  - 每次發佈都附上 `SHA256SUMS.txt`。

---

## Upgrading / 升級注意

- Versions before 0.8.0 cannot update themselves. Download the 0.8.0 package once; from then on use **Check for updates** inside the app. Your data in `~/.pixiv-to-manga-studio` is picked up automatically.
  - 0.8.0 之前的版本無法自行更新。請手動下載一次 0.8.0，之後即可在程式內更新；你位於 `~/.pixiv-to-manga-studio` 的資料會自動沿用。
- A copy run from source, `npx`, or npm shows "update with git pull" instead of an Update button.
  - 從原始碼、`npx` 或 npm 執行的版本不會顯示更新按鈕，請用 `git pull` 或 `npm update`。
- The old single `portable.zip` still exists for macOS and other systems that already have Node.js 24.
  - macOS 或已安裝 Node.js 24 的系統仍可使用 `portable.zip`。
- Linux packages target glibc distributions. Saving API keys needs the system keychain library `libsecret`.
  - Linux 安裝包適用 glibc 發行版；儲存 API 金鑰需要系統的 `libsecret`。

---

## Validation / 驗證

276 unit tests (79 cover the updater and packaging: version compare, asset pick, SHA256 verification, safe extraction, data protection, recovery after an interrupted update, rollback, the cross-site guard and the re-check of a cached Node runtime), 3 E2E tests, lint and type check all pass. A security review found nothing critical; its three medium and nine low findings were fixed before this build. The Windows package was unzipped into a fresh folder and started from `start-portable.cmd` with its bundled Node; its update check reached GitHub, and update requests from other sites or ports were refused. The update itself (replacing the running Node runtime, then restarting) was run end to end on Windows. The Linux package booted on Ubuntu, and a Linux update continues in the same terminal. Not yet tested: macOS, and saving API keys on a Linux desktop.

276 個單元測試（其中 79 個涵蓋更新與打包：版本比較、安裝包挑選、SHA256 驗證、安全解壓、資料保護、更新中斷後的復原、還原、跨站防護，以及重新核對快取的 Node）、3 個 E2E 測試、lint 與型別檢查皆通過。資安審查沒有發現嚴重問題，指出的 3 個中度與 9 個輕度問題都已在這次打包前修正。Windows 安裝包已解壓到全新資料夾、以 `start-portable.cmd` 用內建的 Node 啟動；更新檢查能連到 GitHub，來自其他網站或其他埠的更新請求都被拒絕；更新本身（替換執行中的 Node 再重啟）在 Windows 上完整跑過。Linux 安裝包已在 Ubuntu 上啟動，Linux 的更新會在同一個終端機裡接著執行。尚未實測：macOS，以及在 Linux 桌面上儲存 API 金鑰。

---

## ⬇️ Which file should I download? / 我該下載哪一個？

**Windows → `pixiv-to-manga-0.8.0-win-x64.zip`** — unzip, double-click `start-portable.cmd`
**Linux → `pixiv-to-manga-0.8.0-linux-x64.tar.gz`** — `tar -xzf`, run `./start-portable.sh`
**macOS / others → `pixiv-to-manga-0.8.0-portable.zip`** — needs Node.js 24 LTS or newer

The in-app updater downloads the matching file by itself; you only download manually the first time.
應用程式內的更新器會自動下載對應檔案；只有第一次需要手動下載。

---

## Checksums

See `SHA256SUMS.txt` attached to this release.
