# Initial build verification

## Scroll before copying the post table — 10 November 2026

- **Facebook — Copy post table outerHTML** now awaits the complete **Very fast post table scroll** routine before taking the current table snapshot. It confirms Viewers descending, returns to the top, traverses the table, and copies after eight quiet seconds at the bottom. A table without a vertical scroller can still be copied after sorting is confirmed.
- Escape, the stop command, sort failures, loading stalls, detached or ambiguous tables, and the ten-minute limit leave the clipboard unchanged. The copy step rechecks the table's identity and captures the DevTools `copy` helper before asynchronous work. The snapshot still excludes unloaded rows and rows removed by Meta's virtualization.
- The source-sync helper generates the combined standalone snippet from the scroll source and `scripts/templates/facebook-copy-post-table-html.js`, then updates the bundled library entry and English/Thai instructions. Exact prior defaults upgrade while custom edits, metadata, and Trash remain preserved.
- All 86 focused script tests, the full automated suite, TypeScript, source syntax, and changed-file formatting pass. Local browser inspection confirmed the updated instructions and 18,732-character source in `/scripts`. The combined script was not executed against live Facebook.

## Restarting Viewers scrolling from the bottom — 8 November 2026

- The reported inactive run was already at the table's bottom: Edge measured `scrollTop=12404.999`, `clientHeight=389`, `scrollHeight=12794`, and 157 loaded data rows. Viewers was already descending, with first values 10,431; 3,261; 2,469; 1,632; and 1,518. The former startup retained that bottom position and only retried the boundary.
- Each scrolling run now returns the selected table container to its top after confirming Viewers descending, preserves horizontal position, waits one render tick, then traverses downward. Escape during the reset wait prevents forward scrolling. The script's known-source upgrade and English/Thai instructions were synchronized.
- Verified live in Edge: the updated script reset `12404.999 → 0`; a follow-up measurement confirmed downward movement to `350` while ผู้ชม remained `descending`. Screenshot: `screenshots/facebook-viewers-scroll-restart-edge.png`.
- All **621 tests**, TypeScript, formatting, and the production build pass, including four startup/cancellation regressions for table, panel, and document scrollers. Existing late-detachment guards remain unchanged. No posts were modified.

## Viewers sorting before table scrolling — 8 November 2026

- The post-table scroller now activates the exact **ผู้ชม / Viewers** column in descending order before any scrolling, as required for the user's Content Library workflow. An already active descending sort is retained. An ascending first selection is toggled once after settling; missing, ambiguous, disabled, or unconfirmed sorting stops without scrolling.
- After changing sort, the script polls for up to fifteen seconds and waits for visible data rows, no table loading state, and 500 ms of stable rows, table identity, and sort state. It reacquires replaced tables before selecting a scroll container. Escape and the stop command work during this initial wait, and simultaneous pastes remain blocked.
- Live Microsoft Edge verification began with date sorting (`sort_by=DATE`). The script activated `sort_by=VIEWERS&sorting_method=METRICS_DESCENDING`, logged the confirmed Viewers sort, then began scrolling. Screenshot: `screenshots/facebook-viewers-sort-first-edge.png`. The bundled script and English/Thai instructions were updated through the source-sync helper, preserving exact prior-source upgrades and custom edits.
- All **617 tests**, TypeScript, source formatting, and the production build pass, including thirteen new sort/readiness/cancellation regressions. No posts were changed.

## Content Library scrolling fix verified in Edge — 8 November 2026

- Reproduced the original post-table scroller on the user's Facebook Content Library in Microsoft Edge. It moved the table and loaded a small batch, then exited after only three quiet seconds. The separate outerHTML snippet is a copy-only action.
- Updated the table scroller to visit intermediate rows in instant 90%-viewport steps every 100 ms, retry the bottom with a 2 px up/down movement, and allow eight quiet seconds or thirty seconds without loading progress. It retains Escape/`stopPostTableScroll()`, horizontal position, and the ten-minute cap. Inert inner scroll containers fall back to eligible ancestors; clipping wrappers no longer terminate that search.
- The corrected live Edge run continued from 20 to **157 rendered data rows**, then stopped normally after eight quiet seconds. The copy snippet subsequently passed **2,491,593 characters**, exactly equal to the live table's `outerHTML`, to Edge's original DevTools clipboard helper. This verifies the selected markup and clipboard-helper call; a clipboard paste round-trip was not performed. Loaded row count is not proof of a complete Facebook export. No posts were changed.
- Regenerated the bundled library entry with exact-source migration history, retaining user edits and Trash. All **604 tests**, TypeScript, changed-source formatting, and production build pass. New regressions cover native table targets, real clamped viewport movement, delayed rows, bottom retries, inert inner containers, and outer panels beyond clipping wrappers. Live proof: `screenshots/facebook-table-edge-fixed.png`.

## Post table console tools — 8 November 2026

- Added two shared Facebook entries to `/scripts`: **Very fast post table scroll** and **Copy post table outerHTML**. They identify the supplied Thai Content Library table through its accessible label, with English labels and conservative post/metric header fallbacks. Ambiguous targets stop without selecting an arbitrary table.
- Scrolling targets the nearest suitable vertical table container every 100 ms, preserves horizontal position, and stops with Escape or `stopPostTableScroll()`. Quiet-bottom, stalled-loading, detached-table, duplicate-run, and ten-minute limits are covered. Copying uses the table's exact current `outerHTML`, via DevTools `copy()` or the clipboard API. Neither script changes posts or guarantees that virtualized/unloaded rows are included.
- `node scripts/sync-post-table-scripts.mjs` synchronizes standalone sources with the library entries. Independent migration markers preserve existing data, edits, Trash, removed entries, and imported copies. Known untouched preview source upgrades without overwriting custom metadata.
- All **599 tests**, TypeScript, and the production build pass. New behavior coverage includes nested/document scrolling, hidden and ambiguous tables, loading grace, stop cleanup, exact copied markup, clipboard failures, and library migration preservation. Changed-source formatting passes.
- Browser inspection confirmed both entries in Thai and English, the final 8,887-character scrolling source after migration, and the existing narrow layout. The copy control displayed success, but the browser automation's virtual clipboard returned no data, so a real clipboard round-trip was not verified. Screenshot: `screenshots/scripts-post-table-tools.jpg`. No live Facebook execution or deployment was performed.

