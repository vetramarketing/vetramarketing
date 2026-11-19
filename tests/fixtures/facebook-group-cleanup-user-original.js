(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const waitFor = async (fn, timeout = 5000) => {
    const start = Date.now();

    while (Date.now() - start < timeout) {
      const result = fn();
      if (result) return result;
      await sleep(250);
    }

    return null;
  };

  const visible = el =>
    el &&
    el.getClientRects().length > 0 &&
    el.getAttribute("aria-hidden") !== "true";

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

  if (!location.hostname.endsWith("facebook.com")) {
    console.error("Open Facebook first.");
    return;
  }

  const initial = document.querySelectorAll(ARTICLE).length;

  if (!initial) {
    console.error("No posts found.");
    return;
  }

  if (!confirm(
    `Delete up to ${initial} published group posts by ${OWNER}?\n\n` +
    "This may be irreversible."
  )) return;

  window.stopGroupPostDeletion = false;

  const processed = new Set();
  let deleted = 0;

  for (let iteration = 0; iteration < initial; iteration++) {
    if (window.stopGroupPostDeletion) {
      console.warn("Stopped by user.");
      break;
    }

    let target = null;

    const articles = [
      ...document.querySelectorAll(ARTICLE)
    ].reverse();

    // Find the next unprocessed post
    for (const article of articles) {
      if (!article.isConnected) continue;

      article.scrollIntoView({
        behavior: "instant",
        block: "center"
      });

      const ready = await waitFor(() => {
        const button = article.querySelector(MENU);
        const link = article.querySelector(POST_LINK);

        if (!button || !link) return null;

        return {
          article,
          button,
          id: link.href.split("?")[0]
        };
      }, 3500);

      if (!ready || processed.has(ready.id)) continue;

      target = ready;
      break;
    }

    if (!target) {
      console.log("No additional matching posts found.");
      break;
    }

    const { article, button, id } = target;

    console.log(`Processing ${deleted + 1}/${initial}`, id);

    // Open the three-dot menu
    button.click();

    const deleteButton = await waitFor(() => {
      const menuItems = [
        ...document.querySelectorAll(
          '[role="menuitem"], [role="menu"] [role="button"]'
        )
      ];

      return menuItems.find(el =>
        visible(el) && isDelete(label(el))
      );
    }, 5000);

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
    const dialog = await waitFor(() => {
      const dialogs = [
        ...document.querySelectorAll(
          '[role="dialog"], [role="alertdialog"]'
        )
      ].filter(visible);

      return dialogs.reverse().find(el =>
        /ลบ|ถังขยะ|delete|trash|remove/i.test(label(el))
      );
    }, 1800);

    if (dialog) {
      const confirmButton = [
        ...dialog.querySelectorAll('button, [role="button"]')
      ].find(el =>
        visible(el) &&
        CONFIRM_WORDS.includes(label(el).toLowerCase())
      );

      if (!confirmButton) {
        console.error("Confirmation button not found. Stopping.");
        break;
      }

      confirmButton.click();
    }

    // Verify the post disappears from the current list
    const removed = await waitFor(() => {
      if (!article.isConnected) return true;

      const currentLink = article.querySelector(POST_LINK);

      return !currentLink ||
        currentLink.href.split("?")[0] !== id;
    }, 7000);

    processed.add(id);

    if (!removed) {
      console.warn(
        "Deletion was requested but could not be verified.",
        id
      );
      break;
    }

    deleted++;

    console.log(`✅ Deleted ${deleted}/${initial}`);

    await sleep(1200);
  }

  console.log(
    `Finished. Verified removed: ${deleted}/${initial}`
  );
})();