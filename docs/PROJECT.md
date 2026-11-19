# Project

Project: [VETRA Marketing].
Business and audience: [A private workspace for managing companies of different business types, their customers, products, and social media].
Goal: [Keep customer information accurate, organize posts, track performance, and reduce manual work].
Scope: [Monitoring posts across companies, with publication dates when known (blank dates imply Pending), post URLs or Facebook IDs when available, the latest Viewers total and optional comment count per post, spreadsheet import/export, and future support for other social platforms. Meta rows with no post link may be retained as provisional records; pending rows are clearly marked and excluded from published performance totals even when they retain a date. No planning workflow].

For provisional Meta rows, retain the source's group and partial date as context, but do not infer a missing year or post ID. A source row number is provenance, not a permanent post identity; reconcile records with a verified permalink when one becomes available.
When a new permalink matches an active post, direct the user to that record and reject a duplicate save. A matching post in Trash does not block manual entry under the correct company and product. Keep the old record in Trash and block restoring it while the same post is active. Linkless Meta rows in the same group are possible matches for human review only, because one group can contain several posts.
Photo Stories from the supplied Meta table are outside the tracked post list. A published Page row without a public permalink may remain as a provisional record until the team supplies its link.
An undated provisional record appears Pending in the workspace even when Meta marked the source row published; retain Meta's source details for later reconciliation.
Post settings offer Published and Pending, with Published selected for new records. Saving Published requires a confirmed publication date. Pending may have no post link, and changing a post to Pending must preserve any saved or entered publication date. A dated Pending post stays Pending until its status is explicitly changed.

Company is the managed-business scope. Customers, products, groups, destinations, and posts use stable company IDs. A company's business type controls optional customer sections and custom fields; adding another business type must not require changing the Customer schema. Keep customer identity/contact fields separate from business-specific details, and retain entered values when changing a company or business type. Domain expiry and last-contact dates are date-only values. Preserve existing factual business names and all legacy IDs during terminology migrations.

Customers can relate to multiple products through stable product IDs. Offer the selected company's active products, retaining saved associations when company assignments change or a product is in Trash. Contact entries support preset social types, email and phone actions, and custom labels; preserve existing labels and link order. The first contact remains the customer row's destination, while individual contact icons open their own destinations.

Customer purchase totals come from linked orders within the same company. When creating a customer, optional quantities on selected products create one linked order in the same save. Customers can open their order history, add an order by entering a positive quantity, and move an order to Trash. Convert each legacy opening balance to a numbered order using the customer's last contact date at migration. Leave the date blank if unknown. For workspaces that still store product quantities on customers, create one order per customer and subtract units already represented by active linked orders for each product, down to zero. Preserve known zeros, missing quantities, and existing Trash records. Exclude cancelled, trashed, and training orders from unit totals. A selected product narrows the visible customers and counted units.

First contact and last contact are separate optional date-only fields. Display elapsed whole calendar years, months, and days from First contact to the current Bangkok date; show a dash when the date is unknown.

Orders belong to a company and retain customer, product, price, and recipient snapshots. Store THB amounts in integer satang and default new order dates to Bangkok today. Use a single manual order status: Ordered, COD, Paid, Shipped, Completed, or Cancelled. A user can search saved customers or create a customer when saving a custom name. Save recipient details on the linked customer for future orders while retaining each order’s delivery snapshot. Keep recipient and customer names independent. Flash Express is the initial default carrier. Preserve historical carrier records and PDFs through migration and backups, and exclude training shipments from business totals.

Use the project brief, existing code, and supplied assets to establish the
context. Treat unfilled placeholders as missing information, not facts.
Choose appropriate pages and navigation within the agreed scope.

Preferred starting stack: Next.js App Router, TypeScript, MongoDB for
application data, Cloudinary for media, and Vercel for deployment.
Adapt these choices to the project's needs and existing code, including
whether a database or media service is needed.