## Facebook group cleanup snippet — 7 November 2026

- Added the requested console snippet to `/scripts` without a company association. The standalone source is `public/console-scripts/facebook-remove-vetra-group-posts.js`; `node scripts/sync-group-cleanup.mjs` synchronizes the exact copyable source and usage notes. Seeding preserves other workspace data, custom edits, and Trash, with conflict retries. Known untouched development-preview source upgrades preserve user metadata.
- The supplied HTML identifies VETRA member `61580630981781` in group `197124767711219`. The snippet only operates on that exact member feed and its identifiable group posts, excluding the embedded original Page post. Pasting opens controls without deleting anything. Scanning retains IDs across virtualized cards, then requires manifest review and an exact typed `DELETE <count>` before removal. Pauses vary between 2–4 seconds per action and 5–8 seconds between posts.
- Scanning is bounded by 300 scrolls and 20 minutes; a stable bottom is not a guarantee of completeness. Stop, page changes, hidden tabs, manual intervention, ambiguous identities/controls, and uncertain outcomes halt further actions. Reports distinguish disappearance from independently verified permanent deletion and are downloadable.
- All 381 automated tests pass, including 21 cleanup helper/controller tests and four library-seeding tests. Coverage includes wrong-route refusal, embedded originals, placeholders, partial scans, exact confirmation, stop/navigation during waits, manual intervention, ambiguous menus/dialogs, a successful simulated removal, source equality, data preservation, and concurrent saves. TypeScript, source syntax, changed-source formatting, and the production build pass.
- Browser verification confirmed the entry is present, the editor has no Company input, and actual Copy → paste returns all 22,173 source characters exactly. The library layout was inspected and no browser warnings/errors were captured. The browser automation clipboard read API returned unrelated clipboard contents; the browser's real keyboard paste independently verified the Copy flow without saving changes. Screenshot: `screenshots/facebook-group-cleanup-library.png`.
- No Facebook post was modified. The attachment contained no open delete menu or confirmation dialog; supported English/Thai control wording is conservative and live removal remains unverified. Unsupported controls stop the script rather than being guessed.

## Browser console script library — 6 November 2026

- Added `/scripts` with Facebook, Instagram, and TikTok snippets, company/shared scope, code and description search, platform filtering, pinned-first sorting, duplication, pagination, text export, and individual `.js` downloads. The editor preserves source text, supports Ctrl/Command+Enter saving, and retains drafts through same-document Back/Forward navigation. Stored code is displayed as text and never executed by the workspace.
- Integrated navigation, quick search, JSON backups, and 30-day Trash recovery. Migrated the active browser key to v9 while preserving v8 as a recovery copy. Browser testing exposed an older open v8 tab stripping the new collection on storage events; isolated v9 storage fixes that conflict. Regression coverage verifies subsequent v8 writes cannot overwrite v9 scripts. Refresh older workspace tabs before continuing to edit there; later v8 edits are not automatically merged.
- Browser checks passed for create/edit/reload, exact Unicode and multiline clipboard copying, pinning, duplication, platform filters, shared-company visibility, filtered text export, exact `.js` download, unsaved-change confirmation, retained drafts on Back, two-tab stale-edit rejection with code recoverable, and Trash/restore with code unchanged. The two temporary QA snippets were moved to Trash after testing; the active library is empty.
- Compared downloaded pre/post workspace backups: companies, business types, customers, orders, order sequences, shipping settings, products, groups, destinations, and posts remained identical. The final portable JSON uses workspace format v9 and retains the two QA Trash records. Legacy storage bytes are preserved by regression tests. Browser backup replacement was not performed.
- Inspected English and Thai layouts at narrow mobile sizes (320 and 390 CSS pixels), and checked containment/scaling at 768, 1440, 1920, and 3840. No horizontal page overflow was observed; large-screen root font values match the project rules. Final browser error/warning logs were empty.
- All 356 automated tests pass. TypeScript, changed-source formatting, and the final production build pass. Windows denied one sandboxed build output directory; rerunning the same build with approved filesystem access succeeded. No production deployment or social-platform execution occurred.
- Screenshots: `screenshots/scripts-library-desktop-en.jpg`, `screenshots/scripts-editor-mobile-en.jpg`, and `screenshots/scripts-library-ready-th.jpg`. The populated screenshots use explicitly labeled temporary QA snippets.

## Orders and official carrier labels — 5 November 2026

- Added `/orders`, company-scoped customer/product links, immutable order snapshots, integer-satang THB totals, Bangkok-today defaults, sender settings, selectable carriers (Flash default), manual payment/fulfillment records, tracking, and 30-day order Trash. Customer Units remain separate. Sequential numbers retain high-water marks after Trash expiry.
- Carrier PDFs are validated and stored in IndexedDB with SHA-256 references, retrieved after reload, and combined at their original page sizes. Workspace backups include active and trashed PDFs, stage restoration without writes during preview, reject conflicting content IDs, and commit only after confirmation. Attached labels lock delivery details until removed; booked Flash details stay locked. Training shipments are marked and excluded from real dispatch batches/totals.
- Flash uses the official signed API contract through a disabled-by-default loopback-only server gateway. A durable journal prevents duplicate booking on retry, timeout, or partial writes; PDF retries do not create shipments. COD booking rejects already-paid/refunded orders. User confirmed no Flash API account yet: setup is documented in `docs/SHIPPING.md`; no credentials were installed, no carrier calls/charges occurred, and no live label or pickup was claimed.
- All 334 tests passed, including 19 order-domain, 11 PDF/backup, and 12 mocked shipping tests. TypeScript and the final production build passed without warnings. Changed files were formatted and checked.
- Browser QA used a separate port (3187) with synthetic records. Verified draft save, exact 3 × 199.99 − 10.50 + 40 = 629.47 THB, required-address validation, order/PDF persistence after reload, real file-chooser attachment, batch PDF download, order Trash/restore with the PDF retained, carrier selection, sender-section editing, and unsaved form/settings dismissal. Downloaded PDF was parsed separately: one page, 283.4646 × 510.2362 points (100 × 180 mm). No browser errors/warnings were captured. Portable-backup corruption/collision/round-trip cases were verified by automated tests; no replacement of the user's main workspace occurred.
- Inspected Thai 320px/390px layouts and English desktop layouts, with no page/dialog horizontal overflow. The in-app browser does not render embedded PDF previews reliably, so the print drawer provides an explicit file manifest and download/open actions. Main workspace received no synthetic orders. Screenshots: `docs/screenshots/orders-editor-desktop-en.jpg`, `orders-mobile-th.jpg`.

