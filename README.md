# Peppy — your pocket pal

A cheerful, responsive chat companion built as a Progressive Web App (PWA).

## Run locally

1. Install Node.js 20 or newer.
2. In this folder, run `npm install`.
3. Copy `.env.example` to `.env` and add your OpenAI API key.
4. Run `npm run dev` and open the local URL printed by Vite (normally `http://localhost:5173`).

The API key is read by the server and is never sent to the browser. API usage may incur charges on the OpenAI account associated with the key. Change `OPENAI_MODEL` in `.env` if you want a different model available to your account.

Normal chat can use OpenAI web search to answer current questions and show cited source links; those questions are sent to OpenAI for search. Search requests may incur OpenAI charges. For structured business hours and an optional establishment photo preview, configure `GOOGLE_MAPS_API_KEY` in `.env` and in Render's environment variables; opening-hours queries are also sent to Google Places, and Places API (New) and billing must be enabled for that Google Cloud project. Without it, Peppy can still search the web, but business hours may be less precise and photo cards are unavailable. Live Google Places details and replies that use them are temporary and are omitted from saved chat history. Do not put either key in browser code.

## What it includes

- Mobile-friendly installable PWA shell with offline app-shell caching.
- Friendly, energetic companion persona for general conversation.
- Saved conversation history and editable personal notes in this browser's local storage.
- Notes are included in the conversation request to personalize answers. Clearing browser site data removes local history and notes.
- Default boundaries for high-stakes advice, crisis support, spirituality, and avoiding harmful assistance.
- Browser-based microphone dictation and optional OpenAI-generated spoken replies.
- Normal chat can search the web and show cited links; optional Google Places lookup adds business hours, website/Maps links and an attributed photo preview when available.
- Chat messages and the message composer use 16px text on desktop and phone layouts across Windows, Ubuntu and hosted installations.
- The reply box shows three lines by default and scrolls internally to the latest text as you type, paste or dictate, without moving keyboard focus or changing your text selection. Longer drafts remain scrollable for review; Enter sends and Shift+Enter adds a line.
- On phone layouts, the reply box follows the last chat message without reserving an empty viewport-height conversation area. Voice controls and companion panels remain below it.
- Opening or refreshing Peppy scrolls to the latest saved message after access checks finish on every platform. Initial positioning is immediate; later chat updates scroll smoothly unless reduced motion is preferred. Empty chats retain the welcome screen.
- New PDF, local-action, research-plan and learning-proposal approval sections automatically open their containing panels, scroll into view below the sticky header and focus their review heading. Reduced-motion preferences are respected. No popup or approval is triggered automatically; inspect the details and explicitly approve or decline.

## Images in chat

The shared Windows, Ubuntu and hosted/phone composer supports **Attach image** and pasting an image from the clipboard into **Your message** when the browser supplies an image file. On phones, use the image picker if clipboard-image paste is unavailable. Attach one PNG, JPEG or WebP up to 4 MiB and 16 megapixels; convert HEIC or other formats first. A removable preview appears before sending. Selecting or pasting does not upload the image or call AI.

Enter a question such as "Transcribe the text" or "What does this picture show?" and press **Send** (or Enter). Image-only messages ask for a description/transcription. Voice-send commands do not send a pending image: review it and explicitly use Send. Sending discloses the image, including any embedded metadata, to OpenAI using the configured model and incurs API charges. The model must support image input; unsupported-model/provider failures are shown, and failed requests restore the draft image for review before any retry. Handwriting, small or blurry text and long documents can produce mistakes or incomplete transcriptions; verify important text. Attaching an image does not fill PDFs or grant tool permissions.

Image bytes remain only in the current page's temporary draft/request state, not browser localStorage chat history or the hosted PDF bucket. Ordinary chat does not attach the image again on later turns; reattach it for another visual inspection. Text prompts and AI replies retain the existing browser-history behavior. In Local assistant mode, the explicitly sent image also remains in the in-memory tool session (30-minute inactivity expiry, subject to the existing session cleanup/restart behavior) for that task's continuation requests; every tool action still requires separate approval. This is not a provider-side deletion guarantee. Reloading discards unsent previews. Each installation must receive the updated source/build; Render must be deployed before phone users see the feature.

### Basic image editing

After attaching or pasting an image, choose **Edit image**. The browser-only editor supports a draggable crop rectangle with eight corner/edge handles on the original image, plus crop percentages (left/top/width/height) for precise adjustment. Drag inside the rectangle to move it; mouse and touch are supported. Focus a handle or the selection and use arrow keys to adjust by 1 percentage point, or Shift+arrow for 10. Crops stay within the original with a minimum 1% width/height. The selection view remains unrotated and without effects; the separate output preview shows the final result. The editor also supports 90-degree rotation, horizontal/vertical flips, brightness, contrast, grayscale, sepia and blur. Changes appear in a checkerboard-backed preview; **Reset edits** restores the starting image and **Cancel image editing** keeps the attachment unchanged.

Enable **Remove matching background colour**, select a colour and adjust tolerance to make matching pixels transparent. This removes that colour throughout the image, including matching areas inside the subject; it does not detect people/objects or perform AI background segmentation. Detailed edges, shadows and multicolour backgrounds may need a specialist editor. Background removal happens before effects. Crop is applied before rotation and screen-axis flips. Some browsers do not support canvas effects; an explicit error blocks export until unsupported effects are reset.

Choose **Download edited PNG** to save a new image locally, or **Use edited image in chat** to replace the temporary attachment. Neither action calls AI or uploads the image, and the original file is untouched. Chat still requires a separate Send action and retains its 4 MiB/16-megapixel limits; PNG export can be larger than the original JPEG, so crop further if necessary. Downloads preserve transparency. The editor is shared by Windows, Ubuntu and phone after each installation/deployment is updated; this feature does not automatically publish or restart installations.

## Voice chat

