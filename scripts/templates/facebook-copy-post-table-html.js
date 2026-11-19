(async () => {
  // Open Facebook / Meta Content Library, then run in F12 > Console.
  // Scroll first, then copy the live table. Rows absent from the DOM cannot be included.
  // Capture the DevTools helper before waiting for sorting and scrolling.
  const copyHtml = typeof copy === 'function' ? copy : null;
  const scrolledTable = await scrollPostTable();
  if (!scrolledTable) return;

  const normalize = (text) => (text || '').replace(/\s+/g, ' ').trim();
  const visible = (element) =>
    element.getClientRects().length > 0 &&
    !element.closest('[hidden], [aria-hidden="true"]') &&
    !['hidden', 'collapse'].includes(getComputedStyle(element).visibility);
  const tables = [...document.querySelectorAll('table, [role="grid"], [role="table"]')].filter(
    visible,
  );
  const labeled = tables.filter((table) =>
    /^(?:Content library|คลังเนื้อหา)$/i.test(normalize(table.getAttribute('aria-label'))),
  );
  const matches = labeled.length
    ? labeled
    : tables.filter((table) => {
        const headers = [...table.querySelectorAll('th, [role="columnheader"]')].map((cell) =>
          normalize(cell.textContent),
        );
        return (
          headers.some((text) =>
            /^(?:Preview|Post|Posts|Content|ตัวอย่าง|โพสต์|เนื้อหา)$/i.test(text),
          ) && headers.some((text) => /^(?:Views|Viewers|ยอดดู|ผู้ชม)$/i.test(text))
        );
      });
  if (matches.length !== 1 || matches[0] !== scrolledTable || !scrolledTable.isConnected) {
    console.warn(
      'The post table changed after scrolling. Clipboard unchanged. Run the script again.',
    );
    return;
  }

  const table = matches[0];
  const rows = [...table.querySelectorAll('tr, [role="row"]')].filter(
    (row) =>
      visible(row) &&
      row.querySelector('td, [role="gridcell"], [role="cell"]') &&
      normalize(row.textContent),
  );
  const html = table.outerHTML;
  try {
    if (copyHtml) copyHtml(html);
    else await navigator.clipboard.writeText(html);
    console.log(
      `Copied post table outerHTML (${rows.length} rendered data rows). Paste with Ctrl+V / Cmd+V. Only markup currently in the DOM is included; unloaded or virtualized rows may be missing.`,
    );
  } catch (error) {
    console.error(
      'Could not copy. Run this script directly in the F12 Console and try again.',
      error,
    );
  }
})();