## Customer summary cards — 5 November 2026

- Centered both summary icons vertically, removed the two `<small>` helper lines, and shortened the purchased-unit label to “Units” / “จำนวนชิ้น”. Counts and filtering behavior are unchanged.
- TypeScript, changed-file formatting, and production build passed. Inspected Thai mobile and English desktop layouts; DOM checks confirmed centered icons and no summary `<small>` elements. No browser errors or warnings were reported. Screenshot: `docs/screenshots/customer-summary-units-desktop.jpg`.

## Today as the calendar default — 5 November 2026

- Every date selector uses the shared CalendarField. Opening an empty picker now preselects Bangkok today; date-and-time pickers also start with the current Bangkok hour and minute. Existing dates remain selected and min/max limits still apply. The default remains a picker draft until Apply; Cancel, Escape, and Clear retain their existing behavior, and unknown saved dates are not automatically filled.
- All eight calendar tests, TypeScript, changed-file formatting, and the production build passed. Browser checks verified today's selected date and immediate Apply, cancellation retaining blank fields, an earlier date surviving reopen/Escape, and the current Bangkok publication date/time. Thai mobile and English desktop layouts were inspected; verification used discarded form drafts, without saving customer or post records.
- Screenshots: `docs/screenshots/calendar-today-default-mobile-th.jpg` and `docs/screenshots/calendar-today-default-desktop-en.jpg`.

## Unknown last-contact dates first — 5 November 2026

- On `/customers`, Last contact: newest now places customers with an unknown last-contact date first, followed by recorded dates from newest to oldest. Existing name tie-breaks and other sort options are preserved.
- All seven customer-list tests, TypeScript, changed-file formatting, and the production build passed. The local preview was restarted. Browser verification was unavailable because reconnecting to the in-app tab failed.

## VETRA Software Facebook groups — 5 November 2026

- Added the 36 supplied Facebook groups through a one-time, revision-checked workspace update. The import reuses the named company's stable ID, creates VETRA Software only when absent, and retains existing group details and Trash. It preserves all supplied names and links: 24 numeric IDs and 12 named links, with no numeric IDs inferred for the named links.
- Named links retained in Posting notes now work with Open group and can be saved with a blank numeric ID. A persisted update marker preserves later edits/removals and prevents repeat imports.
- All 292 tests, TypeScript, production build, and changed-file formatting passed. Regression checks cover exact supplied data, company scoping, deduplication including Trash, JSON/repository persistence, concurrent edits, and safe group links.
- In the local app, verified 36 VETRA Software group cards and 36 Open group links after reload, and saved a named-link group with its blank numeric ID. Inspected English desktop and Thai/English 390px layouts; no browser errors or warnings were reported. Restored the original Thai language preference. No deployment occurred.
- Screenshots: `docs/screenshots/software-groups-desktop.jpg` and `docs/screenshots/software-groups-mobile-th.jpg`.

## Customer edit icon beside the name — 2 November 2026

- Replaced each See More button with a 15px Lucide pencil before the customer name. The icon opens the same Customer Details editor and has a localized customer-specific accessible name, tooltip, visible keyboard focus, and a 44px target. Removed the trailing details column and gave the name/product columns the available space.
- The production build including TypeScript and changed-file formatting passed. In the separate preview, verified mouse activation on a customer with a stretched contact link, keyboard activation on a customer without a link, and Escape dismissal. Both icons preceded their names and each row matched the six table headers. Checked the 390px layout, contained horizontal scrolling, and mobile editing; no new console errors were reported. No customer values were saved during this check.
- Screenshots: `docs/screenshots/customer-edit-icon-desktop.jpg` and `customer-edit-icon-mobile.jpg`.

## Sunday-first calendars — 29 October 2026

- The shared calendar used by customer, post, and metrics date fields now displays Sunday through Saturday in English and Thai. Day-cell placement and Home/End keyboard navigation use the same Sunday-first week; date values and save behavior are unchanged.
- All 286 tests, TypeScript, the production build, and changed-file formatting passed. In the isolated browser preview, October 2026 placed the 1st under Thursday, November 2026 placed the 1st under Sunday, and Home/End moved from 28 October to Sunday the 25th and then Saturday the 31st. Cancelling kept the saved date. English, Thai, and 390px layouts were inspected with no new console errors.
- Screenshots: `docs/screenshots/calendar-sunday-first-en.jpg`, `calendar-sunday-first-th.jpg`, and `calendar-sunday-first-mobile.jpg`.

## Quantity in Customer Details — 29 October 2026

- Selecting a product in Customer Details now reveals a labeled quantity input in its selected-product row. Blank means unrecorded, `0` is a recorded zero, and entries are limited to whole numbers from 0 to 1,000,000. Removing a product also removes its draft quantity. The existing table adjustment dialog and saved customer data format are unchanged.
- The full 286-test suite, TypeScript, production build, and changed-file formatting passed. In an isolated browser preview, selected a product for a disposable customer, entered `3`, saved and reloaded to confirm persistence, then removed the product and confirmed the total returned to its original value. Existing `0` and `1,234` quantities appeared correctly in the editor. Inspected desktop and 390px layouts with no new console errors. The live customer workspace was not edited.
- Screenshots: `docs/screenshots/customer-details-quantity-desktop.jpg` and `customer-details-quantity-mobile.jpg`.

## Table header icon refinement — 29 October 2026

- Reduced the shared post/customer table heading icons from 32px to 28px at the normal root size, thinned their stroke from 1.8 to 1.5, and tightened paired-icon spacing. All headings remain centered, icon-only, and labeled for assistive technology.
- The production build, TypeScript, and changed-file formatting passed. Inspected all six post and seven customer headings in the local browser; each rendered at the intended size with no new console warnings or errors. The customer check used the separate two-record preview because the live customer list was empty. Screenshots: `docs/screenshots/table-icons-refined-posts.jpg` and `table-icons-refined-customers.jpg`.

## Workspace performance review — 29 October 2026

