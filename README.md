# VETRA Marketing

A Thai/English workspace for managing companies, customers, products, orders, and social posts. It tracks post links, publication dates, current Viewers totals, and optional comment counts.

## Run locally

```powershell
npm.cmd install
npm.cmd run dev
```

Open http://127.0.0.1:3100. Thai is the initial language. The app saves the language choice in this browser.

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

## Use the workspace

- **Code scripts** (`/scripts`): save JavaScript snippets for the Facebook, Instagram, and TikTok browser consoles. Add a title, platform, description, and code. Scripts are available workspace-wide. Search and filter the library, pin frequently used scripts, duplicate them for variations, and copy the exact code with one click. Paste copied code manually into the console on the intended platform; the workspace stores and displays code without executing it. Export the visible library as a text file. Deleted scripts can be restored from Trash within 30 days.
- **Facebook — Remove group posts** detects the open group discussion or member feed. Scan, select the posts to remove, and confirm the selected count. Facebook must offer the signed-in account a supported removal action for each post. The snippet uses varied pauses, bounded scrolling, a Stop button, and a downloadable report. If Facebook uses different identifiers for a custom group URL and its post links, try the numeric group URL. Existing edits and Trash state are respected. Run `node scripts/sync-group-cleanup.mjs` after changing the standalone source in `public/console-scripts/facebook-remove-vetra-group-posts.js`. Live removal remains unverified.
- **Orders** (`/orders`): search for a saved customer or create one by entering a name. Saving an order links the company’s customer record and saves recipient details for future orders. Orders retain their own recipient, item, and price snapshots. Prices use integer satang and new dates use Bangkok today. Choose Ordered, COD, Paid, Shipped, Completed, or Cancelled. Set a default carrier from the order list.
- Historical carrier bookings and PDFs are retained in existing records and backups. Orders with booked shipments retain their booking protections, and test shipments are excluded from business totals.
- Add an existing post with its actual publication date and HTTPS link. For Facebook group posts, a saved Group ID plus Post ID can generate the link.
- Enter the current Viewers total and, when known, comment count for each post. Updating either count replaces its previous number; the overview and Performance page show current Viewers totals.
- A Pending post keeps its entered publication date if its status changes. Pending posts remain excluded from published performance totals until changed back to Published.
- Find published posts in one responsive list. Search, filter by platform, sort, or export CSV. The menu opens a navigation drawer on every screen size.
- Pin important posts with the button at the start of each post row. Pinned posts appear first in the library, overview, Performance, and quick search; the chosen sort still applies within pinned and unpinned posts. Pin state is saved with each post and included in CSV and JSON backups.
- Click a linked post title or a Post library row to open it in a new tab. The library stays open with its filters and scroll position. List state is also retained in browser history for reloads and returning from other navigation.
- Use **Reset all clicks** beside Export CSV in the Post library to clear today's counters for every post in this browser, including posts hidden by filters. Posts and Viewers totals are unchanged; counters still reset automatically at midnight ICT.
- Hovering a post link or focusing it with the keyboard hints the browser to warm the destination connection. Hovering a clickable library row does the same. Repeated hints are deduplicated; warming does not load the post or count as a click.
- Import existing posts from CSV with a preview and row validation. JSON backup/restore, company/group management, and 30-day Trash recovery are available in Settings and the drawer.
- In the Post library, use **Update metrics** to paste a Meta table or select an HTML/TXT file. Matching starts with a unique publication date and minute, then checks any available Group/Post identity; an exact link can identify a post with an unknown saved date. Preview Viewers, Comments when the source provides an exact count, dates, and rows needing review before saving. An optional publication year handles Meta dates without a year. Ambiguous, duplicate, conflicting, and unmatched rows are skipped; a lower source Viewers total is not applied.
- Products: name, optional HTTPS image URL, and sort order. Company associations control product suggestions in the post form. Existing post product/campaign text stays unchanged; catalog renaming or deletion does not rewrite posts.
- The requested **น้ำผึ้งดอกกาแฟ ESHAN 320g** product is added once on app load using `public/product/Clean ESHAN honey jar cutout.png`. The PNG is served locally; no Cloudinary upload occurs. A saved update marker prevents duplicates and respects later renaming/deletion. Matching products and custom images are preserved. The supplied label reads 380 grams; the name follows the user's explicit 320g text.
- Companies: name, business type, optional HTTPS logo URL, and owner name. Drag the handle or use its arrow keys to set display order. Older initials, colors, and descriptions remain in saved data for compatibility. `/stores` redirects to `/companies`.
- The 36 Facebook groups supplied on 5 November 2026 are added once under VETRA Software on app load. Existing company IDs, group details, and Trash records are preserved; the named company is created only if absent. The 12 named group links stay in Posting notes with blank numeric IDs and can be opened or edited from the group list. A saved update marker preserves later edits and removals.
- **Customer order history** (`/customers`). Open the units button on a customer row to see their orders and combined quantity. Enter a quantity and choose **Add order**, or use the trash button beside an order to remove it. The same order appears on `/orders`. Selecting a product scopes the units shown in the customer list.
- Customers belong to a company. Save their name, organization, contact details, website, last contact date, social links, and notes. Software-house profiles also offer multiple domains with expiry dates and GitHub identities. Business types control these sections and allow additional typed fields, so new types can be added without changing the customer schema. Customers can be restored from Trash for 30 days.
- Delete products from their editor and restore them from Trash within 30 days. Product images and company logos have a placeholder when blank or unavailable. Catalog data is included in JSON backups; CSV remains a post-only export.
- There is no automatic publishing, live social metrics connection, team login, or cloud sync.

