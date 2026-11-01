# Peppy — your pocket pal

A cheerful, responsive chat companion built as a Progressive Web App (PWA).

## Run locally

1. Install Node.js 20 or newer.
2. In this folder, run `npm install`.
3. Copy `.env.example` to `.env` and add your OpenAI API key.
4. Run `npm run dev` and open the local URL printed by Vite (normally `http://localhost:5173`).

The API key is read by the server and is never sent to the browser. API usage may incur charges on the OpenAI account associated with the key. Change `OPENAI_MODEL` in `.env` if you want a different model available to your account.

## What it includes

- Mobile-friendly installable PWA shell with offline app-shell caching.
- Friendly, energetic companion persona for general conversation.
- Saved conversation history and editable personal notes in this browser's local storage.
- Notes are included in the conversation request to personalize answers. Clearing browser site data removes local history and notes.
- Default boundaries for high-stakes advice, crisis support, spirituality, and avoiding harmful assistance.
- Browser-based microphone dictation and optional OpenAI-generated spoken replies.

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

Experimental PDF tools now inspect standard AcroForm fields and fill a new PDF copy, with browser-rendered page previews. General PDF text extraction, scanned-document OCR, signatures and arbitrary page editing remain unsupported. Fixture/browser tests do not prove compatibility with the sample questionnaire or every PDF; guest validation is still required.

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
3. Enter a different, new destination under `/home/peppy/peppy-workspace/outputs/` and JSON values such as `{"Full name":"Example","Consent":true}` using the actual field names. Do not invent answers or include credentials.
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

### Planned Apple Music controls (approved scope, not implemented)

Alongside PDF filling, add microphone-button requests such as "Peppy, play this song by this artist on Apple Music", plus play, pause and skip. Ask for clarification when a track match is ambiguous. An always-listening "Peppy" wake word is outside the first milestone; microphone recognition in the guest browser must be verified separately.

Select and validate an official MusicKit integration or a narrowly scoped browser controller before implementation. Being signed into an ordinary Firefox tab does not automatically authorize or enable Peppy to control it. Authentication/consent must be completed manually, with no Apple password in chat. Full playback depends on subscription, browser/DRM compatibility and the integration's authorization requirements. The current script-free website reader cannot operate the player.

Playback commands may execute under an explicitly enabled, revocable music-control permission; they must not grant file/email access. Block purchases, subscription/account changes, protected-track downloads and DRM bypasses. Test track selection, ambiguity handling, playback controls, permission revocation and visible errors in the actual supported environment before claiming compatibility.

### Planned Gmail monitoring (approved scope, not implemented)

Add explicitly authorized, **read-only** Gmail monitoring. The initial rule is a case-insensitive match for **Baverstock Oaks** in either the sender display name or subject of incoming messages. This is a text-match alert, not proof of sender identity; do not treat a matching display name as a trusted sender.

Requested notification destinations are **Ubuntu desktop/Peppy and Windows desktop**. Phone notifications are not currently requested. The selected cadence is **every 15 minutes while the monitoring service is running**, with alerts only for messages arriving after monitoring is first enabled. The authenticated Windows notification delivery mechanism still needs selection. Keep host notifications separate from host file permissions; no shared drive or broadly exposed guest server is required.

Use Gmail OAuth with the least access needed and explicit consent, not passwords in chat or browser credential scraping. Prefer metadata-only access if it satisfies the rule; reading bodies requires an explicitly justified read-only scope. Do not send, delete, archive, mark messages read, download attachments or automatically follow email links. Match locally without sending email content to an AI service; any later AI analysis requires separate disclosure and approval.

Provide pause/disconnect controls, protected token storage, minimal configurable notification previews, duplicate suppression and explicit monitoring/delivery errors. Persist a checkpoint so resumed monitoring can check for missed arrivals without repeatedly alerting for the same message. Monitoring requires the guest service to be running with Internet access; Windows alerts also require a running authorized host receiver. This does not promise continuous monitoring while the VM is off or delivery to an offline desktop.

Before release, test matching and nonmatching sender/subject cases, case handling, duplicate suppression, restart/catch-up behavior, revoked authorization and separate delivery to both desktops. Verify the granted scope cannot modify Gmail messages. No Gmail connection or notification receiver has been configured yet.

Run `npm test` for voice, speech and local-tool tests. The existing Render build/start commands are unchanged; do not set Render's start command to `npm run local`.

### Deployment targets for expanded Step 4

The user requested Ubuntu, Windows companion and hosted Render/phone feature availability, with **no synchronization between installations**. Shared browser learning/suggestion features can run on all three. Existing PDF filesystem actions require a local companion; hosted PDF support needs a separate upload/browser processing design and must never grant Render access to host or guest paths. Apple Music needs developer authorization/credentials and a supported integration. Gmail on a hosted server needs per-user authentication and protected account/token isolation before any mailbox connection; do not store user Gmail tokens in an unauthenticated shared deployment. Real music/email integration, desktop notification delivery, PDF recovery and guest/document validation are still pending.

Integration decisions: use MusicKit with the user's Apple Developer setup, and a user-configured Google Cloud OAuth application for read-only Gmail. Hosted PDF processing will use an authenticated upload service, not browser-only processing. Hosted access is restricted to the user's explicitly approved account using Google sign-in, with server-validated identity and a server-side session; Gmail permission remains separate. Selected storage is Firestore plus private Google Cloud Storage, targeting regional **us-west1 (Oregon)** near the Render service in Oregon. Provisioning is still required. PDF inputs and outputs must be deleted within **24 hours**, with an immediate-delete control. Retention must cover temporary files, previews and stored objects; delayed/offline cleanup cannot be presented as completed deletion. No provider credentials, hosted account authentication or persistent upload storage have been configured by these source changes.

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

Run `npm run build`, set `NODE_ENV=production`, and start with `npm start`. Serve it over HTTPS to enable PWA installation on mobile devices.

### Ubuntu VM: automatic startup after login

These instructions are for the **Ubuntu guest copy only**, not the Windows companion or Render. They start the chat/speech server, not the planned Linux assistant or PDF tools. Prerequisites: source copied into `~/peppy`, `npm ci`, `npm test` and `npm run build` successful, and Node installed at `~/.local/node/bin/node`. Configure the guest's `.env` separately, restrict it with `chmod 600 ~/peppy/.env`, and never put API keys in this service file, chat or source control. The `.env` is plaintext; snapshots taken after credential setup can contain it.

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