- Removed avoidable work from urgent input and dialog updates: post rows are now a memoized table body with stable callbacks, customer row elements are cached, and catalog/editor/Quick Search lookups, sorting, options, and formatters are reused until their inputs change. Post filter transitions retain the current rows while deferred results are prepared. Unchanged daily-click refreshes reuse their existing state.
- Replaced repeated scans in first-contact customer sorting, reviewed Meta updates, and legacy workspace decoding with per-operation indexes. Validation, migration recovery copies, conflict checks, ambiguous product-name handling, and current v8 product relationships remain intact. Company drag previews now move with transforms and use their actual rendered dimensions for viewport clamping.
- Synthetic checks used equivalent before/after inputs. These measure individual operations on this machine, excluding browser rendering and one-time search-index preparation; they are not end-to-end latency guarantees:

  | Operation                      | Input                               | Before        | After         |
  | ------------------------------ | ----------------------------------- | ------------- | ------------- |
  | First-contact customer sorting | 10,000 customers                    | 221–234 ms    | 16–24 ms      |
  | Applying reviewed Meta changes | 2,000 changes among 10,000 posts    | 51–91 ms      | 1–2 ms        |
  | Workspace decoding             | 10,000 posts, 2,000 groups/products | 123–171 ms    | 36–58 ms      |
  | Quick Search matching          | 10,000 posts                        | 8.07 ms/query | 0.24 ms/query |
  | Catalog search                 | 2,000 products, 500 companies       | 2.35 ms/query | 0.06 ms/query |

- All 286 tests, TypeScript, changed-source/test formatting, and the production build passed. Added regression cases for invalid/future first-contact dates, complete validation before applying Meta changes, preservation of explicit/absent v8 product links, and unchanged/changed daily-click snapshots.
- A separate production preview on port 3101 retained the supplied post fixtures and two disposable QA customers. Browser checks covered post searching/clearing, status filters, editor typing/Escape, pin/unpin, Quick Search keyboard navigation, customer searching/clearing, Customer Details, quantity saves/restoration, catalog matching/empty results, and cancellation retaining the original product. No new runtime warnings or errors were found in the checked flows.
- Every workspace page loaded at desktop width and fit the document at 320px and 768px; inspected post desktop and Thai customer mobile layouts. Existing table/card presentation, centered icon headers, compact elapsed dates, and contained customer-table scrolling remain intact. Pointer drag/drop was source-reviewed rather than exercised with the single-company preview. The live browser workspace on port 3100 was not replaced, and no deployment was performed.
- Screenshot: `docs/screenshots/performance-posts-desktop.jpg`.

## Consistent post and customer list presentation — 29 October 2026

- Both list pages now share panel, heading/action, search/filter, and footer styling. Customers retain their visible-customer and recorded-unit summaries inside the panel. Post CSV import/export actions now sit beside the other post actions. Existing filters, totals, links, dialogs, and save behavior are retained.
- Both tables use a shared icon-only column-heading component with centered 1.75rem Lucide icons (28px at the normal root size), localized tooltips, and screen-reader column names. Removed the post-header emoji and visible labels, including the Viewer/day text; added the missing Customer Details header icon. Header cell padding is aligned. Existing post cards and the customer table's contained horizontal scrolling remain available on small screens.
- All 282 tests, TypeScript, changed-file formatting, and the production build passed. Browser checks covered Thai/English headers, icon dimensions/centering and clipped accessible labels, post/customer searches and clearing, post editor and status dialogs, Customer Details and quantity dialogs, and the compact elapsed-date display. No data was saved through the editors or quantity dialogs during these checks.
- Inspected desktop and narrow layouts and checked document/control containment at widths from 320px through 1920px. A separate localhost preview on port 3101 used two disposable customer records with long names, several products, a retained trashed product, zero/known quantities, and missing details; the existing workspace was not replaced. Temporary development compile errors while the shared files were being written were resolved before the successful build and browser checks. Earlier entries' browser URL-detection limitation no longer applied to this verification.

## Customer search — 29 October 2026

- Search now combines words in any order across customer details, current company/business-type/product names, contact labels/actions, notes, domains, GitHub identities, populated custom-field labels/values, and known purchased-unit quantities. Archived fields and associations retained after company changes remain searchable. Formatted phones accept digit-only searches, and first/last contact, domain expiry, and custom date fields match displayed `DD/MM/YYYY` as well as stored date strings. Thai tone marks and the distinction between unknown and zero quantities are preserved.
- The customer panel caches its search index until relevant data changes and defers text matching while keeping existing rows visible. Added a localized clear button, Escape clearing guarded during IME composition, search guidance, a polite result announcement, and busy states for results/totals. Company/product/date filters, sorting, quantity totals, editor saves, and storage behavior remain intact.
- All 282 tests, TypeScript, changed-file formatting, and the production build passed. Nine new tests cover the saved customer schema, cross-field matching, phone formatting, date-only values, retained custom fields, Unicode/Thai text, quantities, existing filters/sorting, Trash, and backup/data preservation. A synthetic 10,000-customer check built the index in 97 ms, averaged 2.95 ms for matching across 100 queries, and selected/sorted all 10,000 matches in 5.35 ms; these timings exclude browser rendering.
- Inspection covered the customer schema, repository fixtures, editor, and saved-relationship rules. Live browser verification was unavailable following the Computer Use URL-detection failure recorded below; browser-only customer records, rendered responsive layouts, focus behavior, and live typing remain unverified.

## Post library search — 29 October 2026

- Search now combines words across saved/current product names, company and destination names, post/group IDs, links, Bangkok publication dates, Meta source details, publication status, pinned state, and known Viewers/comment totals. Equivalent Unicode and pasted spacing are normalized without stripping Thai tone marks. Equivalent Facebook URLs use the existing permalink normalization rules.
- Search builds an index when workspace data changes and keeps the previous results visible during deferred text updates. Added a keyboard-accessible clear button, Escape clearing with IME composition protection, localized guidance, and an announced result count. Existing company/product/platform/status filters and sorting still apply; no persistence or migration code changed.
- All 273 tests, TypeScript, formatting of changed source/test files, and the production build passed. Nine search tests cover supplied post/Meta fixtures, missing relations, renamed products, long IDs, equivalent links, Bangkok date boundaries, unknown metrics, Trash exclusion, and data preservation. A synthetic 10,000-post check built the index in 44 ms and averaged 0.85 ms per search over 100 queries; this measures matching only, not browser rendering.
- Live browser inspection ended because Computer Use could not establish the current Windows browser URL. Browser-only records, rendered responsive layouts, focus behavior, and typing interactions were therefore not verified in this session. Data inspection covered repository datasets and test fixtures.

