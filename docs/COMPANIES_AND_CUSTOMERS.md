# Companies and customers

`Company` is a managed business in this workspace. Its stable ID scopes customers, posts, groups, publishing destinations, and product associations. Company names are display values, not foreign keys. Renaming the concept does not rename factual business names such as VETRA STORE.

`Customer` is a separate record linked to one company. Shared fields cover identity, organization, the primary contact, email, phone, website, last contact date, and notes. Social links, domains with their own expiry dates, and GitHub accounts are repeatable sections. A customer may have several domains or accounts without duplicating the customer.

`BusinessType` selects the customer sections used by a company and defines additional fields. Retail, Software house, and Other are starting templates. Users can add types and fields through Business types. Field IDs are stable; labels may change. Archive existing fields instead of deleting their stored values. Changing the company or its business type changes the editor's visible fields and preserves the customer's other details.

Custom values are strings keyed by field ID. Definitions distinguish text, email, HTTPS URL, date, and long text. New business types use these definitions and existing sections; a new data module is needed only when a genuinely new structured resource is required. Domain expiry and last-contact values use `YYYY-MM-DD`, without a timezone conversion. Created, updated, and deleted timestamps remain ISO instants.

Customer order history shows numbered orders with their dates, statuses and quantities. Legacy balances become orders dated from the customer's last contact at migration. If that date is missing, the order date can be entered later on `/orders`. Quick orders need only a quantity. Where a product is selected, its ID and name are recorded. Purchase totals exclude cancelled, trashed, and training orders. Orders moved to Trash from the history can be restored for 30 days.

Customers use the same revision-checked workspace save as other entities. Deletion moves them to Trash for 30 days. JSON backups include customers, business types, company relationships, and Trash. CSV remains a post import/export format.

Customer search combines words in any order across identity/contact details, companies, business types, associated products and known quantities, notes, domains, GitHub accounts, and populated custom fields. Archived or retained custom values remain searchable by their saved labels and values. First/last contact, domain expiry, and custom date fields support both stored `YYYY-MM-DD` and displayed `DD/MM/YYYY` dates. Phone punctuation is optional; search does not infer country/local dialing equivalence. Company, product, and last-contact filters still apply, and customer Trash stays excluded. Search reads records without changing saved values or relationships.

The active storage format is v12 under `vetra-marketing.workspace.v12`. Loading an older workspace maps `stores`, `storeId`, and `storeIds` to companies while retaining IDs and record data. The old keys remain recovery copies. The new key prevents an older open app version from overwriting new customer data. `/companies` is canonical, and `/stores` redirects there. New CSV exports use Company headers and legacy Store headers still import.

The loopback app stores companies, business types, and customers in separate MongoDB collections when configured. GitHub fields hold contact identities. See [MongoDB storage and migration](MONGODB_WORKFLOW.md).
