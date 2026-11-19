(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const waitFor = async (fn, timeout = 5000) => {
    const start = Date.now();

    while (Date.now() - start < timeout) {
      if (window.stopGroupPostDeletion) return null;
      const result = fn();
      if (result) return result;
      await sleep(100);
    }

    return null;
  };

  const visible = el =>
    el &&
    el.isConnected !== false &&
    el.getClientRects().length > 0 &&
    el.getAttribute("aria-hidden") !== "true";

  const enabled = el => visible(el) && !el.disabled && el.getAttribute("aria-disabled") !== "true";

  const label = el =>
    (el.innerText || el.getAttribute("aria-label") || "")
      .trim()
      .replace(/\s+/g, " ");

  const OWNER = "VETRA ออกแบบ สร้าง เว็บไซต์";

  const ARTICLE = '[role="article"]';

  const MENU = [
    '[role="button"]',
    '[aria-haspopup="menu"]',
    `[aria-label*="${OWNER}"]`
  ].join("");

  const POST_LINK = 'a[href*="/groups/"][href*="/posts/"]';

  const DELETE_WORDS = [
    "ลบโพสต์",
    "ย้ายไปถังขยะ",
    "Delete post",
    "Move to trash",
    "Move to bin",
    "Remove post",
    "Remove this post"
  ];

  const isDelete = text => {
    const value = text.toLowerCase();

    return DELETE_WORDS.some(word =>
      value.startsWith(word.toLowerCase())
    ) || ["ลบ", "delete", "remove"].includes(value);
  };

  const CONFIRM_WORDS = [
    "ลบ",
    "ลบโพสต์",
    "ย้ายไปถังขยะ",
    "ยืนยัน",
    "delete",
    "delete post",
    "move to trash",
    "move to bin",
    "confirm"
  ];

  if (!(location.hostname === "facebook.com" || location.hostname.endsWith(".facebook.com"))) {
    console.error("Open Facebook first.");
    return;
  }

  // Very fast scrolling: load posts before starting deletion requests.
  window.stopGroupPostDeletion = false;
  const scrollStartedAt = Date.now();
  let lastNewPostAt = scrollStartedAt;
  let quietSince = scrollStartedAt;
  let wasLoading = false;
  let loaderGraceUntil = 0;
  let loaderGraceUsed = false;
  let scrollFinished = false;
  const seenPosts = new Set();

  console.log("Very fast scrolling to load posts... Stop: window.stopGroupPostDeletion = true");

  while (Date.now() - scrollStartedAt < 10 * 60 * 1000) {
    if (window.stopGroupPostDeletion) {
      console.warn("Stopped by user.");
      return;
    }
    const scrollRoot = document.scrollingElement || document.documentElement;
    if (!scrollRoot) {
      console.warn("Page scroller not found. No deletion requests were sent.");
      return;
    }
    window.scrollTo({ top: scrollRoot.scrollHeight, behavior: "instant" });
    await sleep(100);

    if (window.stopGroupPostDeletion) {
      console.warn("Stopped by user.");
      return;
    }

    let newPosts = false;
    for (const article of document.querySelectorAll(ARTICLE)) {
      const href = article.querySelector(POST_LINK)?.href;
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
    const viewportHeight = scrollRoot.clientHeight || window.innerHeight;
    const atBottom = scrollRoot.scrollTop + viewportHeight >= scrollRoot.scrollHeight - 8;
    const loading = [...document.querySelectorAll('[role="status"], [role="progressbar"]')]
      .some(el => {
        if (!visible(el) || getComputedStyle(el).visibility === "hidden") return false;
        const rect = el.getBoundingClientRect();
        if (rect.bottom < window.innerHeight * 0.5 || rect.top > window.innerHeight + 200) return false;
        return el.getAttribute("role") === "progressbar" || /^(?:Loading\b|กำลังโหลด)/i.test(label(el));
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
      console.warn("Scrolling or loading stalled. Stopped before deletion.");
      return;
    }
  }

  if (!scrollFinished) {
    console.warn("Very fast scroll reached its 10-minute limit. Stopped before deletion.");
    return;
  }

  const initial = document.querySelectorAll(ARTICLE).length;

  if (!initial) {
    console.error("No posts found.");
    return;
  }

  if (!confirm(
    `Delete up to ${initial} loaded published group posts by ${OWNER}?\n\n` +
    "This may be irreversible."
  )) return;

  window.stopGroupPostDeletion = false;

  const processed = new Set();
  let submitted = 0;
  let previousUi = null;

  const removalDialog = () => [...document.querySelectorAll(
    '[role="dialog"], [role="alertdialog"]'
  )].reverse().find(el => visible(el) && /ลบ|ถังขยะ|delete|trash|remove/i.test(label(el)));

  for (let iteration = 0; iteration < initial; iteration++) {
    if (window.stopGroupPostDeletion) {
      console.warn("Stopped by user.");
      break;
    }

    // Only wait for the previous UI to close, never for the post to disappear.
    if (previousUi) {
      const uiReady = await waitFor(() =>
        !visible(previousUi.deleteButton) && !visible(previousUi.dialog) && !removalDialog()
      );
      if (!uiReady) {
        console.warn(window.stopGroupPostDeletion ? "Stopped by user." : "Previous menu or dialog is still open. Stopping.");
        break;
      }
    }

    let target = null;

    const articles = [
      ...document.querySelectorAll(ARTICLE)
    ].reverse();

    // Find the next unprocessed post
    for (const article of articles) {
      if (window.stopGroupPostDeletion) break;
      if (!article.isConnected) continue;
      const currentId = article.querySelector(POST_LINK)?.href.split(/[?#]/)[0];
      if (currentId && processed.has(currentId)) continue;

      article.scrollIntoView({
        behavior: "instant",
        block: "center"
      });

      const ready = await waitFor(() => {
        const button = article.querySelector(MENU);
        const link = article.querySelector(POST_LINK);

        if (!enabled(button) || !link) return null;

        return {
          article,
          button,
          id: link.href.split(/[?#]/)[0]
        };
      }, 3500);

      if (!ready || processed.has(ready.id)) continue;

      target = ready;
      break;
    }

    if (window.stopGroupPostDeletion) {
      console.warn("Stopped by user.");
      break;
    }
    if (!target) {
      console.log("No additional matching posts found.");
      break;
    }

    const { article, button, id } = target;

    console.log(`Processing ${submitted + 1}/${initial}`, id);

    // Open the three-dot menu
    button.click();

    const deleteButton = await waitFor(() => {
      const menuItems = [
        ...document.querySelectorAll(
          '[role="menuitem"], [role="menu"] [role="button"]'
        )
      ];

      return menuItems.find(el =>
        enabled(el) && isDelete(label(el))
      );
    }, 5000);

    if (window.stopGroupPostDeletion) {
      console.warn("Stopped by user.");
      break;
    }
    if (!deleteButton) {
      console.error("Delete option not found. Stopping.");

      console.table(
        [...document.querySelectorAll('[role="menuitem"]')]
          .filter(visible)
          .map(el => ({ option: label(el) }))
      );

      break;
    }

    // Select Delete / Move to trash
    deleteButton.click();

    // Look for a confirmation dialog
    const dialog = await waitFor(removalDialog, 1800);

    if (window.stopGroupPostDeletion) {
      console.warn("Stopped by user.");
      break;
    }

    if (dialog) {
      const confirmButton = await waitFor(() => [
        ...dialog.querySelectorAll('button, [role="button"]')
      ].find(el =>
        enabled(el) &&
        CONFIRM_WORDS.includes(label(el).toLowerCase())
      ), 1800);

      if (window.stopGroupPostDeletion) {
        console.warn("Stopped by user.");
        break;
      }
      if (!confirmButton) {
        console.error("Confirmation button not found. Stopping.");
        break;
      }

      confirmButton.click();
    } else if (
      article.isConnected && article.querySelector(POST_LINK)?.href.split(/[?#]/)[0] === id
    ) {
      // A late dialog must never be mistaken for the next post's confirmation.
      // This is one snapshot after the dialog wait, not a wait for deletion completion.
      console.warn("No confirmation appeared and the action is unclear. Stopping before the next post.");
      break;
    }

    // A submitted request is not a verified deletion. Skip it even while its card remains.
    processed.add(id);
    submitted++;
    previousUi = { deleteButton, dialog };
    console.log(`Deletion requests submitted: ${submitted}/${initial}`, id);

    if (iteration + 1 < initial) await sleep(200 + Math.floor(Math.random() * 601));
  }

  console.log(
    `Finished. Deletion requests submitted: ${submitted}/${initial}. Completion is not verified.`
  );
})();
