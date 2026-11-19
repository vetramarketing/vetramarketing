(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const articleSelector = '[role="article"]';
  const deleteSelector =
    '[role="button"][aria-label="ลบ"]:not([aria-disabled="true"]):not([aria-hidden="true"])';

  // Very-fast-scroll addition: finish loading before the original deletion flow.
  if (
    !(location.hostname === "facebook.com" || location.hostname.endsWith(".facebook.com")) ||
    !document.body.innerText.includes("รอดำเนินการ")
  ) {
    console.error("Open your own Facebook Pending Posts page first (Thai interface).");
    return;
  }

  window.stopPendingDeletion = false;
  const scrollStartedAt = Date.now();
  let lastNewPostAt = scrollStartedAt;
  let quietSince = scrollStartedAt;
  let wasLoading = false;
  let loaderGraceUntil = 0;
  let loaderGraceUsed = false;
  let scrollFinished = false;
  const seenPosts = new Set();

  console.log("Very fast scrolling to load pending posts... Stop: window.stopPendingDeletion = true");

  while (Date.now() - scrollStartedAt < 10 * 60 * 1000) {
    if (window.stopPendingDeletion) {
      console.warn("Stopped before deletion.");
      return;
    }
    const scroller = document.scrollingElement || document.documentElement;
    if (!scroller) {
      console.warn("Page scroller not found. No posts were deleted.");
      return;
    }
    window.scrollTo({ top: scroller.scrollHeight, behavior: "instant" });
    await sleep(100);
    if (window.stopPendingDeletion) {
      console.warn("Stopped before deletion.");
      return;
    }

    let newPosts = false;
    for (const article of document.querySelectorAll(articleSelector)) {
      const href = article.querySelector('a[href*="/pending_posts/"]')?.href;
      const text = (article.innerText || article.textContent || "").replace(/\s+/g, " ").trim();
      const key = href ? href.split(/[?#]/)[0] : text ? "text:" + text.slice(0, 1000) : null;
      if (key && !seenPosts.has(key)) {
        seenPosts.add(key);
        newPosts = true;
      }
    }
    if (newPosts) {
      lastNewPostAt = Date.now();
      loaderGraceUntil = 0;
      loaderGraceUsed = false;
    }
    const viewportHeight = scroller.clientHeight || window.innerHeight;
    const atBottom = scroller.scrollTop + viewportHeight >= scroller.scrollHeight - 8;
    const loading = [...document.querySelectorAll('[role="status"], [role="progressbar"]')].some(el => {
      if (!el.getClientRects().length || el.getAttribute("aria-hidden") === "true" || getComputedStyle(el).visibility === "hidden") return false;
      const rect = el.getBoundingClientRect();
      if (rect.bottom < window.innerHeight * 0.5 || rect.top > window.innerHeight + 200) return false;
      const label = (el.innerText || el.getAttribute("aria-label") || el.textContent || "").trim();
      return el.getAttribute("role") === "progressbar" || /^(?:Loading\b|กำลังโหลด)/i.test(label);
    });
    if (wasLoading && !loading) {
      quietSince = Date.now();
      if (!loaderGraceUsed) {
        loaderGraceUntil = Date.now() + 3000;
        loaderGraceUsed = true;
      }
    }
    wasLoading = loading;
    if (newPosts || !atBottom || loading) quietSince = Date.now();
    if (atBottom && !loading && Date.now() - quietSince >= 3000) {
      scrollFinished = true;
      break;
    }
    if (Date.now() - lastNewPostAt >= 10000 && Date.now() >= loaderGraceUntil) {
      console.warn("Scrolling or loading stalled. No posts were deleted. Check the page and run again.");
      return;
    }
  }
  if (!scrollFinished) {
    console.warn("Scrolling reached its 10-minute limit. No posts were deleted.");
    return;
  }
  console.log("Scrolling finished. The confirmation counts currently loaded pending posts.");
  // End very-fast-scroll addition.

  const total = document.querySelectorAll(articleSelector).length;

  if (!document.body.innerText.includes("รอดำเนินการ") || !total) {
    console.error("Open the Facebook Pending Posts page first.");
    return;
  }

  if (!confirm(`Delete all ${total} loaded pending posts?`)) return;

  window.stopPendingDeletion = false;

  let deleted = 0;

  for (let i = 0; i < total; i++) {
    if (window.stopPendingDeletion) {
      console.warn("Deletion stopped.");
      break;
    }

    const article = document.querySelector(articleSelector);
    if (!article) break;

    // Scroll to the post to trigger virtualized rendering
    article.scrollIntoView({
      behavior: "instant",
      block: "center"
    });

    // Wait for the delete button
    let deleteButton = null;

    for (let attempt = 0; attempt < 30; attempt++) {
      if (window.stopPendingDeletion) return console.warn("Deletion stopped.");
      deleteButton = article.querySelector(deleteSelector);
      if (deleteButton) break;
      await sleep(200);
    }

    if (!deleteButton) {
      console.warn("Delete button not found. Stopping.");
      break;
    }

    // Store pending post URL to verify removal
    const postURL = article
      .querySelector('a[href*="/pending_posts/"]')
      ?.href.split("?")[0];

    // Click delete
    if (window.stopPendingDeletion) return console.warn("Deletion stopped.");
    deleteButton.click();
    await sleep(700);
    if (window.stopPendingDeletion) return console.warn("Deletion stopped.");

    // Handle confirmation dialog if present
    const dialog = [...document.querySelectorAll(
      '[role="dialog"], [role="alertdialog"]'
    )].find(el =>
      el.getClientRects().length &&
      /ลบ|delete|remove/i.test(el.innerText)
    );

    if (dialog) {
      const confirmButton = [...dialog.querySelectorAll(
        'button, [role="button"]'
      )].find(btn => {
        const label = (
          btn.innerText ||
          btn.getAttribute("aria-label") ||
          ""
        ).trim();

        return /^(ลบ(โพสต์)?|Delete( post)?|Remove( post)?)$/i.test(label);
      });

      if (!confirmButton) {
        console.warn("Confirmation button not found. Stopping.");
        break;
      }

      if (window.stopPendingDeletion) return console.warn("Deletion stopped.");
      confirmButton.click();
    }

    // Verify post was removed
    let removed = false;

    for (let attempt = 0; attempt < 40; attempt++) {
      await sleep(250);

      const stillExists = postURL && [
        ...article.querySelectorAll('a[href*="/pending_posts/"]')
      ].some(a => a.href.split("?")[0] === postURL);

      if (!article.isConnected || (postURL && !stillExists)) {
        removed = true;
        break;
      }
    }

    if (!removed) {
      console.warn("Post removal could not be verified. Stopping.");
      break;
    }

    deleted++;

    console.log(`✅ Deleted ${deleted}/${total}`);

    // Delay between deletions
    await sleep(1200);
  }

  console.log(`Finished. Verified deletions: ${deleted}/${total}`);
})();