## Date-first post updates, dated Pending posts, and comments — 28 October 2026

- Meta updates now match a unique Bangkok publication minute first, then reject any conflict with available Group/Post identity. Ambiguous minutes and conflicting rows stay in the preview for review. A saved post without a known date can still match through an exact post link. A preview using a renamed group matched the correct post by date and showed Viewers and Comments changes without saving them.
- Pending status keeps an entered publication date in the editor, browser storage, JSON backups, CSV, and prepared Mongo documents. In an isolated browser workspace, changing a dated post to Pending and saving kept its date, showed it in the Pending filter, and excluded it from Viewer/day. The post was then restored to Published.
- Added optional comment counts to post storage, CSV, manual editing, and safe Meta table updates. The responsive post list shows Comments immediately before Published, and Edit immediately before today's clicks. Desktop and 390px mobile layouts were visually checked; unknown comment counts show a dash.
- All 241 tests, TypeScript, formatting, and the production build passed.

## Companies and extensible customers — 28 October 2026

- Renamed the managed business concept to Company across schema, UI, filters, catalogs, CSV, history, prepared Mongo/media contracts, and documentation. `/companies` is canonical; `/stores` and the old hash remain compatible. Factual names such as VETRA STORE are preserved.
- Added company-owned customer records, configurable business types, repeatable social/domain/GitHub details, custom typed fields, retained editable details after type changes, and 30-day customer Trash. Storage v8 retains the original v7 recovery copy and migrates all existing IDs and relationships, including legacy Cloudinary paths.
- All 228 tests, TypeScript, formatting, and the production build passed. In an isolated browser workspace, verified the legacy redirect/migration, software-house and retail customer creation, native date entry, reload persistence, custom business type/field creation, dirty-edit confirmation, type changes retaining details, GitHub username search, Trash restore, and a downloaded v8 JSON backup containing both test customers.
- Reviewed desktop and 390px English/Thai layouts, the scrolling customer drawer, mobile business-type settings, and contact-card wrapping. No horizontal card overflow or browser console errors were found. Preview records are test data, not supplied customer records.

## Back to top control — 19 October 2026

- Added a compact icon-only `^` control at the lower right of the workspace after vertical scrolling. It scrolls the page smoothly to the top, respects reduced-motion settings, and has Thai/English accessible names. The control stays out of the tab order when hidden and moves focus to the main content when activated.
- Checked the live mobile-width preview on the Post library: the control appeared after scrolling, returned to the top by mouse and keyboard, and hid at the top. It remains below the temporary toast's stacking layer, with extra clearance on narrow screens. All 210 automated tests, the production build, and formatting checks passed.

## Automatic Meta relative dates — 19 October 2026

- **Update Viewers** now interprets “today” as the current Bangkok calendar date and “yesterday” as one calendar day earlier. The visible table date defaults to today, can be changed for an older snapshot, and can be cleared when the snapshot date is unknown.
- The preview records the resolved table date for the save step, so crossing Bangkok midnight cannot change a reviewed match. Automatic matches still require a unique tracked post with the same group and publication date and minute; ambiguous or conflicting rows remain for review.
- All 210 automated tests, the production build including TypeScript, and formatting checks passed. No browser-local post data was changed by verification.

## Reusable Meta Viewers importer — 17 October 2026

- The Post library now has a bilingual **Update Viewers** dialog for pasted Meta table HTML or an HTML/TXT file. A review step lists each matched post's before/after Viewers total and actual publication date, plus skipped rows. Saving re-reads the workspace and requires the previewed revision.
- Matching uses an exact Facebook group post link or a unique group name and known ICT publication minute. Dates without a year require an explicitly entered publication year before an unknown date can be filled. Relative dates such as “today” remain for review without the source capture date. Duplicate, ambiguous, lower-total, conflicting-date, invalid, and unmatched rows are not applied. Other post fields and previously saved dates are preserved.
- On the supplied 1.9 MB Meta table, the parser recognized 71 existing group posts as unchanged and left 51 rows for review, including Page/untracked rows and one relative-date group row. No records were changed during this check. All 169 tests, TypeScript, formatting, and production build passed; the dialog and English/Thai previews were visually checked in the local browser at a narrow width.

## Pinned posts — 17 October 2026

- A pin button at the start of each post row saves a boolean on the post. Pinned posts lead every sort in the library, overview, Performance, and quick search; the chosen order still applies within pinned and unpinned sections. The button is labeled in Thai and English, keyboard accessible, and visually marks pinned rows.
- Existing records without the field load as unpinned. The flag survives normal edits, local storage, JSON backups, CSV import/export, and prepared MongoDB documents. Concurrent pin/edit saves use revision and post-snapshot checks so stale changes cannot silently undo a pin.
- All 146 automated tests, TypeScript, production build, and formatting checks passed. Live browser visual verification remains unavailable under the browser tool's local-URL policy.

## Data structure migration — 17 October 2026

- v7 browser storage adds stable product and publishing-destination links while retaining each post's product-name snapshot. Existing v6 data migrates on load, and the original v6 key remains an untouched recovery copy. Product IDs are backfilled only for unique exact-name matches; expiring a product clears the link without erasing the saved name.
- Active saves, JSON backups, CSV exports, and prepared MongoDB documents omit post title, content, status, and planned date. The legacy decoder still filters unpublished older records. Group destinations mirror the existing group catalog; page/account destinations are derived only from identifiable URLs.
- One normalized post identity rule now covers editor saves, CSV import, and repository commits, including Trash. New duplicate pairs are rejected, while historical duplicate pairs remain editable and recoverable. MongoDB document/index declarations are prepared but no database or Cloudinary connection was made.
- The full automated test suite, TypeScript check, production build, and formatting check passed. Focused cases cover v6 migration, ambiguous products, expired product links, page/account detection, CSV links, Trash conflicts, legacy collisions, and MongoDB document preparation. Live browser visual verification was unavailable because this environment blocks loopback access.

## Two additional published group posts — 17 October 2026

