(async () => {
  if (window.fastAutoScrollRunning) {
    console.log('Auto scroll is already running. Stop: window.stopFastAutoScroll = true');
    return;
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  window.fastAutoScrollRunning = true;
  window.stopFastAutoScroll = false;
  const startedAt = Date.now();
  let lastItemAt = startedAt;
  let quietSince = startedAt;
  let highestHeight = 0;
  let furthestTop = 0;
  let wasLoading = false;
  let loaderGraceUntil = 0;
  let loaderGraceUsed = false;
  const seenItems = new Set();
  const loadingText = /^(?:Loading\b|กำลังโหลด)/i;
  const itemKey = (item) => {
    const postSelector = 'a[href*="/posts/"], a[href*="/permalink/"], a[href*="story_fbid="]';
    for (const link of item.querySelectorAll(postSelector)) {
      try {
        const url = new URL(link.href || link.getAttribute('href'), 'https://www.facebook.com');
        if (!/(^|\.)facebook\.com$/i.test(url.hostname)) continue;
        const post = url.pathname.match(/\/(?:posts|permalink)\/([^/]+)\/?$/)?.[1];
        const story = url.searchParams.get('story_fbid');
        if (post || story) return 'post:' + (post || story);
      } catch {
        // A partially rendered link is not an item identity yet.
      }
    }
    if (item.getAttribute('role') === 'listitem') {
      for (const link of item.querySelectorAll('a[href*="/groups/"]')) {
        try {
          const url = new URL(link.href || link.getAttribute('href'), 'https://www.facebook.com');
          const group = url.pathname.match(/^\/groups\/([A-Za-z0-9._-]{1,80})\/?$/)?.[1];
          if (
            /(^|\.)facebook\.com$/i.test(url.hostname) &&
            group &&
            !/^(?:feed|joins|discover|create|categories|notifications|your_groups)$/i.test(group)
          )
            return 'group:' + group.toLowerCase();
        } catch {
          // Ignore incomplete group links.
        }
      }
    }
    // Facebook can recreate an unchanged card. The DOM node itself is not progress.
    const text = (item.innerText || item.textContent || '').replace(/\s+/g, ' ').trim();
    return text && !loadingText.test(text) ? 'text:' + text.slice(0, 1000) : null;
  };
  const previousStopCommand = Object.getOwnPropertyDescriptor(window, 'stopScroll');
  const stopScroll = () => {
    window.stopFastAutoScroll = true;
  };
  const onKeyDown = (event) => {
    if (event.key === 'Escape' && !event.isComposing) stopScroll();
  };
  let commandInstalled = false;

  try {
    document.addEventListener('keydown', onKeyDown, true);
    try {
      Object.defineProperty(window, 'stopScroll', {
        value: stopScroll,
        configurable: true,
        writable: true,
      });
      commandInstalled = true;
    } catch {
      // A page may reserve this name. Escape and the original stop flag still work.
    }
    console.log(
      commandInstalled
        ? 'Very fast auto scroll started. Stop: press Esc on the page, or type stopScroll() in Console.'
        : 'Very fast auto scroll started. Stop: press Esc on the page, or set window.stopFastAutoScroll = true.',
    );
    while (Date.now() - startedAt < 10 * 60 * 1000) {
      if (window.stopFastAutoScroll) break;
      const scroller = document.scrollingElement || document.documentElement;
      if (!scroller) throw new Error('Page scroller was not found.');

      window.scrollTo({ top: scroller.scrollHeight, behavior: 'instant' });
      await sleep(100);
      if (window.stopFastAutoScroll) break;

      const height = scroller.scrollHeight;
      const items = [...document.querySelectorAll('[role="article"], [role="listitem"]')];
      let newItems = false;
      for (const item of items) {
        const key = itemKey(item);
        if (key && !seenItems.has(key)) {
          seenItems.add(key);
          newItems = true;
        }
      }
      // Ignore repeated layout fluctuations. Without identifiable cards, only a new
      // maximum height or scroll position counts as forward progress.
      const newContent = newItems || (!seenItems.size && height > highestHeight);
      const movedForward = scroller.scrollTop > furthestTop;
      if (!seenItems.size && movedForward) lastItemAt = Date.now();
      if (newContent) {
        lastItemAt = Date.now();
        loaderGraceUntil = 0;
        loaderGraceUsed = false;
      }
      const viewportHeight = scroller.clientHeight || window.innerHeight;
      const atBottom = scroller.scrollTop + viewportHeight >= height - 8;
      const loading = [...document.querySelectorAll('[role="status"], [role="progressbar"]')].some(
        (element) => {
          if (
            !element.getClientRects().length ||
            element.getAttribute('aria-hidden') === 'true' ||
            getComputedStyle(element).visibility === 'hidden'
          )
            return false;
          const rect = element.getBoundingClientRect();
          if (rect.bottom < window.innerHeight * 0.5 || rect.top > window.innerHeight + 200)
            return false;
          const label = (
            element.innerText ||
            element.getAttribute('aria-label') ||
            element.textContent ||
            ''
          ).trim();
          return element.getAttribute('role') === 'progressbar' || loadingText.test(label);
        },
      );

      if (wasLoading && !loading) {
        quietSince = Date.now();
        // A loader can disappear just before its cards render. Allow one bounded
        // grace period; repeated spinner flicker must not keep the run alive.
        if (!loaderGraceUsed) {
          loaderGraceUntil = Date.now() + 3000;
          loaderGraceUsed = true;
        }
      }
      wasLoading = loading;
      if (newContent || !atBottom || loading) quietSince = Date.now();
      const idleFor = Date.now() - lastItemAt;
      if (atBottom && !loading && Date.now() - quietSince >= 3000) {
        console.log('Auto scroll stopped: no new items loaded at the bottom for 3 seconds.');
        return;
      }
      if (idleFor >= 10000 && Date.now() >= loaderGraceUntil) {
        console.warn('Auto scroll stopped: no new items or content progress for 10 seconds.');
        return;
      }
      highestHeight = Math.max(highestHeight, height);
      furthestTop = Math.max(furthestTop, scroller.scrollTop);
    }
    console.log(
      window.stopFastAutoScroll
        ? 'Auto scroll stopped.'
        : 'Auto scroll reached its 10-minute limit.',
    );
  } finally {
    document.removeEventListener('keydown', onKeyDown, true);
    const currentStopCommand = Object.getOwnPropertyDescriptor(window, 'stopScroll');
    if (
      commandInstalled &&
      currentStopCommand?.value === stopScroll &&
      currentStopCommand.configurable
    ) {
      if (previousStopCommand) Object.defineProperty(window, 'stopScroll', previousStopCommand);
      else delete window.stopScroll;
    }
    window.fastAutoScrollRunning = false;
  }
})();
