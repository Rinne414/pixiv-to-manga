## v0.8.1 — 泡泡設定不再被重設 + 本機安全加強 / Bubble Settings Kept + Local Security Hardening

修正改台詞、顏色、樣式或拖動尾巴時，泡泡的位置、大小與樣式被重設的問題。Studio 的 API 與資料資料夾現在只回應這台電腦上的 Studio 頁面，瀏覽器裡的其他網站無法讀取你的專案，也無法把你的 API 金鑰導到別處。同時更新了有安全通報的套件。

Editing a bubble's text, colour, style or tail no longer resets its position, size and style. The studio's API and data folder now answer only the Studio page on this computer, so other websites open in your browser cannot read your projects or redirect your API key. Libraries with security advisories are updated.

---

## Fixed / 修正

- **Editing one bubble setting keeps the others** (0.7.0 and 0.8.0 were affected): changing a line's text, colour, bubble style or lock, a single layout value (X, Y, Scale, Rotation), or dragging the tail saved the bubble back at the page centre with the default size, rotation, style, colour and lock. Each edit now changes only what you edited. Bubbles that were already reset do not come back by themselves; set them once more and they stay.
  - 改泡泡的一項設定時，其他設定不再被重設（0.7.0、0.8.0 受影響）：先前修改台詞的文字、顏色、氣泡樣式或鎖定，改一個版面數值（X、Y、縮放、旋轉），或拖動尾巴，泡泡都會被存回頁面中央，大小、旋轉、樣式、顏色與鎖定也回到預設。現在每次只改你改的那一項。已經被重設的泡泡不會自動恢復，重新調整一次就會保留。
- **API**: a provider update that sends only some fields keeps the rest (the Settings form always sent every field, so the app itself was not affected).
  - API：只送部分欄位的 provider 修改會保留其他欄位（設定表單一向送出全部欄位，程式本身不受影響）。

---

## Security / 安全

- **Only the Studio page on this computer can use the studio**: the server already listened only on 127.0.0.1, but a web page open in your browser could still reach it through DNS rebinding, read your projects, or point an AI provider at its own server and have the studio send your API key there. Every API call and the data folder now accept requests only from the Studio page on this computer; in the Windows and Linux packages, changes must also come from the studio's own port. Opening the studio from a bookmark or a link still works.
  - 只有這台電腦上的 Studio 頁面能使用 Studio：伺服器原本就只在 127.0.0.1 上接受連線，但瀏覽器裡開著的網頁仍可透過 DNS rebinding 連到它，讀取你的專案，或把 AI provider 的網址改成自己的伺服器，讓 Studio 把你的 API 金鑰送過去。現在所有 API 與資料資料夾只接受本機 Studio 頁面的請求；在 Windows 與 Linux 安裝包中，會修改資料的請求還必須來自 Studio 自己的埠。從書籤或連結開啟 Studio 不受影響。
- **Library security updates**: fastify 5.12.7 and its upload parser, sharp 0.35.5 with libvips 1.3.4 (image decoding advisories in libheif and librsvg, which imported images go through), and smaller libraries. `npm audit` reports no known vulnerabilities.
  - 更新有安全通報的套件：fastify 5.12.7 與其上傳解析器、sharp 0.35.5 與 libvips 1.3.4（匯入圖片會經過的 libheif、librsvg 解碼漏洞），以及其他較小的套件。`npm audit` 目前沒有已知漏洞。

---

## Upgrading / 升級

- From 0.8.0: **Settings → Version and updates → Check for updates → Update now**. Your projects, settings and API keys stay.
  - 從 0.8.0：**設定 → 版本與更新 → 檢查更新 → 立即更新**。專案、設定與 API 金鑰都會保留。
- Older than 0.8.0: download the package below once; later versions update from inside the app.
  - 0.8.0 之前的版本：請手動下載一次下方的安裝包，之後即可在程式內更新。

---

## Validation / 驗證

285 unit tests, 36 E2E tests, lint and type check pass on Windows and on Linux (fresh clone, Node 24.22), and GitHub CI is green. New tests check that requests from other sites, including DNS rebinding, are refused, and that a moved, resized and restyled bubble keeps its settings after its text is edited; without the fix that test fails in the browser. The Windows package was unzipped into a fresh folder and started from `start-portable.cmd` with its bundled Node and a separate data folder: the editor flow worked in Chromium, and requests with a foreign host name, from another site, or writes from another port were refused. The Linux package started the same way on Ubuntu (WSL). Not tested: macOS.

285 個單元測試、36 個 E2E 測試、lint 與型別檢查在 Windows 與 Linux（全新 clone、Node 24.22）上皆通過，GitHub CI 也通過。新增的測試確認其他網站的請求（包括 DNS rebinding）都會被拒絕，也確認一個已移動、放大、換過樣式的泡泡在改台詞後設定不變；沒有這次修正時，這個測試在瀏覽器中會失敗。Windows 安裝包已解壓到全新資料夾，用 `start-portable.cmd` 以內建 Node 和獨立的資料資料夾啟動：在 Chromium 中跑過編輯流程，偽造主機名稱、來自其他網站、或從其他埠送出的修改請求都被拒絕。Linux 安裝包以同樣方式在 Ubuntu（WSL）上啟動。尚未實測：macOS。

---

## ⬇️ Which file should I download? / 我該下載哪一個？

**Windows → `pixiv-to-manga-0.8.1-win-x64.zip`** — unzip, double-click `start-portable.cmd`
**Linux → `pixiv-to-manga-0.8.1-linux-x64.tar.gz`** — `tar -xzf`, run `./start-portable.sh`
**macOS / others → `pixiv-to-manga-0.8.1-portable.zip`** — needs Node.js 24 LTS or newer

The in-app updater downloads the matching file by itself; you only download manually the first time.
應用程式內的更新器會自動下載對應檔案；只有第一次需要手動下載。

---

## Checksums

See `SHA256SUMS.txt` attached to this release.