- Added the supplied links for group 984343641981437/post 2809958519419931 and group 3900458250198953/post 4661094270802010. The previously supplied Meta table matches them to 12 October 2026 at 19:18 and 19:08 ICT, with 15 and 9 Viewers respectively. The supplied group directory provides their names; both posts use the ESHAN product.
- A revision-checked, one-time startup update adds missing posts and groups. It detects existing post IDs/URLs and leaves existing edits and totals unchanged. The completion marker survives backups and prevents a later refresh from recreating removed records.
- Focused persistence tests and the production build including TypeScript passed. Refresh the updated app to save the two posts to this browser's workspace. Live browser verification remains unavailable under the browser tool's local-URL policy.

## Latest supplied Viewers totals — 17 October 2026

- Parsed attachment `aaaeceaf-1ba8-45ea-9f04-0f62ad4e51cf`: 122 HTML rows. Used the previously user-confirmed Viewers column (second numeric metric, cell index 4), not views. All 70 supplied published group links match unique published group names in the table and directory; all 26 known publication dates also agree. Page posts, stories, and pending rows are excluded.
- Added a one-time revision-checked startup update after the supplied link import. Only scalar Viewers totals change; unknown dates, product assignments, links, groups, and click counts remain untouched. Saved later edits are protected by the update marker. Absent, ambiguous, trashed, or conflicting records are skipped.
- Examples: กลุ่มชาวลำลูกกา 907; เมนูขายดีตลาดนัด 595. All 123 tests and production build including TypeScript passed, covering all 70 totals, preservation of other fields, backup markers, conflicts, and failed writes. Refresh applies the update to browser storage; live browser verification remains unavailable under the browser tool's local-URL policy.

## Supplied post links and unknown dates — 17 October 2026

- Ingested 77 supplied link lines as 70 unique published links, excluding five duplicate lines and two pending-post links. The one-time, revision-checked startup import adds missing records for ESHAN in VETRA Store (or the first available company), preserving existing posts, totals, edits, and Trash records. Group names come from the supplied directory when known; unmatched handles/IDs receive explicit Facebook group placeholders.
- For new records, 26 dates and latest totals are recoverable from previous user-supplied data; the remaining 44 have unknown dates and null Viewers totals. Existing posts are never overwritten by this import. Pending post IDs 2909933032704543 and 3704155876400919 are excluded.
- As authorized, empty publication dates now mean unknown for published posts in current v6 storage. The editor permits blank dates, the table displays Unknown date in TH/EN, and CSV export/import retains these records. Invalid dates and future dates in the editor/import remain rejected; legacy draft filtering remains unchanged.
- All 120 tests and the production build including TypeScript passed. Import tests cover deduplication by ID/permalink, preserved edits/Trash, unknown date backup and CSV round trips, failed writes, concurrent edits, and one-time application. Refresh the updated app to apply the import to browser storage; live browser verification remains unavailable under the browser tool's local-URL policy.

## Platform selection modal — 17 October 2026

- Platform filtering now opens the same dark selection dialog as sorting, with All platforms, Facebook, Instagram, TikTok, and LinkedIn. Selecting a choice applies the filter immediately and closes the dialog.
- Sort and platform dialogs share focus containment/restoration, Escape/close/backdrop dismissal, active-option highlighting, and responsive styling. Existing filtering and history state are retained.
- Production build including TypeScript passed. Live visual and interaction checks remain unavailable under the browser tool's local-URL policy.

## Six post sort choices — 17 October 2026

- Default post-library sorting is Most Viewers. Modal choices are Most Viewers, Newest, Oldest, Product Name, Group Name, and Company Name, with Thai translations. Returning through browser history still restores the user's selected sort.
- Name sorts use locale-aware alphabetical/numeric ordering and resolved group/company names. Missing names are last; ties preserve input order. All six choices survive history restoration.
- Eleven sorting/navigation tests and the production build including TypeScript passed. Live browser verification remains unavailable under the browser tool's local-URL policy.

## Sort selection modal — 17 October 2026

- Replaced the post sort select with a button opening a compact dark native dialog. The same three options apply immediately; the active option is marked with a check and pressed state. Thai and English labels are retained.
- Native modal focus containment, initial focus on the active choice, Escape/close/backdrop dismissal, body scroll locking, and focus restoration are implemented. The dialog fits narrow screens and scrolls at short viewport heights.
- Production build including TypeScript passed. Live interaction and visual checks remain unavailable under the browser tool's local-URL policy.

## Post table column balance — 17 October 2026

- Desktop Product / Post now occupies 28% of the table; Destination receives the remaining space after the compact metrics, date, and action columns. Removed wider product-title overrides. Destination names wrap fully instead of being truncated at 13rem, with platform icons retaining their size.
- The existing mobile card layout remains in place. Production build including TypeScript passed; live visual verification remains unavailable under the browser tool's local-URL policy.

## Post product headings and images — 17 October 2026

- Post table headings now read the post's product name directly. Thumbnails use the matching active catalog product's image, including the supplied ESHAN asset. Images retain their aspect ratio without cropping; missing or failed images show a package icon. Blank product names have a TH/EN fallback.
- Images use the existing catalog URL validation, lazy loading, async decoding, and no-referrer policy. Post navigation and click tracking are unchanged.
- Production build including TypeScript passed. Live visual verification remains unavailable under the browser tool's local-URL policy.

## Assign existing posts to ESHAN — 17 October 2026

- On the next app load, all saved posts receive the product name น้ำผึ้งดอกกาแฟ ESHAN 320g. IDs, links, publication dates, Viewers totals, companies, groups, and Trash state are preserved. Daily click storage is untouched.
- The assignment is saved atomically with the supplied catalog addition through the revision-checked repository. A separate backup-preserved marker makes this a one-time update; later edits and newly created posts remain user-controlled. Conflicts reload current data before retrying, and failed saves leave existing data available.
- All 115 tests and the production build including TypeScript passed. Added coverage for existing workspaces, preservation of other post fields, backup round trips, later edits, and concurrent Viewers updates. Live browser verification remains unavailable under the browser tool's local-URL policy; refresh the app to apply the update to browser storage.

## Supplied ESHAN product — 17 October 2026

