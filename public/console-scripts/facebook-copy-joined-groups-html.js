(async () => {
  // Open Facebook > Groups > Your groups. Scroll first to load more groups.
  const headingPattern =
    /^(?:(?:All )?groups you(?:['’]ve| have) joined|Your groups|กลุ่มทั้งหมดที่คุณเข้าร่วม|กลุ่มที่คุณเข้าร่วม)(?:\s*\([\d,\s]+\))?$/i;
  const navigationPaths = new Set([
    'feed',
    'discover',
    'joins',
    'create',
    'categories',
    'notifications',
    'your_groups',
  ]);
  const groupIds = (list) => {
    const ids = new Set();
    for (const link of list.querySelectorAll('[role="listitem"] a[href]')) {
      try {
        const url = new URL(link.getAttribute('href'), 'https://www.facebook.com');
        const match = url.pathname.match(/^\/groups\/([^/]+)\/?$/);
        if (
          (url.protocol === 'https:' || url.protocol === 'http:') &&
          (url.hostname === 'facebook.com' || url.hostname.endsWith('.facebook.com')) &&
          match &&
          !navigationPaths.has(match[1].toLowerCase())
        ) {
          ids.add(match[1]);
        }
      } catch {
        // Ignore malformed links and empty loading placeholders.
      }
    }
    return ids;
  };

  const sections = new Set();
  const groups = new Set();
  for (const heading of document.querySelectorAll('h1, h2, h3, [role="heading"]')) {
    if (!headingPattern.test((heading.textContent || '').replace(/\s+/g, ' ').trim())) continue;
    let section = heading.parentElement;
    while (
      section &&
      section !== document.body &&
      section !== document.documentElement &&
      !section.matches('main, [role="main"], nav, [role="navigation"]')
    ) {
      const list = Array.from(section.querySelectorAll('[role="list"]')).find(
        (item) => groupIds(item).size > 0,
      );
      if (list) {
        sections.add(section);
        for (const id of groupIds(list)) groups.add(id);
        break;
      }
      section = section.parentElement;
    }
  }

  if (!sections.size) {
    console.warn(
      'No loaded joined-groups section found. Open Facebook > Groups > Your groups in English or Thai, let the group cards load, then run this script again. Clipboard unchanged.',
    );
    return;
  }

  const outerSections = [...sections].filter(
    (section) => ![...sections].some((other) => other !== section && other.contains(section)),
  );
  const html = outerSections.map((section) => section.outerHTML).join('\n\n');
  try {
    // DevTools copy() works even while the Console has focus.
    if (typeof copy === 'function') {
      copy(html);
    } else {
      await navigator.clipboard.writeText(html);
    }
    console.log(
      `Copied joined-groups outerHTML (${groups.size} loaded groups). Paste with Ctrl+V / Cmd+V. Only currently loaded markup is included.`,
    );
  } catch (error) {
    console.error('Could not copy. Paste and run this script directly in the F12 Console.', error);
  }
})();
