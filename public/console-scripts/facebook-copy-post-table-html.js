(async () => {
  // Open Facebook / Meta Content Library, then run in F12 > Console.
  // Scroll first, then copy the live table. Rows absent from the DOM cannot be included.
  // Capture the DevTools helper before waiting for sorting and scrolling.
  const copyHtml = typeof copy === 'function' ? copy : null;
  const scrolledTable = await (async () => {
    // Open Facebook Professional Dashboard > Content library before running.
    if (window.postTableScrollRunning) {
      console.log(
        'Post table scrolling is already running. Stop with Esc or stopPostTableScroll().',
      );
      return;
    }

    const normalize = (text) => (text || '').replace(/\s+/g, ' ').trim();
    const visible = (element) => {
      if (!element.getClientRects().length || element.closest('[aria-hidden="true"], [hidden]'))
        return false;
      const style = getComputedStyle(element);
      return style.display !== 'none' && !/^(?:hidden|collapse)$/.test(style.visibility);
    };
    const findTables = () => {
      const candidates = [
        ...document.querySelectorAll('table, [role="grid"], [role="table"]'),
      ].filter(visible);
      const named = candidates.filter((table) =>
        /^(?:Content library|คลังเนื้อหา)$/i.test(normalize(table.getAttribute('aria-label'))),
      );
      const matching = named.length
        ? named
        : candidates.filter((table) => {
            const headers = [...table.querySelectorAll('th, [role="columnheader"]')].map((header) =>
              normalize(header.textContent),
            );
            return (
              headers.some((text) =>
                /^(?:Preview|Post|Posts|Content|ตัวอย่าง|โพสต์|เนื้อหา)$/i.test(text),
              ) && headers.some((text) => /^(?:Views|Viewers|ยอดดู|ผู้ชม)$/i.test(text))
            );
          });
      return matching;
    };
    const matching = findTables();
    if (matching.length !== 1) {
      console.warn(
        matching.length
          ? 'More than one post data table is visible. Keep one Content library table open and try again. Nothing scrolled.'
          : 'No visible post data table found. Open Facebook Professional Dashboard > Content library in Thai or English and try again. Nothing scrolled.',
      );
      return;
    }

    let table = matching[0];
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const rows = () =>
      [...table.querySelectorAll('tbody tr, [role="row"]')].filter(
        (row) =>
          !row.closest('[aria-hidden="true"], [hidden]') &&
          row.querySelector('td, [role="gridcell"], [role="cell"]') &&
          normalize(row.textContent),
      );
    window.postTableScrollRunning = true;
    window.stopPostTableScrollRequested = false;
    const stop = () => {
      window.stopPostTableScrollRequested = true;
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !event.isComposing) stop();
    };
    const previousStop = Object.getOwnPropertyDescriptor(window, 'stopPostTableScroll');
    let installed = false;
    try {
      document.addEventListener('keydown', onKeyDown, true);
      try {
        Object.defineProperty(window, 'stopPostTableScroll', {
          value: stop,
          configurable: true,
          writable: true,
        });
        installed = true;
      } catch {
        // Preserve a command reserved by the host page. Esc remains available.
      }

      const viewerHeaders = () =>
        [...table.querySelectorAll('th, [role="columnheader"]')].filter(
          (header) =>
            visible(header) &&
            /^(?:Viewers|ผู้ชม)$/i.test(
              normalize(
                header.querySelector('button, [role="button"]')?.textContent || header.textContent,
              ),
            ),
        );
      const sortState = (header) => header?.getAttribute('aria-sort') || '';
      const busy = () =>
        table.getAttribute('aria-busy') === 'true' ||
        [...table.querySelectorAll('[role="progressbar"]')].some(visible);
      let headers = viewerHeaders();
      if (headers.length !== 1) {
        console.warn('A unique Viewers (ผู้ชม) sorting column was not found. Nothing scrolled.');
        return;
      }
      const clickSort = () => {
        const button = headers[0].querySelector('button, [role="button"]');
        if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true')
          return false;
        button.click();
        return true;
      };
      const alreadySorted = sortState(headers[0]) === 'descending';
      if (!alreadySorted || busy() || !rows().length) {
        console.log(
          'Activating Viewers (ผู้ชม) sorting before scrolling. Stop: Esc or stopPostTableScroll().',
        );
        if (!alreadySorted && !clickSort()) {
          console.warn('Viewers (ผู้ชม) sorting is unavailable. Nothing scrolled.');
          return;
        }
        const sortStartedAt = Date.now();
        let stableSince = sortStartedAt;
        let lastTable = table;
        let lastSignature = '';
        let lastBusy = busy();
        let lastSort = sortState(headers[0]);
        let ready = false;
        let clicks = alreadySorted ? 0 : 1;
        while (Date.now() - sortStartedAt < 15000) {
          await sleep(100);
          if (window.stopPostTableScrollRequested) {
            console.log('Post table scrolling stopped before scrolling began.');
            return;
          }
          const current = findTables();
          if (current.length > 1) {
            console.warn('Multiple post tables appeared while sorting. Nothing scrolled.');
            return;
          }
          if (current.length !== 1) {
            stableSince = Date.now();
            continue;
          }
          table = current[0];
          headers = viewerHeaders();
          if (headers.length !== 1) {
            stableSince = Date.now();
            continue;
          }
          const rendered = rows();
          const signature =
            rendered.length +
            ':' +
            normalize(rendered[0]?.textContent) +
            ':' +
            normalize(rendered.at(-1)?.textContent);
          const isBusy = busy();
          const currentSort = sortState(headers[0]);
          if (
            table !== lastTable ||
            signature !== lastSignature ||
            isBusy ||
            !rendered.length ||
            isBusy !== lastBusy ||
            currentSort !== lastSort
          ) {
            stableSince = Date.now();
            lastTable = table;
            lastSignature = signature;
          }
          lastBusy = isBusy;
          lastSort = currentSort;
          if (isBusy || !rendered.length || Date.now() - stableSince < 500) continue;
          if (sortState(headers[0]) === 'ascending' && clicks < 2 && !alreadySorted) {
            if (!clickSort()) break;
            clicks += 1;
            stableSince = Date.now();
            continue;
          }
          if (sortState(headers[0]) === 'descending') {
            ready = true;
            break;
          }
        }
        if (!ready) {
          console.warn(
            'Viewers (ผู้ชม) sorting did not become ready within 15 seconds. Nothing scrolled.',
          );
          return;
        }
      }
      console.log('Viewers (ผู้ชม) sorting is descending; starting table scrolling.');
      const initialRows = rows();
      const root = document.scrollingElement || document.documentElement;
      const canScroll = (element) =>
        visible(element) &&
        element.clientHeight > 0 &&
        element.scrollHeight > element.clientHeight + 1 &&
        /^(?:auto|scroll|overlay)$/.test(getComputedStyle(element).overflowY);
      const scrollCandidates = [];
      const consider = (element) => {
        if (!scrollCandidates.includes(element) && canScroll(element))
          scrollCandidates.push(element);
      };
      // A grid can scroll its tbody instead of an outer panel. Only consider a
      // descendant that contains every row, never an individual post's text box.
      for (let element = initialRows[0]?.parentElement; element && table.contains(element);) {
        if (initialRows.every((row) => element.contains(row))) consider(element);
        if (element === table) break;
        element = element.parentElement;
      }
      for (let element = table; element; element = element.parentElement) {
        const style = getComputedStyle(element);
        if (element === root) {
          if (
            visible(element) &&
            element.clientHeight > 0 &&
            element.scrollHeight > element.clientHeight + 1 &&
            !/^(?:hidden|clip)$/.test(style.overflowY)
          )
            if (!scrollCandidates.includes(element)) scrollCandidates.push(element);
          break;
        }
        // A clipping wrapper can sit inside a working outer scrolling panel.
        // It does not prevent that outer panel from moving the entire table.
        consider(element);
      }
      let scroller = scrollCandidates[0];
      if (!scroller) {
        console.warn('No vertically scrollable post table container found. Nothing scrolled.');
        // The combined helper may still copy this table's current snapshot.
        return table;
      }

      // Sorting an already sorted table can retain the previous bottom position.
      // Start each run at the highest-viewer rows instead of only nudging the end.
      if (scroller.scrollTop > 0) {
        console.log('Returning to the top of the Viewers table before scrolling down.');
        const position = { top: 0, left: scroller.scrollLeft, behavior: 'instant' };
        if (scroller === root) window.scrollTo(position);
        else scroller.scrollTo(position);
        await sleep(100);
        if (window.stopPostTableScrollRequested) {
          console.log('Post table scrolling stopped before scrolling began.');
          return;
        }
        if (!table.isConnected || !scroller.isConnected) {
          console.warn(
            'Post table scrolling stopped: the table was replaced while returning to the top.',
          );
          return;
        }
      }

      const seen = new Set();
      const observeRows = () => {
        let changed = false;
        for (const row of rows()) {
          // Index is progress within this run, not a permanent Facebook post ID.
          const key =
            (row.getAttribute('data-index') || row.getAttribute('aria-rowindex') || '') +
            ':' +
            normalize(row.textContent);
          if (!seen.has(key)) {
            seen.add(key);
            changed = true;
          }
        }
        return changed;
      };
      observeRows();
      const loading = () => {
        if (
          table.getAttribute('aria-busy') === 'true' ||
          scroller.getAttribute('aria-busy') === 'true'
        )
          return true;
        const viewport =
          scroller === root
            ? { top: 0, bottom: window.innerHeight }
            : scroller.getBoundingClientRect();
        const loadingScope = scroller === root ? table.parentElement || table : scroller;
        return [...loadingScope.querySelectorAll('[role="status"], [role="progressbar"]')].some(
          (element) => {
            if (!visible(element)) return false;
            const rect = element.getBoundingClientRect();
            if (rect.bottom < viewport.top || rect.top > viewport.bottom + 200) return false;
            return (
              element.getAttribute('role') === 'progressbar' ||
              /^(?:Loading\b|กำลังโหลด)/i.test(
                normalize(element.getAttribute('aria-label') || element.textContent),
              )
            );
          },
        );
      };

      const startedAt = Date.now();
      let lastProgressAt = startedAt;
      let quietSince = startedAt;
      let wasLoading = false;
      let loaderGraceUntil = 0;
      let loaderGraceUsed = false;
      let furthestTop = scroller.scrollTop;
      let highestHeight = scroller.scrollHeight;
      let lastNudgeAt = startedAt;
      let inertAttempts = 0;
      console.log(
        installed
          ? 'Very fast post table scrolling started. Stop: Esc on the page or stopPostTableScroll() in Console.'
          : 'Very fast post table scrolling started. Stop: Esc on the page or window.stopPostTableScrollRequested = true.',
      );
      while (Date.now() - startedAt < 10 * 60 * 1000) {
        if (window.stopPostTableScrollRequested) break;
        if (!table.isConnected || !scroller.isConnected) {
          console.warn(
            'Post table scrolling stopped: the table or its scroll container was replaced.',
          );
          return;
        }
        const beforeTop = scroller.scrollTop;
        const couldMove = beforeTop + scroller.clientHeight < scroller.scrollHeight - 8;
        const nudge = !couldMove && Date.now() - lastNudgeAt >= 1000 && beforeTop > 0;
        if (nudge) lastNudgeAt = Date.now();
        const position = {
          // Visit intermediate rows so virtualized lists can render and request
          // another batch. At the boundary, retry with a tiny up/down movement.
          top: nudge
            ? Math.max(0, beforeTop - 2)
            : Math.min(scroller.scrollHeight, beforeTop + Math.max(1, scroller.clientHeight * 0.9)),
          left: scroller.scrollLeft,
          behavior: 'instant',
        };
        if (scroller === root) window.scrollTo(position);
        else scroller.scrollTo(position);
        await sleep(100);
        if (window.stopPostTableScrollRequested) break;
        if (!table.isConnected || !scroller.isConnected) {
          console.warn(
            'Post table scrolling stopped: the table or its scroll container was replaced.',
          );
          return;
        }
        const progressed = observeRows();
        const now = Date.now();
        if (couldMove && Math.abs(scroller.scrollTop - beforeTop) < 1 && !progressed) {
          inertAttempts += 1;
          if (inertAttempts >= 3) {
            const next = scrollCandidates[scrollCandidates.indexOf(scroller) + 1];
            if (!next) {
              console.warn(
                'Post table scrolling stopped: the detected scroll container did not move.',
              );
              return;
            }
            scroller = next;
            furthestTop = scroller.scrollTop;
            highestHeight = scroller.scrollHeight;
            quietSince = lastProgressAt = now;
            inertAttempts = 0;
            continue;
          }
        } else inertAttempts = 0;
        const forwardProgress =
          scroller.scrollTop > furthestTop + 1 || scroller.scrollHeight > highestHeight + 1;
        furthestTop = Math.max(furthestTop, scroller.scrollTop);
        highestHeight = Math.max(highestHeight, scroller.scrollHeight);
        if (progressed || forwardProgress) {
          lastProgressAt = now;
          loaderGraceUntil = 0;
          loaderGraceUsed = false;
        }
        const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 8;
        const isLoading = loading();
        if (wasLoading && !isLoading && !loaderGraceUsed) {
          // Allow one bounded render grace after a spinner disappears. Repeated
          // spinner flicker cannot restart the inactivity deadline indefinitely.
          loaderGraceUntil = now + 3000;
          loaderGraceUsed = true;
        }
        if (progressed || forwardProgress || !atBottom || isLoading || wasLoading) quietSince = now;
        wasLoading = isLoading;
        if (atBottom && !isLoading && now - quietSince >= 8000) {
          console.log(
            'Post table scrolling stopped: no new rows appeared at the bottom for 8 seconds after retrying. This does not confirm every post loaded.',
          );
          return table;
        }
        if (now - lastProgressAt >= 30000 && now >= loaderGraceUntil) {
          console.warn('Post table scrolling stopped: no progress for 30 seconds.');
          return;
        }
      }
      console.log(
        window.stopPostTableScrollRequested
          ? 'Post table scrolling stopped.'
          : 'Post table scrolling stopped at the 10-minute limit.',
      );
    } finally {
      document.removeEventListener('keydown', onKeyDown, true);
      const currentStop = Object.getOwnPropertyDescriptor(window, 'stopPostTableScroll');
      if (installed && currentStop?.value === stop && currentStop.configurable) {
        if (previousStop) Object.defineProperty(window, 'stopPostTableScroll', previousStop);
        else delete window.stopPostTableScroll;
      }
      window.postTableScrollRunning = false;
    }
  })();
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
