(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const articleSelector = '[role="article"]';
  const deleteSelector =
    '[role="button"][aria-label="ลบ"]:not([aria-disabled="true"]):not([aria-hidden="true"])';

  const total = document.querySelectorAll(articleSelector).length;

  if (!document.body.innerText.includes("รอดำเนินการ") || !total) {
    console.error("Open the Facebook Pending Posts page first.");
    return;
  }

  if (!confirm(`Delete all ${total} pending posts?`)) return;

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
    deleteButton.click();
    await sleep(700);

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