- Tap the microphone beside Send and allow microphone/speech recognition access. Speak, wait for recognition to finish (or tap Stop), review the transcript, then send it.
- Optionally turn on **Enable "Peppy, send" voice command** (off by default, saved on this browser). While dictating, finish with **Peppy, send** to send the message immediately once recognition confirms the words. The command is removed from the message; an existing typed draft is included. An empty message is never sent. Without this option, dictated words always remain in the draft for review. Recognition can mishear you; leave the option off if you want to review every message.
- This is not a wake word: you must tap the microphone first. The command only works while recognition is active, not in the background, and does not automatically restart the microphone after a reply.
- Tap the speaker button to enable automatic spoken replies. The preference is saved on this browser; it starts off. Use **Read last reply** to replay a response or **Stop speaking** to interrupt it.
- Choose **Peppy's voice** and use **Preview voice** to hear a sample. Marin is the default; Marin and Cedar are recommended for quality. The selected voice is saved on this browser. Changing voices cancels current playback.
- Starting the microphone stops playback so Peppy does not dictate its own voice. Leaving the tab or starting a new chat stops microphone input and playback.
- Phone microphone access requires **HTTPS**. A plain `http://192.168...` development URL will not work; `localhost` is allowed for development on the computer itself.
- Speech recognition support varies. Try Chrome on Android or Safari on iPhone with speech recognition enabled; some browsers, installed PWAs, and devices do not support it. Text chat remains available. Some phones require tapping **Read last reply** before audio can play.
- Microphone recognition uses the browser's speech service and language settings. It may need an internet connection and may send audio to the browser provider; it is not guaranteed to run on-device.
- Spoken replies use `/api/speech` on the server with the existing `OPENAI_API_KEY`, and send reply text to OpenAI. The voice is AI-generated, not human. Every preview and replay requests new audio and incurs speech API charges in addition to normal chat charges. Turning off automatic spoken replies does not disable manually requested previews or replays.
- Speech defaults to `gpt-4o-mini-tts`; optionally set `OPENAI_SPEECH_MODEL` to a compatible model supporting the same speech endpoint, voices, and instructions. Your API project needs speech-model access and billing credit. Speech failures are shown without losing the text reply. Requests are limited to 4096 characters; longer replies remain readable as text.
- OpenAI currently documents a January 6, 2027 shutdown for `gpt-4o-mini-tts`. Before that date, migrate the speech integration to the recommended Realtime API workflow; simply changing the model name to a Realtime model will not work. See the [OpenAI speech guide](https://developers.openai.com/api/docs/guides/text-to-speech).

Chats and notes currently stay in the browser, but messages are sent to the configured model provider when you chat. This starter does not include user accounts or sync between devices. Before making it public, add sign-in, per-user rate limits, and an appropriate production hosting and privacy setup.

## Personal local assistant (Windows and opt-in Ubuntu VM)

This is a separate **local-only** mode. It does not connect Render or your phone to your computer, and never exposes tool endpoints through the hosted server. It is a restricted tool runner, **not an OS sandbox**. Do not use it for hostile files/sites or against an adversary who can concurrently change the authorized filesystem.

1. Run `npm install` and `npx playwright install chromium`.
2. Store an OpenAI key using `powershell -NoProfile -File .\localCredentials.ps1`. This prompts securely in the terminal, not chat, and saves a Windows-user-encrypted key under `%LOCALAPPDATA%\Peppy`. Alternatively, use `powershell -NoProfile -File .\localCredentials.ps1 -ImportEnv` to copy the existing local `.env` key into encrypted storage without displaying it or deleting `.env`. Local mode does not read the plaintext `.env` key at runtime. The encrypted key is usable only by the same Windows user on that computer.
3. Run `npm run build`, then `npm run local`.
4. Open **http://127.0.0.1:3030** on this computer. The exact address is required for the local session/Host/Origin checks. Turn on **Local assistant — files and websites** in the chat.
5. Give an instruction, inspect the proposed action and file diff, then approve or decline. **Every tool action needs approval**, including reads. Inspect the local result before clicking **Send result to AI and continue**. That sends the selected result to OpenAI; do not continue if it contains anything you do not wish to share.

The initial authorized root is `D:\` as requested, and the initial website is `https://www.google.com`. A whole drive is a broad permission: a dedicated working folder is strongly recommended. Stop local Peppy and edit `.peppy-local/config.json` to narrow/change `roots`. Application code, companion configuration, common credential paths, system directories, executables, symbolic links/junctions and hard-linked files are blocked. Credential detection is heuristic, not a guarantee: avoid authorizing folders containing secrets. This does not override other Windows users' permissions or isolate the process from your Windows account.

### Website permissions

Expand **Authorized folders, websites and action log** to add/remove exact HTTPS origins manually. These changes are saved locally; start a new chat before changing permissions. Paths, wildcard domains, credentials, non-HTTPS and private-network destinations are not allowed. Redirects and subdomains must be authorized separately.

Peppy can propose **request_website_access** when a task needs another site. Approving that card grants only the exact origin for the current task (30-minute inactivity expiry), not a saved/global grant. Approving website access does not approve the subsequent page read: review that action separately. DNS targets are checked and pinned for outgoing requests to prevent rebinding to a private destination.

### Tools and limits

- List/search filenames inside authorized folders: maximum 100 results, 1000 visited entries and 5 folder levels. This is not full-drive content indexing.
- Read/create/edit/move/delete supported text files up to 64 KiB. Writes show a diff; stale previews are rejected if the file changed. Moves and downloads never overwrite destinations. No shell commands, executable files, directory deletion or system-setting changes.
- Changes to existing files save local text backups. Deletion is recoverable via **restore_backup** with the ID shown in the result/log; it is not Windows Recycle Bin. Restoring a moved file's backup does not remove its destination copy. Newly created files can be removed using an approved delete action. Backups/logs are under `.peppy-local` and ignored by Git; they can contain private text and are not encrypted. Keep that directory private and manage retention yourself.
- Website reading uses a fresh isolated Chromium browser with scripts, service workers, cookies/accounts, downloads and non-GET network requests disabled. Unapproved destinations are blocked. Dynamic websites, CAPTCHA and logged-in sites may not work.
- Form filling is deliberately limited: one non-sensitive field is filled in an isolated temporary page, **all network traffic is blocked during filling**, and the browser is discarded. It does not submit or leave a persistent form open. Credentials, payment/login fields, purchases and message sending are unavailable.
- Downloads support direct authorized HTTPS URLs and supported text destinations, capped at 64 KiB; redirects require a new approved action. No binary/executable downloads.
- AI tool proposals and webpage/file contents cannot grant permission. Tool output is framed as untrusted data, action arguments are validated by code, approvals are one-time and expire after 5 minutes, tasks are capped at 12 AI steps, and the last 50 log entries can be viewed in the UI.

Keep ordinary conversation/voice by leaving the Local assistant toggle off. Local mode's API key and selected excerpts still go to OpenAI over its API; local execution does **not** mean offline AI.

### Amazon Australia cart-only workflow

**Current status: experimental.** The corrected sign-in form loads, but manual sign-in did not complete successfully during live validation. The real Amazon cart mutation has not been tested. The live test was paused and its temporary browser closed without adding an item or submitting a purchase. Do not assume fixture-test success means your account/login flow is compatible; do not relax checkout protections to work around it.

Open **Amazon Australia — cart only, no purchases** in the local assistant controls:

1. Click **Authorize Amazon and open manual sign-in**. This separately authorizes `https://www.amazon.com.au` for a temporary visible browser. Type credentials yourself there, never in Peppy chat. Cookies remain in memory, not your normal browser profile or a file.
2. Complete sign-in, then click **Finish manual sign-in** in Peppy. Unsupported login, CAPTCHA and script-dependent flows may fail; do not bypass site checks. Scripts are disabled, and other authentication/payment origins are not authorized.
3. With Local assistant enabled, request an Amazon product preview and quantity (1–10). Approve the product/cart read. It checks the current cart quantity and captures the native product form.
4. Review the product title, displayed price/currency and quantity, then approve the separately proposed **amazon_add_to_cart** action. The exact native form must still match the preview. Only the normal `submit.add-to-cart` POST to the known Amazon buy-box endpoint is permitted once.
5. Peppy verifies the exact expected cart-quantity increase and stops at the cart. If verification fails, the cart may already have changed: inspect it manually and do not retry automatically. Close the Amazon browser to discard login cookies. Purchasing is manual in your normal browser, not supported in the restricted one.

This is a site-specific adapter, not general autonomous shopping. Unknown routes, checkout, Buy Now, addresses/payment forms, messages, downloads and popup windows are blocked. Both request types and exact paths/bodies are checked; redirects are converted to validated document navigations rather than letting the browser follow an unchecked HTTP redirect. Other domains/subdomains are blocked even for assets. Some Amazon page styling and flows may not work. The browser is not an OS sandbox. Changing variants/quantity or moving away after approval requires a new preview; multiple-item/bundled cart forms are not supported.

The automated tests verify purchase-route blocking and the native form/cart flow using a controlled browser fixture. A real account/login/cart flow still needs an explicit per-item live test; passing fixture tests does not prove compatibility with every Amazon page.

### PDFs and deal reports

Experimental PDF tools inspect standard AcroForm fields and fill a new PDF copy, or manually overlay text on non-fillable forms, with browser-rendered page previews. The same manual overlay editor is available in Windows, Ubuntu and authenticated hosted/phone PDF panels after updating each installation. General PDF text extraction, automatic field detection, scanned-document OCR, signatures and arbitrary page editing remain unsupported. A scanned PDF can receive manually positioned text without OCR. Fixture/browser tests do not prove compatibility with the sample questionnaire or every PDF; real-document validation is still required.

For a non-fillable form, inspect/approve the local input (or explicitly upload a hosted PDF), then enable **Place text on a non-fillable PDF**. Enter an answer and font size, and click/tap the top-left position on the desired page. Repeat for other answers/pages; adjust each answer, size and percentage position or remove it before proposing the new copy. Keyboard activation places an answer at 10% from the top/left for subsequent adjustment. Review the draft positions, propose the changes and separately approve saving. Inspect every rendered output page before using/downloading the result: browser draft lettering is approximate, while the saved PDF uses Helvetica. Originals are unchanged. Overlays become permanent page text, not fillable fields, signatures or redaction; placing text over existing content does not remove that content. PDF contents are not sent to OpenAI by these manual actions.

Overlay limits: 100 combined text/image items per output; text answers are single-line, 500 characters each, 6–48 pt. Unsupported characters, invalid pages/positions, credential-like values and text extending beyond the visible page are rejected. Local overlays are tied to the inspected input hash as well as the existing approval expiry and new-destination checks. Hosted overlays use the existing owner-bound, expiring, single-use proposal and private input/output retention workflow. Existing signed/encrypted/XFA restrictions still apply. Automated tests cover normal form filling, local/hosted overlays, unchanged originals, stale approvals, bounds, and rendered placement on cropped pages at 0/90/180/270 degrees; live Ubuntu and deployed hosted validation remain pending.

**Images in PDF copies:** the same placement editor supports PNG/JPEG image stamps on both fillable and non-fillable forms, alongside text overlays and actual form-field values in one approved output. Enable **Place text on a non-fillable PDF** to open the editor even for a fillable PDF, then use **PDF image to place** or paste a file into **Paste PDF image here**. Click/tap the preview for the image's top-left position and adjust its width/height and left/top percentages below; aspect ratio is preserved initially, but independent size controls can stretch it. The preview is included in the existing save-approval workflow, not an automatic write. Use `{}` for field values on flat forms; on fillable forms enter the desired actual fields. Switching source/job clears old field values and overlays.

Limits are 100 total text/image overlays including at most ten images, **512 KiB combined encoded-file bytes** for images and 16 megapixels per image. Resize larger photos first; SVG, WebP and remote image URLs are not accepted by PDF stamping. Embedded PNG transparency is retained. The limit keeps hosted approval records below Firestore's document-size ceiling; image bytes are included in private hosted pending proposals and PDF outputs under the existing retention workflow, not sent to OpenAI. Local proposals/previews remain in companion memory, outputs use approved authorized destinations, and action logs omit image bytes. An image stamp is not a digital signature, verification of identity or redaction; signed/signature-bearing PDFs remain rejected. Existing stale-input, ownership, expiry and no-overwrite checks apply. Browser tests verify rendered image positions across rotated/cropped pages, combined form-field/image output, paste and unchanged originals; actual guest/deployment validation remains pending.

Peppy can use approved website reads to compare deals and propose a Markdown/text report via the existing approved file-write tool. Tell it your country/currency, budget, intended use and priorities. Reports should cite sources, date checked, exact product variants and observed currency, explain suitability and trade-offs, and distinguish unknown shipping/tax/warranty details. This is comparison of the authorized sources actually checked, not a guarantee of the best price across the internet.

### Planned VM document workflow (approved scope, not implemented)

The Ubuntu VMware guest will be a separate document workspace, not a shared view of the Windows drive. Keep VMware shared folders, clipboard sharing, drag/drop and USB disabled. The Windows companion remains a separate host-side tool; its existing folder permissions do not grant the guest access to those folders. NAT provides network connectivity, not complete host/local-network isolation.

The document workflow to build is:

1. **Select and approve an input:** select a specific PDF in an authorized Windows folder. Show its source path, filename, size and the intended guest destination before a separate, one-time transfer approval. Selection does not authorize editing other files or sending document content to an AI service.
2. **Transfer a copy:** the Windows companion transfers only that approved file into a per-task guest input folder through a controlled transfer mechanism, without mounting or sharing `D:\`. Verify file integrity and reject changed inputs or destination collisions; leave the Windows original untouched.
3. **Edit in the guest:** use separate input, working and output folders. Keep the input copy unchanged and produce a new PDF. Preserve intermediate versions and record actions; guest document content cannot authorize host actions.
4. **Review before export:** show a visual preview of the finished PDF and a summary of changes. Stage the exact reviewed output through the controlled transfer mechanism, without saving it to the final Windows destination yet. Treat guest output as untrusted and validate it before preview/export. Neither review nor editing authorizes submission, signing or uploading to a website.
5. **Approve a new Windows copy:** show the reviewed output identity and the exact destination in an authorized Windows folder. Require a separate export approval tied to that output and destination. Reject changes after review and existing destination files rather than overwriting them.
6. **Log and recover:** record transfer/edit/export outcomes and retained version identifiers. Provide an approved way to remove the newly exported copy without touching the original. VM snapshots provide guest recovery, not undo for Windows file changes.

Prerequisites are an updated Ubuntu guest with a clean recovery snapshot, a Linux-compatible Peppy tool runner, PDF tools and a narrowly scoped transfer mechanism. The transfer design still needs selection and implementation; the existing text-only host tools cannot transfer binary PDFs. No guest password or API key should be entered in chat or committed to source code. Any external AI processing of document content requires explicit disclosure and approval.

Acceptance testing must use a copy of the authorized sample questionnaire and verify PDF rendering/form results, unchanged original bytes, transfer integrity, separate input/export approvals, rejection of stale approvals and destination collisions, explicit failure reporting, action logs and recovery. It must also verify that the guest cannot use the transfer mechanism to browse arbitrary host paths or export unapproved files. The complete workflow and automatic transfers remain unavailable; experimental guest-only form tools are described below.

### Step 4 milestone: experimental guest runner and PDF forms

The updated source includes an opt-in Linux companion and PDF inspection/filling. It is **not installed automatically into an existing VM**. The guest installation must receive the updated source and lockfile, install dependencies and pass guest tests before using it. Node 24 (or a supported Node version meeting the PDF viewer's engine requirement) is required. This is a restricted application runner, not another OS isolation boundary.

For a reviewed source-only transfer, exclude `.env`, `.peppy-local`, Git history, `node_modules` and Windows document data. Preserve the guest's private `.env` and guest-only server binding changes when updating source. Do not overwrite guest credentials/configuration. Keep shared folders, clipboard and USB passthrough disabled.

Inside Ubuntu, after the updated source is copied into `~/peppy`:

```bash
cd ~/peppy
npm ci
npx playwright install --with-deps chromium
npm test
npm run build
```

Run each separately and stop on failure. Stop the previous chat service, then start the new companion manually first:

```bash
systemctl --user stop peppy.service
PEPPY_VM=1 NODE_ENV=development ~/.local/node/bin/node localServer.js
```

Open **http://127.0.0.1:3030** in Ubuntu Firefox. Unlike the chat-only server on port 3000, this exposes approved local tools, including a manual **PDF inspection and form filling** panel. Manual PDF actions do not call OpenAI. AI-assisted PDF proposals require the configured API key, and results are sent to OpenAI only when the user selects **Send result to AI and continue**. Check form values for private content before doing that.

Linux defaults authorize only `~/peppy-workspace` and create `inputs`, `working` and `outputs` beneath it. An existing Linux config with other roots is rejected. Guest `.env` key loading requires an owned, non-linked regular file with no group/other permissions (`chmod 600 .env`); storage remains plaintext. Windows mode continues using Windows-encrypted credentials. Render/production mode still cannot start this companion.

Copy only an explicitly approved test PDF into the guest `inputs` directory through a deliberate transfer; automatic Windows transfer is **not implemented**. In the manual PDF panel:

1. Enter the absolute guest input path, for example `/home/peppy/peppy-workspace/inputs/form.pdf`.
2. Propose inspection, review the path and approve. Inspect the returned exact field names/types/options and every preview page.
3. Enter a different, new destination under `/home/peppy/peppy-workspace/outputs/` and JSON values such as `{"Full name":"Example","Consent":true}` using the actual field names. For a non-fillable PDF, enable **Place text on a non-fillable PDF** and manually position your answers on the inspected preview instead of entering field JSON. Do not invent answers or include credentials.
4. Propose filling, review the destination/values and separately approve. Inspect every rendered output page; success-shaped field values alone are not visual verification.

Limits: 10 MiB input/output, 50 pages, 200 fields, text/checkbox/single-choice fields, five-minute approval expiry, ten temporary previews expiring after 30 minutes. Password-protected files, XFA and signature-bearing forms are rejected. Unsupported characters/options fail explicitly before writing. Stale input approvals, links, unauthorized paths and destination collisions are rejected; output writes use exclusive creation. Originals are never overwritten. Logs omit PDF field contents, but AI task results/UI previews may contain them. Use trusted document copies; parser limits are not a guarantee against hostile PDFs or concurrent guest filesystem modification.

Review is a rendered page-by-page preview, not automatic verification of layout or a permission to export. Automated PDF undo, OCR, Windows exports and the complete recovery workflow remain pending; remove an unwanted guest output manually in Ubuntu Files without deleting the input. Snapshots do not reverse Windows changes.

After manual guest validation, update `~/.config/systemd/user/peppy.service`: change `ExecStart` to `%h/.local/node/bin/node %h/peppy/localServer.js`, replace `Environment=NODE_ENV=production` with `Environment=NODE_ENV=development`, add `Environment=PEPPY_VM=1`, and remove `Environment=PORT=3000` (the companion uses fixed port 3030). Run `systemctl --user daemon-reload` and `systemctl --user restart peppy.service`. Verify status, `ss -ltn 'sport = :3030'` showing only `127.0.0.1:3030`, and startup after a guest reboot. Do not change the Windows or Render service to this VM configuration.

Host validation: `npm run build`, then run `npm test`. To include the built PDF canvas/browser flow, set `PEPPY_PDF_UI_TEST=1` when running tests (PowerShell: `$env:PEPPY_PDF_UI_TEST='1'; npm test`). This checks field appearances and rendered output changes using a generated fixture, not the real questionnaire. Linux guest startup and real-document compatibility still need testing inside Ubuntu.

### Step 4 extension: approved learning and improvement suggestions (initial implementation)

The current source includes a **Learning, knowledge and improvement suggestions** panel shared by the Windows companion, Ubuntu companion and hosted/phone UI. It stores entries and suggestion decisions in browser localStorage, separately per browser/origin, not in a shared server database. Clearing browser data removes this library; it is not encrypted. Installation/deployment of the updated source is required. Previously generated source ISOs do not contain these new changes.

Enter a note and source, preview it, and approve saving; or explicitly send only the entered evidence/source to OpenAI for an AI proposal (API charges), then review before approving. Saving does not authorize inclusion in future chat: each entry starts excluded, and its inclusion checkbox grants that consent separately. A global learning toggle excludes the library; existing legacy name/notes remain separate. Correction retains up to ten old versions and revokes inclusion until reapproved. Deletion removes the entry and its history from future library use, not prior chats or already transmitted data. Search covers saved title/content/source. Knowledge requires an HTTPS source, but the application does not independently verify freshness, truth or contradictions.

Suggestions require an explicit request/evidence submission; proactive/background suggestions are not implemented. The queue records pending, accepted-for-investigation or dismissed decisions. Repeated titles remain suppressed, including dismissed entries. Disabling suggestions prevents creating/accepting new queue proposals. Accepting for investigation merely records intent, never executes development/install actions. This is not a self-updater. Limits are 100 entries, 100 suggestions and 12000 characters of selected library context; credential-bearing values are rejected heuristically, not with guaranteed secret detection.

The broader acceptance requirements remain:

**Approved personal memory and topic knowledge:**

- Suggest useful memories from explicitly authorized interactions, showing the exact proposed content and source before saving. Require explicit approval; do not silently infer/store personal facts or ingest PDFs/email. Mark uncertain observations separately from user-confirmed facts.
- Let the user view, correct, delete, disable and choose which memories are included in AI requests. Avoid automatically retaining sensitive information or credentials. Keep memory authorization separate from file, email and music permissions.
- Add a searchable local library for approved topic notes/research with sources, dates and correction history. Retrieved documents are untrusted context, not instructions or permission grants; flag stale/conflicting information rather than claiming it is verified.
- Explain that this is saved/retrieved context, not retraining the underlying OpenAI model. Local storage does not make AI processing offline; disclose what selected memory/knowledge content will be sent to OpenAI and obtain authorization.
- Before release, test save/decline approval, correction/deletion, disabled-memory behavior, retrieval provenance, stale/conflicting entries, credential rejection and resistance to instructions embedded in stored content.

**Update and modification suggestions:**

- Allow user-requested suggestions and opt-in suggestions based only on authorized retained preferences/task outcomes. Present the evidence, proposed change, expected benefit, privacy/permission implications, risks and a proposed test/rollback plan. Clearly distinguish a hypothesis from a verified defect or an available trusted release.
- Provide a suggestion queue with accept-for-investigation, dismiss and disable controls; avoid repeatedly resurfacing dismissed proposals without new evidence.
- Keep the workflow separate: suggestion, approval to investigate, reviewed development/testing, then a distinct approval to install. A suggestion or investigation approval grants no code-write, package-install or additional tool permissions.
- Peppy cannot rewrite its own code, install generated patches, change approval rules, expand permissions or silently update itself through this feature. Trusted-release installation is a separate future milestone, requiring verified packages, isolated testing, credential protection and recovery.
- Before release, test queue persistence, dismissal, opt-out and permission boundaries. Verify that accepting suggestions cannot execute updates or alter safeguards.

Implement and validate the PDF milestone first, then these extensions independently; none should delay or weaken the document approval/export boundaries.

### Downtime research (approval-driven Windows and Ubuntu companions; live validation pending)

The research panel reports remaining idle time and blocking reasons (unsent draft/image, chat/voice/local approval, pending plan or missing visible-page heartbeat), refreshed every 30 seconds. Keep one Peppy page visible with no unfinished draft/actions. Interactions in visible Peppy tabs share/reset the companion's idle timer. Hidden tabs no longer send heartbeats: previously a second hidden Peppy tab could continually reset the shared timer and prevent a visible idle page from reaching eligibility. A closed/hidden page cannot keep presence alive by itself; the existing 90-second presence expiry remains. Returning to a tab or restarting/reloading starts a fresh inactivity wait.

The Windows and Ubuntu companions include the same opt-in research offers, invitation cards, design and styles after 15 minutes without interaction in a visible, open Peppy page. Render does not expose these research routes. On Windows, build the updated source with `npm run build`, restart `npm run local`, and open **http://127.0.0.1:3030**; the development/hosted server is not the companion. Expand **Downtime research — Windows and Ubuntu**, approve topics and save research settings. Invitation cards and spoken invitations require their separate opt-ins. The existing Windows encrypted API key is used for paid AI requests. A running companion alone does not authorize research, and a closed/hidden page does not trigger autonomous paid calls. Approve up to ten topics or explicitly selected chat excerpts; chats, Gmail, PDFs, local files and personal memories are not automatically inspected.

Each session requires explicit approval for a paid AI planning request, then separate approval of new HTTPS domains, then approval of the exact page list and paid AI analysis. Peppy may propose related ideas only within the approved topics. URLs are unverified model suggestions and may fail. Public pages are read with pinned public DNS using the existing restricted network helper; redirects, credential/query URLs, account/action paths and non-HTML/text downloads are rejected. HTML scripts, forms, embedded content and subsequent network requests are blocked. Website content is untrusted evidence, never permission or instructions. Domain grants apply only to research and can be revoked.

Page-read errors show the failed URL and HTTP response code, with separate guidance for redirects (3xx), denied/sign-in access (401/403), missing/removed pages (404/410), rate limits (429) and website server errors (5xx). Connection/policy failures without a response report that the HTTP status is unavailable and retain the underlying reason. Unsupported content reports its successful HTTP code but explains the HTML/plain-text requirement. Redirects are never followed automatically, access restrictions are not bypassed, and failed reads are not retried automatically. A failed reading step consumes the plan and stops before paid notes analysis; trying again requires a newly approved session and may incur another planning charge.

Limits: five attempted sessions per UTC day (persisted before the AI request, including failures), ten pages per session, 512 KiB fetched per page, 8000 excerpt characters per page, two AI stages per session, 30-minute plan expiry and twenty retained draft batches. This is not a dollar-budget guarantee; approved sessions incur model charges based on usage and can read up to fifty pages daily. Waiting for downtime does not call OpenAI. Closing the page stops later steps after the presence heartbeat expires, not already in-flight requests. Pausing/settings changes discard the pending plan; no self-modification or expansion of permissions is allowed.

Topics, domain approvals, counters and draft notes reside in `.peppy-local/research.json` separately on each computer, without synchronization. This file is not encrypted: keep the Windows installation/state directory private using Windows account/folder permissions; Ubuntu additionally requires an owned file with mode 600. Draft notes must cite exact pages actually read and start uncertain. Review each note before approving it into the browser knowledge library; it starts excluded from AI chat until separately selected. Delete unwanted drafts and revoke unused domains on the panel. Deleting drafts does not delete already approved library entries or undo prior AI disclosure. This is retrieval of reviewed knowledge, not retraining the model. Automated service tests are not real website/model validation; install the new source/build into each companion and validate with harmless topics before claiming live operation.

#### Conversation invitations and separate idea sessions

Opt-in invitation cards let Peppy offer something to discuss without inserting unsolicited chat messages. Each successful research session creates one invitation without an additional AI call (at most five research invitations per UTC day). The card provides uncertain findings for review, a dismiss control and a button to prepare a message about the first finding. Preparing a message does not send it, save knowledge or authorize library inclusion. Pressing Send explicitly discloses that finding to AI for the conversation; other draft notes remain excluded. Draft deletion also removes its invitation. Pending invitations survive restart; dismiss invitations to free the fifty-card capacity.

On Windows and Ubuntu, enabled research/idea invitation cards now appear in the conversation area immediately above the reply composer, rather than only in the companion controls. They remain separate from AI message history and are not automatically disclosed to the model. The same saved invitation switch, review/prepare/dismiss controls and optional paid-voice settings apply. New cards do not automatically move focus or scroll away from your current reading/approval. Polling updates open pages about every 30 seconds; research still requires each existing session/domain/analysis approval. These cards are not pushed to hosted/phone installations.

Separate opt-in idea offers become available after fifteen idle minutes in the visible page, even if browsing research is paused, provided approved topics exist. Each paid idea session requires its own approval and uses only the saved approved topics plus up to ten reviewed knowledge entries explicitly selected for that request. The library is not automatically included; permission here is separate from chat inclusion. Generated ideas are speculative conversation starters, not verified discoveries or model experiences. No website fetching, Gmail/PDF access or automatic chat-history reading occurs. Five additional idea attempts per UTC day are counted persistently before AI (including failures), with one AI request capped at 1200 output tokens and no automatic request retries. Successful idea generation resets its downtime timer. This allowance is separate from the five research sessions, not a combined dollar cap.

Automatic spoken invitations require both the dedicated paid-voice opt-in and the existing Spoken replies switch. Only a short generic invitation is spoken, not unreviewed source contents. Invitations wait while the page is hidden, a draft is being typed, chat/local approvals are active or the microphone/voice is busy. A persistent one-use speech-attempt claim prevents automatic replay on reload or failed playback; browser autoplay restrictions and voice/API failures may prevent audible delivery, with existing voice errors shown. Already-started requests cannot be unbilled by disabling the feature. Invitation cards remain available without speech, and all conversation/idea settings default off.

Release validation: the production build and all 63 automated tests passed on Windows, including built-browser invitation/voice fixtures. On 2026-11-03 the user confirmed the Ubuntu update was installed, then confirmed chat, voice chat and email worked as expected after the update. These are user-confirmed live results, not direct agent inspection or proof that all failure paths work. Live research planning/reading, separate idea sessions, invitation cards, automatic spoken invitations and post-update reboot persistence remain unverified. For future updates, use the verified source ISO and backup/manifest procedure below; preserve the private `.env`, `.peppy-local` and existing companion service. The updater runs dependency installation, build and tests before activation.

Windows parity validation (2026-11-04): the production build and focused research tests passed on Windows, including saved-state restart/replacement, independent installation state, malformed/hard-linked file rejection and the built mobile-width invitation/voice/approval fixture. The Linux-only permission test was skipped on Windows; the existing Ubuntu owner/mode check is retained. No paid research was performed by these tests, and live Windows research/model/voice validation remains pending. Both companions reuse the same React panel and stylesheet rather than separate platform-specific designs.

For live acceptance on each companion, start with one harmless approved topic, leave the visible page untouched for fifteen minutes, and verify that no AI session starts without approval. Approve one research plan, separately approve its proposed domains, then approve reading/analysis. Verify the resulting invitation can prepare (not send) a chat and that saved notes remain excluded from chat. Separately enable idea offers, wait for downtime, approve one paid idea request and check its independent counter. Finally opt into spoken invitations and enable Spoken replies; verify a short invitation plays only when not busy. Real AI/voice requests incur charges. Check Gmail still works and the listener remains `127.0.0.1:3030`; restart/login validation must be repeated after installation. These are acceptance steps, not completed live results.

### Planned Apple Music controls (approved scope, not implemented)

Alongside PDF filling, add microphone-button requests such as "Peppy, play this song by this artist on Apple Music", plus play, pause and skip. Ask for clarification when a track match is ambiguous. An always-listening "Peppy" wake word is outside the first milestone; microphone recognition in the guest browser must be verified separately.

Select and validate an official MusicKit integration or a narrowly scoped browser controller before implementation. Being signed into an ordinary Firefox tab does not automatically authorize or enable Peppy to control it. Authentication/consent must be completed manually, with no Apple password in chat. Full playback depends on subscription, browser/DRM compatibility and the integration's authorization requirements. The current script-free website reader cannot operate the player.

Playback commands may execute under an explicitly enabled, revocable music-control permission; they must not grant file/email access. Block purchases, subscription/account changes, protected-track downloads and DRM bypasses. Test track selection, ambiguity handling, playback controls, permission revocation and visible errors in the actual supported environment before claiming compatibility.

### Gmail desktop monitoring (implemented; live desktop tests confirmed)

UI layout: the message composer sits directly beneath the conversation, followed by voice controls and the expandable companion sections. Gmail, hosted PDFs and local PDF forms use Peppy's warm rounded-card styling, consistent form/button controls, visible keyboard focus, and mobile-sized inputs. Styling does not change monitoring consent, PDF approvals or storage boundaries. Installing the updated source/build is required on each local companion; a hosted deployment is required for the hosted PDF appearance.

The local companion now includes a separate **Gmail desktop notifications** panel. The selected design is independent Ubuntu and Windows monitors, authorized separately, with no VM-to-host relay, shared drives, phone delivery or synchronization. Windows can monitor while Ubuntu is off, provided its own companion is running. This supersedes the earlier proposal for a guest monitor plus Windows receiver. This feature is not installed into the existing guest by editing this repository and is not enabled on Render.

Matching new Gmail messages also create **in-chat Gmail notification cards** above the reply composer on that companion, using the existing saved watch rules and saved preview choice. Generic mode stores only an ID/time; preview mode additionally retains the sanitized sender display name and subject (not email bodies). Up to 50 recent alerts persist in the existing unencrypted private `gmail-state.json`; oldest cards are dropped at capacity. Dismissal removes a card, not the email or desktop notification. Turning previews off through **Enable / resume** scrubs stored sender/subject details; reconnect/disconnect clears cards. Local folder permissions protect this state; no alert content is inserted into AI chat history or sent to OpenAI.

Gmail checks keep their existing 15-minute cadence; open-page status polling displays recorded alerts within about 30 seconds after a check. Alerts can be recorded even if desktop delivery fails; that failure remains visible and the checkpoint is retained for retry, with card IDs deduplicated. A dismissed card can return if desktop delivery of that same message is still awaiting a successful retry. The fictional desktop notification test does not create an email card. Cards do not automatically scroll/focus, read bodies, follow email links, or imply sender identity is trusted. The **Open Gmail** link opens only Gmail's fixed homepage manually. These notifications are Windows/Ubuntu-only, independent per installation, and do not provide phone delivery.

The service requests only `https://www.googleapis.com/auth/gmail.metadata`, not mailbox-modification or body-read permission. It reads profile/history and selected message metadata (`From`, `Subject`, arrival time and labels); Gmail's metadata grant itself is broader than those selected fields. It never uses Gmail search queries, message bodies, snippets, attachments or AI analysis. Only messages added to the inbox after the first enable are eligible, and messages no longer in the inbox when checked are skipped. Existing mail moved into the inbox later is not treated as a new arrival. A sender-name or address match is not authentication of the sender.

 Matches are case-insensitive, literal text (not regular expressions), with one alert per matching message even if several rules match. The initial rule is `Baverstock Oaks` in sender name or subject; users can remove it and add more addresses/text. Empty lists send no email alerts. Saving a rule neither authorizes another mailbox nor enables monitoring. Changes apply at the next check, including outstanding catch-up messages, without resetting the history checkpoint or replaying already processed mail. Rules are stored on this installation, not synchronized to the other desktop.

#### Provision each computer separately

The **My Gmail watch rules** editor supports up to 20 rules: exact sender email address, sender display name contains, subject contains, or sender display name/subject contains. Use **Add Gmail watch rule**, **Edit / Save Gmail watch rule**, **Cancel rule edit**, or **Remove** directly on Peppy's page; no code changes or restart are needed. Matches are case-insensitive, literal text (not regular expressions), with one alert per matching message even if several rules match. The initial rule is `Baverstock Oaks` in sender name or subject. Empty lists send no email alerts. Saving a rule neither authorizes another mailbox nor enables monitoring. Changes apply at the next check, including outstanding catch-up messages, without resetting the history checkpoint or replaying already processed mail. Rules remain separate on each installation.

1. Enable the **Gmail API** in the selected Google Cloud project. Keep the existing hosted Google sign-in scopes separate.
2. In Google Auth Platform, add the Gmail metadata scope to Data Access and keep only the intended test users in Audience while testing. This is a restricted Gmail scope: broader/public distribution can require Google verification and other requirements. External-app Testing mode commonly expires refresh tokens after seven days with Gmail scopes; expect reauthorization, not permanent unattended access.
3. Create a **Desktop app** OAuth client for this installation (prefer separate named Ubuntu and Windows clients, not the Render Web client). Download its configuration privately as `.peppy-local/gmail-client.json` inside that computer's Peppy application. Never paste the download, a token or service-account private key in chat. Do not copy Gmail refresh tokens between installations. Google revocation can affect related grants; verify other connections afterward.
4. On Ubuntu, protect the downloaded file with `chmod 600`, and keep `.peppy-local` private (`chmod 700`). Install `libsecret-tools` and `libnotify-bin` if missing using Ubuntu's package manager. A logged-in desktop, session D-Bus and unlocked Secret Service keyring are required; do not fall back to plaintext credentials or enable monitoring in a headless/lingering service without a supported desktop session.
5. On Windows, use Windows PowerShell with the companion running as your ordinary logged-in desktop user. The included helper stores the Gmail refresh token using DPAPI-backed SecureString encryption under that user's local Peppy application-data directory. It is not portable to another user/machine and is not protection against software running as that same user.
6. Install the reviewed source/build into the intended companion using the existing controlled guest transfer/update process; preserve its private settings and credentials. Run `npm run build`, then `npm run local` (Ubuntu: existing `PEPPY_VM=1` development service configuration). The ordinary chat server and hosted Render server do not provide this local Gmail workflow. Do not change host/VM drive sharing or network exposure.
7. Open `http://127.0.0.1:3030` on that same computer. Use **Send fictional desktop notification test**, and personally confirm the notification appears. The native command returning successfully does not prove a human saw it: Windows notification settings/Focus Assist or Ubuntu Do Not Disturb can suppress it. Windows uses a taskbar notification balloon; Ubuntu uses `notify-send`.
8. Select **Connect Gmail with Google**, complete consent manually in that browser, then choose generic notifications (default) or explicitly allow sender/subject previews. Connecting alone leaves monitoring paused. Select **Enable / resume Gmail monitoring** to establish the first checkpoint and start the 15-minute cadence. The loopback OAuth callback uses one-time browser-bound state and PKCE; the connecting browser must be on the same OS as the companion.

Refresh tokens are held in Windows user encryption or Ubuntu Secret Service only, with no plaintext fallback. The ignored `.peppy-local/gmail-state.json` stores user-entered watch rules (including any addresses/text you add), enabled/preview preferences, history checkpoint, first-enable time, last-success time and transient delivered-message IDs; it never stores the fetched emails' sender/subject/body data. Rules remain after disconnect for reuse; remove them explicitly on the page if no longer wanted. Malformed state is surfaced, not silently reset. Credentials, client downloads, checkpoints, OS notification history and OAuth permissions stay separate from the learning library and file-tool approvals.

Pause retains the checkpoint; resume catches up while Gmail history is still available. History can expire (sometimes sooner than a week), so a history-gap response pauses monitoring and requires explicit approval to restart from now, acknowledging missed alerts. Failed polling/delivery retains the checkpoint for retry and reports an error in the panel. Delivered IDs are persisted during a batch to suppress duplicates on restart; a crash between OS delivery and saving its acknowledgement can still cause a duplicate. There is no exactly-once or guaranteed-visible notification promise. Overlarge catch-up batches fail visibly without advancing the checkpoint. Refresh the panel or use **Check Gmail now** to diagnose; do not erase state as an unreviewed recovery shortcut.

Disconnect pauses checks, attempts Google revocation, removes the local credential and clears the checkpoint. If Google cannot confirm revocation, the panel explicitly directs you to remove the grant in your Google account's third-party connections. Revocation of shared/related Google grants can affect another installation; separate desktop clients are recommended but should not be represented as guaranteed revocation isolation. A later fresh connection starts a new monitoring period. Notifications already shown can remain in OS history.

Validation: `npm run build`, then `npm test`; set `PEPPY_PDF_UI_TEST=1` to also run built-browser Gmail and PDF fixtures. Tests exercise matching, encoded headers, first-enable boundaries, pagination, duplicate suppression, restart/catch-up, expired history, revoked authorization, failed notifications, OAuth state/PKCE/scope checks, plaintext-token exclusion and separate UI consent. The published Gmail milestone passed all 52 automated tests, the build and a zero-vulnerability dependency audit. Source changes alone do not configure or authorize cloud accounts or install the guest service.

#### User-confirmed live validation (2026-11-02 to 2026-11-03, New Zealand time)

- Separate **Peppy Gmail Windows** and **Peppy Gmail Ubuntu** Desktop OAuth clients were created; the Gmail API, metadata scope and intended test user were configured. Consent screens showed labels/headers, not email bodies.
- Windows: the fictional desktop test and a new matching Gmail message both produced visible notifications.
- Ubuntu: the updated source was transferred through the virtual CD, its SHA256 manifest verified, dependencies installed, tests/build passed, and the private Ubuntu client configured. Both fictional and real matching-message notifications were received.
- Ubuntu's user service now starts `localServer.js` with `NODE_ENV=development` and `PEPPY_VM=1`. Its listener was verified as `127.0.0.1:3030`. The user confirmed Gmail tests still worked after reboot/login without manually starting Peppy.
- Text matches allow other words around `Baverstock Oaks`, preserving the contiguous phrase and ignoring case. Each installation retains its own rules and checkpoint.

Windows automatic startup/reboot persistence, live pause/resume/disconnect and revoked/expired-token recovery are not yet user-verified. Those failure paths have automated fixture coverage, not a guarantee of uninterrupted monitoring. Google Testing-mode token expiry and desktop/keyring availability remain operational limitations.

#### Ubuntu companion startup configuration

The current guest uses this user service; the later chat-only startup instructions are legacy and should not replace it:

```ini
[Unit]
Description=Peppy personal assistant

[Service]
Type=simple
WorkingDirectory=%h/peppy
ExecStart=%h/.local/node/bin/node %h/peppy/localServer.js
Environment=NODE_ENV=development
Environment=PEPPY_VM=1
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

Stop a manual companion first, save this in `~/.config/systemd/user/peppy.service`, then run `systemctl --user daemon-reload`, `systemctl --user enable peppy.service` and `systemctl --user restart peppy.service`. Check `systemctl --user status peppy.service --no-pager`, the loopback listener and **Check Gmail now** after login. Keep credentials out of the service and do not enable user lingering.

For a future source-ISO update, stop Peppy and make a private backup of the installation and service configuration first. Backups can include private credentials and must remain protected inside the guest. Verify the disc's `SHA256SUMS` before copying and verify the installed files against the disc's manifest afterward. Earlier ISO copies left owner-owned source files read-only; inspect ownership before granting owner write permission only to listed source files and required destination directories. When reading a Windows-generated manifest in a shell loop, strip carriage returns with `tr -d '\r' < SHA256SUMS` so filenames resolve correctly. Never use blanket recursive permission changes or root-owned source copies to bypass a failed update. Preserve `.env` and `.peppy-local`, and keep Peppy stopped until verification succeeds.

#### One-command approved source-ISO updater

The first updater disc rejected the legitimate `vite.config.js` filename before stopping Peppy because its filename validator did not allow dotted configuration names. The corrected updater accepts safe dotted source basenames while retaining path-traversal/private-path restrictions, and a regression test verifies the actual release source inventory with a Windows CRLF manifest. Use the corrected replacement disc and its new independently supplied checksums; do not bypass manifest verification.

New source discs include `ubuntuUpdate.mjs`. It runs only in Ubuntu as the normal user (never `sudo`), outside Peppy's tool permissions. It does not fetch GitHub code, add guest credentials, change the service unit, enable sharing or schedule updates. You attach the disc and type `UPDATE` for each installation. The existing companion service must already point to `~/peppy/localServer.js` with `PEPPY_VM=1`.

**Trust/bootstrap:** before running code from a new disc, compare the SHA256 of `ubuntuUpdate.mjs` with its independently provided release checksum. The updater also requires the independently provided checksum of `SHA256SUMS`; a manifest stored on the same disc alone does not establish trust. The earlier research-only ISO does not contain this updater; a refreshed disc is required. With the new disc mounted, run in Ubuntu (replace placeholders with the actual mount path and announced manifest checksum):

```bash
"$HOME/.local/node/bin/node" "/media/peppy/PEPPY_UPDATE/ubuntuUpdate.mjs" "/media/peppy/PEPPY_UPDATE" TRUSTED_MANIFEST_SHA256
```

The updater verifies the manifest and allowed source paths/checksums before stopping Peppy. It creates a private staged copy of `~/peppy`, preserving `.env`, `.peppy-local` and other installation data, without reusing generated dependencies/build output. Source files are copied only from the verified manifest and checked again before `npm ci`, build and all tests (including browser fixtures). It then retains the whole previous installation, including dependencies, as a private `~/peppy-backup-*` directory and activates the staged directory. Previously running services are restarted and checked for Ubuntu companion status and a loopback-only `127.0.0.1:3030` listener; a previously stopped service remains stopped.

Failures are reported explicitly. Before activation the original installation remains intact; after activation a failure attempts to put the previous directory back and restore its prior running state. If recovery fails, the updater reports that separately: keep the directories and inspect the service rather than retrying blindly. Failed staging directories remain private as `~/peppy-update-*`; backups and staging copies can contain credentials and must stay inside the guest. No backup is automatically deleted. This is not a power-loss-atomic transaction or a guarantee of application-level health: after success, manually verify Gmail, a harmless research/idea session and voice playback. Rollback may replay an alert if the new version already delivered one before failing. Stop-on-update means Gmail monitoring is temporarily unavailable during dependency installation/build/tests.

Required tools are the existing Node/npm installation, systemd user services, `curl`, `ss` and the existing Playwright Chromium runtime. Missing tools, disk-space failures, linked/unowned installation files and test failures stop the update rather than being bypassed. A lock blocks simultaneous updaters; after an interrupted process, inspect the service and retained directories before manually removing a stale `~/.peppy-update-lock`. Automated temporary-directory fixtures cover checksum rejection, private-data preservation, failed builds, activation rollback, lock handling and preserving a stopped service. The user confirmed the Ubuntu update and working chat/voice/email on 2026-11-03; the exact updater completion output was not supplied, and real Ubuntu recovery/failure-path testing remains pending.

#### Original acceptance scope

Add explicitly authorized, **read-only** Gmail monitoring. The initial rule is a case-insensitive match for **Baverstock Oaks** in either the sender display name or subject of incoming messages. This is a text-match alert, not proof of sender identity; do not treat a matching display name as a trusted sender.

Requested notification destinations are **Ubuntu desktop/Peppy and Windows desktop**. Phone notifications are not currently requested. The selected cadence is **every 15 minutes while the monitoring service is running**, with alerts only for messages arriving after monitoring is first enabled. Delivery now uses independently authorized local monitors rather than a cross-OS receiver. Keep host notifications separate from host file permissions; no shared drive or broadly exposed guest server is required.

Use Gmail OAuth with the least access needed and explicit consent, not passwords in chat or browser credential scraping. Prefer metadata-only access if it satisfies the rule; reading bodies requires an explicitly justified read-only scope. Do not send, delete, archive, mark messages read, download attachments or automatically follow email links. Match locally without sending email content to an AI service; any later AI analysis requires separate disclosure and approval.

Provide pause/disconnect controls, protected token storage, minimal configurable notification previews, duplicate suppression and explicit monitoring/delivery errors. Persist a checkpoint so resumed monitoring can check for missed arrivals without repeatedly alerting for the same message. Each installation requires its own running, authorized companion with Internet and an active desktop session. Windows monitoring does not depend on the VM. This does not promise continuous monitoring or notification delivery to an offline desktop.

Before release, test matching and nonmatching sender/subject cases, case handling, duplicate suppression, restart/catch-up behavior, revoked authorization and separate delivery to both desktops. Verify the granted scope cannot modify Gmail messages. The live results and remaining checks are recorded above; do not equate successful notification tests with complete failure-path validation.

Run `npm test` for voice, speech and local-tool tests. The existing Render build/start commands are unchanged; do not set Render's start command to `npm run local`.

### Deployment targets for expanded Step 4

The user requested Ubuntu, Windows companion and hosted Render/phone feature availability, with **no synchronization between installations**. Shared browser learning/suggestion features can run on all three. Existing PDF filesystem actions require a local companion; hosted PDFs use the separate opt-in private bucket workflow below and never grant Render access to host or guest paths. Apple Music needs developer authorization/credentials and a supported integration and remains unimplemented. Independent local Gmail monitoring and visible notifications are user-verified on Windows and Ubuntu; hosted Gmail and phone alerts are not implemented. Hosted PDF bucket cleanup is user-confirmed; exact expiry timing, cleanup-run Firestore removal, failure validation and real guest-document/export validation remain pending.

Integration decisions: use MusicKit with the user's Apple Developer setup, and a user-configured Google Cloud OAuth application for read-only Gmail. Hosted PDF processing uses an authenticated upload service, not browser-only processing. Hosted access is restricted to the user's explicitly approved account using Google sign-in, with server-validated identity and a server-side session; Gmail permission remains separate. Selected storage is Firestore plus private Google Cloud Storage, targeting regional **us-west1 (Oregon)** near the Render service in Oregon. Authentication, bucket provisioning, successful scheduled cleanup requests and manual PDF upload/fill/download/deletion have been user-confirmed. On 2026-11-05 the user also confirmed cleanup deleted the PDFs from the Cloud Storage bucket; exact expiry timing and matching Firestore cleanup remain unverified. The requested deletion target is **24 hours**, with an immediate-delete control; the implementation's limits are detailed below. Retention must cover temporary files, previews and stored objects; delayed/offline cleanup cannot be presented as completed deletion. Source changes do not provision cloud resources or credentials.

#### Google hosted sign-in: implementation and provisioning

Google authentication is implemented in the hosted server, but requires deployment configuration and live validation. Render automatically requires authentication: missing configuration stops startup rather than exposing the API. Non-Render chat installations retain their existing behavior unless `PEPPY_HOSTED_AUTH=1` is explicitly enabled. Windows/VM companion authentication is unchanged.

The implemented OAuth callback is exactly:

```text
https://peppy-pocket-pal.onrender.com/api/auth/google/callback
```

In Google Auth Platform **Clients**, create an OAuth client of type **Web application**, named `Peppy Render`. Add the above **Authorized redirect URI**. If asked for an authorized JavaScript origin, use `https://peppy-pocket-pal.onrender.com` (this integration uses server-side OAuth). Keep client secrets private. Basic sign-in requests only `openid` and `email`, never Gmail permission.

Provision a Firestore **Native mode / Standard edition**, regional database in `us-west1` with ID `(default)`. Deny browser/mobile SDK access in its security rules: only the backend service identity accesses sessions via IAM. Grant that dedicated identity only the needed Firestore data role (typically Cloud Datastore User), not Owner/Editor. On Render, configure Application Default Credentials privately using a secret file and `GOOGLE_APPLICATION_CREDENTIALS` pointing to its mounted absolute path; keep service-account credentials out of Git, chat, public assets and source ISOs. Prefer keyless workload identity where supported; otherwise protect/rotate the dedicated service key.

Set these Render environment variables privately before deploying the changed server:

```text
PEPPY_PUBLIC_URL=https://peppy-pocket-pal.onrender.com
GOOGLE_CLIENT_ID=<OAuth web client ID>
GOOGLE_CLIENT_SECRET=<OAuth web client secret>
PEPPY_ALLOWED_EMAIL=<exact approved Google account email>
GOOGLE_CLOUD_PROJECT=<project ID>
GOOGLE_APPLICATION_CREDENTIALS=<mounted private credentials file path>
```

Keep `NODE_ENV=production`, `OPENAI_API_KEY` and any chosen model settings. Do not copy literal placeholder values into deployment settings. `PEPPY_ALLOWED_EMAIL` is checked against Google's verified email claim. The backend verifies signed identity tokens/audience using Google's library plus a per-login nonce and PKCE; one-time state is bound to a secure browser cookie. Login-state records expire after ten minutes; opaque sessions expire after eight hours, with hashed cookie identifiers stored in Firestore. Secure HttpOnly cookies, server-side revocation on logout and same-origin mutation checks protect hosted API calls. Public static app assets are not confidential; only APIs require sign-in. Browser-local notes remain on that browser after logout, so do not use a shared OS/browser profile for sensitive notes.

Configure Firestore TTL on `peppy_auth.expiresAt` to eventually remove expired session/login records; TTL may incur charges and deletion is not immediate. Expired records are rejected at access time even before physical cleanup. This TTL is **not** the PDF retention solution. No PDF upload/bucket routes or Gmail tokens are enabled by this milestone.

After deployment, test anonymous API rejection, approved-account login, another account's rejection, logout and replay rejection, session expiry, unavailable database behavior and mobile cookies. Local automated tests use an injected identity client/store, not live Google/Firestore. Do not claim the deployed site is private until deployment and these live checks succeed.

#### Google Cloud provisioning context

The public application URL is `https://peppy-pocket-pal.onrender.com`; a custom domain is not required. In [Google Cloud Console](https://console.cloud.google.com/), create/select a dedicated Peppy project and record its project ID (not a credential). Link billing only after reviewing usage-based charges, and configure a billing budget with alerts; budgets are not spending caps.

Subsequent provisioning will configure Google OAuth, a regional Firestore database and a private Standard-class Cloud Storage bucket in `us-west1`. Database location cannot be changed after creation. Do not select a public bucket, share service-account keys, or configure Gmail scopes as part of basic sign-in.  Keep the approved account identifier and OAuth secrets in private deployment settings.

Scheduled deletion must be independent of a sleeping Render web process. Bucket lifecycle/Firestore TTL are not exact 24-hour deletion guarantees. Soft deletion, object versions, retention policies and backup behavior must be reviewed before uploads are enabled. Authentication implementation, storage permissions and cleanup validation remain prerequisites; creating a project alone does not protect the existing hosted application.

## Production build

### Hosted PDF milestone: private bucket workflow (bucket cleanup user-confirmed)

The source now includes authenticated upload, field inspection, approved fill-to-new-output (AcroForm fields or manual non-fillable text overlays), PDF.js visual preview, attachment download, job recovery/listing and immediate deletion. It is separate from the VM workflow and never calls OpenAI with PDF contents. Standard PDF limits/rejections from the local PDF engine apply. A signed-in session's verified Google subject owns its jobs; changing IDs cannot grant another user access. Original filenames are not used as storage paths. Inputs/outputs stay private and are served through authenticated routes, without public/signed URLs or browser caching.

User-confirmed deployment status (2026-11-02): private bucket and narrow IAM permissions configured; hosted uploads enabled after a successful Scheduler run; fictional PDF uploaded, filled, downloaded and opened with editable values. Immediate deletion removed both live bucket objects and the matching Firestore job record. A second fictional job was left for the 23-hour expiry test.

On 2026-11-05 (New Zealand time), the user confirmed that Google Cloud cleanup worked and the PDF files were deleted from the Cloud Storage bucket. This is user-confirmed live bucket-deletion evidence, not direct agent inspection. Matching Firestore record removal for this cleanup run, exact elapsed deletion time against the 24-hour target, and failure-alert delivery were not separately confirmed. Successful cleanup does not guarantee future runs or deletion during service failures.

Google Cloud budget alerts and a Monitoring email channel/log-based **Peppy PDF cleanup failure** policy were configured. Its filter is `resource.type="cloud_scheduler_job"`, job ID `peppy-pdf-cleanup`, location `us-west1`, and `severity>=ERROR`; notification frequency is 15 minutes. An earlier 502 was followed by a successful execution. Email alert delivery and missing-run detection are not verified; the log alert cannot detect a paused job or absence of executions. Budget alerts are not spending caps.

Uploads are **disabled by default**. Set `PEPPY_PDF_BUCKET` to the private bucket name. Before setting `PEPPY_PDF_ENABLED=1`, configure and validate the independent cleanup job below. A recent successful cleanup heartbeat (within 20 minutes) is additionally required for each upload. Enabling checks the bucket is `us-west1`, uniform-access, public-access-prevention enforced, without object versioning, soft deletion or a retention policy. The backend needs `storage.buckets.get` to check this metadata, in addition to bucket-scoped Storage Object User. Use a narrowly scoped custom role containing only `storage.buckets.get` for this check, not Storage Admin. Existing bucket-only data access does not necessarily include this permission.

Firestore collection `peppy_pdf_jobs` stores owner, expiry, processing status, input/output hashes and pending field proposals; these records can contain proposed form values and are deleted with the job. Do **not** add independent TTL to these job records: deleting them before objects could lose cleanup tracking. `peppy_pdf_operations/cleanup` holds the last successful cleanup timestamp, without document contents. No public SDK rules or broader project-wide storage access are needed.

#### Independent Google Cloud Scheduler cleanup

1. Enable Cloud Scheduler (billing may apply) and create a dedicated service account such as `peppy-pdf-cleanup`. It does not need bucket/Firestore roles: the Render backend performs deletions. Do not create another JSON key.
2. Set `PEPPY_CLEANUP_ACCOUNT` in Render to that service account's exact email. Keep uploads disabled during this setup.
3. Configure an HTTP Scheduler job in `us-west1`, schedule `*/15 * * * *` (every 15 minutes), UTC, method POST, target `https://peppy-pocket-pal.onrender.com/api/maintenance/pdf-cleanup`.
4. Choose **OIDC** authentication using the dedicated cleanup service account. Set the audience to exactly the same endpoint URL, without query parameters. The configuring human needs permission to act as the chosen account; retain the Google-managed Cloud Scheduler service agent's required service-agent role. Do not grant the caller Owner/Editor or send a Google browser-session cookie.
5. Configure retries and a request deadline sufficient for Render cold starts, and monitoring/alerts for non-success responses and missed runs. The selected settings are three retry attempts, maximum retry duration `0s` (count controls retries), minimum backoff `30s`, maximum backoff `120s`, maximum doublings `2`, and attempt deadline `180s`. Duration fields require a unit suffix. A sleeping Render process may wake on a request, but prolonged cold starts, outages, billing issues or revoked credentials can prevent cleanup.
6. Deploy the source with uploads disabled and run the Scheduler job manually. Require a successful HTTP response and a fresh `peppy_pdf_operations/cleanup.lastSuccess` record before enabling uploads. The endpoint rejects missing/invalid identity tokens and tokens for another audience/account. It is deliberately separate from interactive sign-in.

Cleanup deletes job object prefixes before job metadata, retries failed deletions, scans object expiry metadata for interrupted-job/late-write orphans, and only records success after no expired job backlog remains. Do not point other applications at the reserved `pdf/` prefix. Errors do not confirm deletion; inspect failures and retry. Immediate deletion failure remains visible and the job can be retried from **Refresh my document jobs**. Closing a tab does not delete jobs.

Document access expires **23 hours after upload**, not 24 hours after editing, leaving a one-hour buffer for the scheduled physical deletion before the requested 24-hour target. Expired downloads/edits are blocked even if the worker has failed. **This is not a guaranteed 24-hour physical deletion SLA**: infrastructure outages, stalled writes, recoverable provider copies or cleanup failures can delay removal. No highly sensitive live uploads should be accepted until failure alerting and real deletion tests pass; if a strict guarantee is required, keep the feature disabled and establish an appropriate managed retention service/SLA first. GCS lifecycle/Firestore TTL alone are not substituted for this worker.

Before release, verify actual bucket permissions and privacy, anonymous/other-account rejection, stale and duplicate approval rejection, unchanged input hashes, rendered output, attachment download, browser job recovery, immediate deletion, scheduler OIDC rejection, expired access rejection, worker failure/retry behavior and physical removal of job records/objects. Automated tests use injected storage and a real browser fixture, not live Google resources. The current source does not configure Cloud Scheduler, grant IAM permissions, deploy itself or claim real-cloud cleanup has succeeded.

Run `npm run build`, set `NODE_ENV=production`, and start with `npm start`. Serve it over HTTPS to enable PWA installation on mobile devices.

### Ubuntu VM: legacy chat-only automatic startup after login

These instructions document the earlier **Ubuntu guest chat-only setup**, not the Windows companion or Render. The current Gmail/local-tools guest uses the companion service documented above; do not replace it with this chat-only configuration. Prerequisites for the legacy setup: source copied into `~/peppy`, `npm ci`, `npm test` and `npm run build` successful, and Node installed at `~/.local/node/bin/node`. Configure the guest's `.env` separately, restrict it with `chmod 600 ~/peppy/.env`, and never put API keys in this service file, chat or source control. The `.env` is plaintext; snapshots taken after credential setup can contain it.

Run commands inside Ubuntu one at a time, stopping on errors. Host clipboard and folder sharing can remain disabled.

1. Stop any manually started Peppy server with **Ctrl+C** in its Terminal.
2. Restrict the **guest copy** to localhost:

   ```bash
   cd ~/peppy
   nano server.js
   ```

   In the final `app.listen` call, change only the bind address from `'0.0.0.0'` to `'127.0.0.1'`. Save with **Ctrl+O**, **Enter**, and exit with **Ctrl+X**. This limits incoming connections to guest localhost but still permits outgoing OpenAI requests. Do not make this change to the Render copy, which needs `0.0.0.0`.

3. Verify the absolute Node path before configuring startup:

   ```bash
   ~/.local/node/bin/node --version
   ```

   If it fails, stop and resolve the installation path first; the service below depends on it.

4. Create a user service:

   ```bash
   mkdir -p ~/.config/systemd/user
   nano ~/.config/systemd/user/peppy.service
   ```

   Enter:

   ```ini
   [Unit]
   Description=Peppy personal assistant

   [Service]
   Type=simple
   WorkingDirectory=%h/peppy
   ExecStart=%h/.local/node/bin/node %h/peppy/server.js
   Environment=NODE_ENV=production
   Environment=PORT=3000
   Restart=on-failure
   RestartSec=5

   [Install]
   WantedBy=default.target
   ```

   Save with **Ctrl+O**, **Enter**, and exit with **Ctrl+X**. Peppy loads its existing `.env` from the working directory. No API key belongs in this unit.

5. Enable and verify the service, running each command separately:

   ```bash
   systemctl --user daemon-reload
   systemctl --user enable --now peppy.service
   systemctl --user status peppy.service --no-pager
   ```

   Status must show **active (running)**. If it fails, stop and inspect:

   ```bash
   journalctl --user -u peppy.service --no-pager -n 30
   ```

   Check logs for sensitive information before sharing them. An address-in-use error can mean the manually started server is still running.

6. Verify the listening address:

   ```bash
   ss -ltn 'sport = :3000'
   ```

   The listener must be **127.0.0.1:3000**, not `0.0.0.0:3000`, `*:3000` or `[::]:3000`. Open `http://127.0.0.1:3000` in Ubuntu Firefox and verify the interface and a chat response. Terminal can now be closed.

7. Restart Ubuntu normally, log in, and open the same address **without running `npm start`**. Verify the interface and chat again. This confirms startup after login; it does not open Firefox automatically or arrange startup before login. Do not enable user lingering for this setup.

To stop Peppy, run `systemctl --user stop peppy.service`. To start it again, use `systemctl --user start peppy.service`; after guest code/configuration changes, use `systemctl --user restart peppy.service` (rebuild first if frontend code changed). To disable automatic startup and stop it, run `systemctl --user disable --now peppy.service`.

### Deploy on Render

- Create a **Web Service** connected to this repository.
- Build command: `npm ci && npm run build`.
- Start command: `npm start`.
- Set `NODE_ENV=production` and add `OPENAI_API_KEY` as a secret environment variable. Optionally set `OPENAI_MODEL` and `OPENAI_SPEECH_MODEL`.
- Render supplies `PORT`; the server listens on that port on `0.0.0.0`.
- Use Render's HTTPS URL for phone microphone access.

The production SPA fallback uses Express 5's named wildcard `/{*path}`, which matches both `/` and nested page URLs. An unnamed `*` route causes a startup error with Express 5.
l