- Added the exact requested name, น้ำผึ้งดอกกาแฟ ESHAN 320g, and the supplied PNG from `public/product/`. Visually inspected the source image: its label reads 380 grams; the requested name and original image are preserved without alteration.
- App initialization adds the product through the revision-checked repository. A backup-preserved update marker prevents repeat additions after renaming or deletion. Existing matching records/custom images and Trash state are retained. Failed writes leave original data available and retry on the next load.
- Catalog validation/rendering/editor accepts the exact allowlisted bundled image path, while other local paths remain rejected. Empty-workspace resets retain the update marker. No Cloudinary upload or other post changes occur.
- All 113 tests and production build including TypeScript passed. Tests cover file existence, exact text, persistence, backup round trips, conflicts, failed writes, duplicate avoidance, and safe image paths. Live app verification remains blocked by the browser tool's local-URL policy; the addition is applied when the updated app loads.

## Reset daily click counts — 17 October 2026

- Added a TH/EN Reset all clicks action beside Export CSV in the Post library. It clears the current Bangkok day's counters for all posts in this browser, including filtered-out posts. It is disabled when counters are already zero and remains available to reset unreadable click data.
- The helper writes only the separate daily-click key. UI counts update only after a successful write; failures keep saved counts intact and display an error. Existing storage-event listeners propagate changes to other tabs. Post records, Viewers totals, filters, and workspace data are unchanged.
- Five click-count tests and the production build including TypeScript passed. The existing action layout wraps on narrow screens; live browser verification remains blocked by the browser tool's local-URL policy.

## Cloudinary preparation — 17 October 2026

- Product `imageAsset` and company `logoAsset` metadata now survive validation, local repository saves, JSON backups, MongoDB document preparation, and Trash retention. Existing URL-only records remain valid. Name/order/owner edits retain matching assets; replacing a URL detaches metadata without remote deletion.
- Added pure upload-plan, target/submission, prepared-file, and provider-response contracts plus server-only environment placeholders and setup guidance. Upload plans isolate workspace/record/submission IDs and disallow overwrite. Metadata parsing checks the canonical URL and supported image limits; it deliberately does not claim authentication or ownership verification.
- v6 storage preserves the v5 catalog and all older recovery keys. Separate storage prevents an older app build from stripping media fields. Entity edit comparisons now handle nested asset values across reloads while still detecting changes.
- All 105 tests and the production build including TypeScript passed. Tests cover v5 migration, metadata round trips, malformed responses/URLs, credential/token exclusion, URL replacement, shared assets in Trash, scoped plans, and existing catalog/post behavior.
- No upload control, signing endpoint, MongoDB/Cloudinary connection, or deletion API is active. Browser image preparation, retry execution, authenticated media staging, transactional saves, and manual cleanup still require the future API integration. No live provider test was performed.

## Product and company catalogs — 17 October 2026

- Added shared products with name, optional image URL, and sort order. Company forms now expose name, optional logo URL, owner name, and sort order. Both use the dark theme, search, stable ordering, image fallbacks, field validation, busy controls, and entity/repository conflict checks. Product deletion and 30-day restoration preserve image URLs and do not change existing posts.
- Product names are suggested in the post editor without replacing existing campaign text. Company ordering applies to the workspace selector, post form, group form, CSV import, and quick search. Global catalog pages do not display a misleading company filter.
- v5 browser storage and JSON backups include the catalogs. v1–v4 migrations retain old keys, existing company branding and IDs, post relationships, and current totals. Backup restore previews now count products. CSV remains post-only.
- Prepared typed MongoDB catalog documents, input/save contracts, scoped indexes, and a validated document mapping helper, plus API/migration guidance. No MongoDB driver, connection, upload, or live API was enabled; that awaits the user's endpoint and authentication details.
- All 94 tests passed, including migration/recovery, catalog validation, persistence/reload, JSON restore, stale writes, sorting, Trash expiry, and migration document isolation. Production build including TypeScript passed. Live browser layout/interaction verification remains unavailable because the browser tool blocks local URLs; no visual QA claim is made.

## Delete from the post editor — 17 October 2026

- Removed post-row delete icons. Existing-post edit modals now contain a labeled Delete post button; new-post forms do not. The footer wraps on narrow screens.
- Deletion uses the saved record and existing 30-day Trash flow, without submitting unsaved edits or new groups. Controls are disabled during the operation; the modal closes only after a successful write and retains edits on failure.
- Production build (including TypeScript), formatting, and 33 relevant domain, persistence, and editor-state tests passed. Live UI verification remains blocked by the browser tool's URL policy.

## Connection warming on hover — 17 October 2026

- Post-link hover and keyboard focus, plus hover over clickable library rows, issue an origin-only HTTPS preconnect hint through React. Repeated origins are deduplicated. Touch pointer entry is excluded; no post content is fetched and click counts are unchanged by warming.
- Production build (including TypeScript), formatting, and six existing click-count/navigation-state tests passed. Live browser checks remain blocked by the browser tool's URL policy, so no measured loading-speed improvement is claimed.

## New-tab post navigation restored — 17 October 2026

- Linked post titles and Post library row clicks open new tabs. The redundant external-link action was removed; titles in overview and performance tables also open their linked posts, with editing retained on the pencil button.
- Row clicks request the new tab before saving the daily click count. The list stays open, retaining its current filters and scroll position; browser-history restoration remains available for other navigation.
- The production build (including TypeScript), formatting, and six click-count/navigation-state tests passed. Facebook loading speed has not been measured; live browser checks remain blocked by the browser tool's URL policy.

## Same-tab post navigation — 17 October 2026

- Post titles and ordinary row clicks open in the same tab. The separate ↗ action keeps new-tab behavior and has a localized accessible name. Native modified title clicks remain available.
- List search, company/platform filters, sort order, and page/table scroll positions are saved on the current browser-history entry. Returning restores the list after workspace data loads, while preserving framework history fields. Daily click counting is unchanged.
- All 87 tests and the production build (including TypeScript) passed. Live navigation verification was blocked by the browser tool's URL policy.

## Current Viewers total — 17 October 2026

- Active v4 storage, JSON backups, and CSV exports keep one nullable Viewers total per post. Editing a total replaces the previous number; dated readings, daily growth, and the growth chart were removed.
- v1/v2/v3 local workspaces migrate to v4 by selecting the latest valid dated reading for each published post. Earlier browser keys remain available as recovery copies.
- The supplied 26-post update replaces earlier totals with the latest user-provided figures where records still match; custom totals remain untouched.
- Validation: 84 tests, TypeScript, and the production build passed. Rendered verification was unavailable: local preview tabs were unreachable and the local HTTP check was blocked by socket permissions.