## Data and migration

Orders, shipping settings, and order-number sequence counters are included in the current workspace format. PDF bytes live in IndexedDB with content hashes. Settings backups include the referenced PDFs (also Trash) in a portable JSON envelope. Restore validates and previews first, then saves PDFs only on confirmation. The limit is 10 MB per PDF, and 100 MB of PDF bytes per backup. The separate server booking journal must also be backed up if Flash is enabled. See the shipping guide.

Active data stays in this browser under `vetra-marketing.workspace.v12`. It includes companies, business types, customers, products, publishing destinations, console scripts, post pin state, optional comment counts, and optional Cloudinary asset metadata. Scripts, including their exact code and Trash records, are included in Settings JSON backups. Older backups without scripts open with an empty library. Post title, content, planning status, planned date, and dated Viewer history are absent from active storage. A post may be Pending with or without a publication date. Older records without a pin field load as unpinned.

On first load, v1–v11 workspaces migrate to v12. Existing store IDs become company IDs, including product/post/group/destination relationships. Earlier localStorage keys remain available for recovery. Existing names, images, order, post links, pending records, and latest Viewers totals are preserved. See [Companies and customers](docs/COMPANIES_AND_CUSTOMERS.md).

Each opening balance becomes a numbered order dated from the customer's last contact. Missing dates stay blank and can be entered in the order editor. Workspaces predating opening balances import each customer's recorded quantities once, accounting for units already on orders.

Cloudinary data and upload/save contracts are prepared for product images and company logos. Uploads and remote deletion are not enabled. Existing image URLs remain supported; optional asset IDs survive saves, backups, and Trash. See `docs/CLOUDINARY_WORKFLOW.md` and `.env.example` for the server setup and remaining API work. Never put secrets in browser settings or `NEXT_PUBLIC_` variables.

Browser storage can be cleared by the user or browser. Download backups regularly. Corrupt saved data is preserved and edits are blocked until a valid restore. A shared deployment would need authentication, per-workspace authorization, and server persistence. No social account credentials are stored here.

Viewer totals are summed per post and may count the same people across posts. The app does not calculate daily growth or retain a measurement timeline in its active data.

## Code

- `src/components/MarketingApp.tsx`: navigation, list, overview, analytics, and persistence.
- `src/components/PostEditor.tsx`: published-post editor and current Viewers total.
- `src/components/ImportDialog.tsx`: CSV review and import.
- `src/components/MetaUpdateDialog.tsx`: Meta table review and Viewers update.
- `src/components/CatalogPanel.tsx`: simple product and company editors, images, search, and sorting.
- `src/components/CustomersPanel.tsx` and `BusinessTypeManager.tsx`: customer records and configurable business profiles.
- `src/components/ScriptsPanel.tsx`, `ScriptEditor.tsx`, and `src/lib/console-scripts.ts`: console script library, editor, validation, and exact-text copying.
- `src/components/WorkspacePanels.tsx`: groups, settings, and Trash.
- `src/components/OrdersPanel.tsx` and `OrderEditor.tsx`: order list, default carrier, and order editor.
- `src/lib/orders.ts` and `order-labels.ts`: order validation, exact totals, conflict protection, PDF storage, printing, and portable backups.
- `src/lib/shipping/` and `src/app/api/shipping/`: optional loopback-only Flash adapter and durable booking journal; disabled until configured.
- `src/lib/mongodb-catalog.ts`: prepared product/company document types, save request types, index definitions, and validated migration mapping; no network connection.
- `src/lib/cloudinary-media.ts` and `src/lib/catalog-media-contract.ts`: media metadata, validation, scoped upload plans, and temporary submission contracts; no network connection.
- `src/lib/workspace-storage.ts`: versioned storage and legacy migration.
- `src/lib/csv.ts`: CSV parsing, import validation, and export.
- `src/lib/meta-viewers-import.ts`: safe Meta row matching and current-total update planning.
- `src/lib/data.ts`: schema validation, URLs, retention, and Viewers totals.

Read `AGENTS.md` and the project documents before further changes. See `docs/MONGODB_WORKFLOW.md` for the future API and migration workflow.