The entries below document earlier builds and may describe features removed by the current Viewers model.

## Published-post monitor — 17 October 2026

- Replaced draft and board workflows with one responsive list of published posts. Adding or importing now requires an actual publication date and live-post link or resolvable Facebook IDs. New workspaces start empty.
- Active v3 storage retains published records only. Prior v2/v1 browser keys remain available for recovery, and Settings can download their original data. Built-in sample posts without real links are left out of the active monitor.
- The current implementation was checked with tests, typecheck, production build, and source review. The browser URL policy blocked rendered visual inspection of the local preview.

## Publication-only data structure — 17 October 2026

- Active v2 storage and JSON backups omit post title, content, status, and planned date. A one-time migration reads v1 and leaves the original key intact for recovery; previously planned posts become unpublished records.
- CSV export and template omit those four fields. Imports accept old column aliases but discard their removed values. Publication state comes from the actual publication date. The planned lane, calendar, and topbar checklist are gone.
- The current source, tests, typecheck, and production build were checked after this change. Browser visual inspection was blocked by the browser URL policy, so the new screens have not yet received a rendered viewport check.

The older verification entries below describe the previous planning workflow and remain as historical records.

## Navigation drawer — 17 October 2026

- Removed the fixed desktop sidebar and its reserved page margin. One modal drawer now holds the navigation on every screen size, with the menu button exposed in the top bar.
- Kept native modal focus containment, locked page scrolling while open, restored focus on close, and supported Escape, the close button, backdrop clicks, and route selection. Added close motion and reduced-motion handling.
- TypeScript, regression tests, production build, and formatting checks pass. The local server responded with HTTP 200. Browser interaction for this change was blocked by the browser URL policy while existing tabs showed an unreachable-page error, so this drawer change has not received a visual browser check.

## Workflow improvements — 17 October 2026

- Added a responsive Draft / Planned / Published board, retained the table, and verified that view and sort preferences survive reload. Status filters show the matching lane; text/platform filters report their result count and can be cleared.
- Added keyboard workspace search for posts, companies, pages, and creating a post. Verified Ctrl+K, arrow/Enter navigation, opening a matching post, switching companies, Thai/English text, and exclusion of trashed posts.
- Duplicated a published sample into a fresh draft. Publication identity, dates, and readings were cleared; the caption was preserved. Saved and reloaded the copy, then moved only that QA copy into recoverable Trash.
- Verified caption clipboard contents, unsaved-change dismissal, Escape returning to the editor with text preserved, and the confirmation dialog at desktop and 320-pixel mobile sizes. Fixed an oversized native dialog and narrow-screen toolbar clipping found during visual inspection.
- Ran a real two-tab conflict check: the second tab saved an updated QA post, the first tab rejected its stale edit and retained its unsaved text, and the newer saved record remained intact.
- Downloaded a filtered one-post CSV and parsed the actual file through the importer: one post, no errors, and exactly one UTF-8 BOM. Fixed the prior extra BOM added by the download wrapper.
- Verified date sorting across time zones and after changing published posts back to planned. Dates now follow the current status instead of a retained old publication date.
- Checked the new layouts at 320, 390, 768, 1440, 1920, and 3840 CSS pixels, including large-screen typography. Inspected rendered board/search text contrast with no failures below 4.5:1 on checked solid backgrounds; this remains a focused check rather than a full accessibility audit.
- All 42 regression tests, TypeScript, production build, and source formatting checks pass. No new runtime warnings or errors occurred during completed browser workflows; temporary missing-module development errors while new files were being created were resolved before verification.
- Screenshots: `docs/screenshots/workflow-board-desktop.png`, `workflow-board-mobile.png`, and `workflow-search-desktop.png`.

## Dark theme verification — 17 October 2026

- Applied shared dark tokens to all eight workspace sections, post editor, import dialog, mobile drawer, loading state, and a custom bilingual 404 page. Native controls and browser theme metadata also use dark colors.
- Checked Thai and English, calendar and table containment, company/group forms, preview color selection, import tips, disabled controls, and modal Escape/focus restoration. Existing workspace data and stored brand colors were preserved.
- Inspected rendered text contrast on all eight sections and both dialogs, with no failures below 4.5:1 on the checked solid backgrounds. Form-control boundaries measure 3.22–3.94:1 against their adjacent surfaces. This is a focused theme check, not a full accessibility audit.
- Checked responsive layouts at 320, 390, 768, 1440, 1920, and 3840 CSS pixels. All eight sections fit at 320 pixels; both dialogs remain within the viewport. Large-screen font scaling remains intact.
- TypeScript, production build, formatting, and all 20 existing regression tests pass.
- Dark screenshots are saved in `docs/screenshots/dark-overview-desktop.jpg` and `docs/screenshots/dark-overview-mobile.jpg`.

## Initial version

Verified on 16 October 2026 against the local app at `http://127.0.0.1:3100`.

## Automated checks

- TypeScript: `npm.cmd run typecheck`.
- Domain and CSV regression suite: 20 passing tests, covering long IDs, date and status validation, Viewer rates, mixed date precision, retained permalinks, 30-day Trash expiry, formula-safe export, import duplicates, quoted text, and the distinction between Views and Viewers.
- Production compilation: `npm.cmd run build`.

## Browser checks

- Thai and English switching, localized document title, and persisted language.
- Create a bilingual draft, reload and find it, filter the library, move it to Trash, and restore it.
- Import the CSV fixture: one valid draft accepted, one unsafe URL rejected in the preview. Confirmed import appears in the library.
- Create a group with a 20-digit ID and verify every digit in the generated destination URL.
- Filter the workspace by company and verify scoped post/group counts.
- Inspect the monthly calendar, company cards, editor preview, and mobile drawer. Escape dismisses the drawer and restores focus.
- Checked layout containment at 320, 390, 768, 1440, 1920, and 3840 CSS pixels. Fixed the mobile table label overflow and full-screen dialog sizing. Large viewport root font scaling was verified.
- No browser warning or error logs were reported during the tested workflows.

Test posts and the test group were moved to recoverable Trash after verification. Active sample content remains available. Screenshots are in `docs/screenshots/`.

## Remaining integration work

The current version is browser-local. Shared database storage, sign-in and authorization, real account connections, automated metric retrieval, and media uploads are not configured. No live Google Sheet, social account, or production business record was modified. See the README for the storage boundary and setup commands.
