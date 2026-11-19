import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createEmptyWorkspace, validateWorkspace } from '../src/lib/data';
import {
  addProvidedConsoleScripts,
  AUTO_SCROLL_UPDATE,
  ensureProvidedConsoleScripts,
  GROUP_CLEANUP_UPDATE,
  GROUP_HTML_UPDATE,
  PENDING_POSTS_UPDATE,
  POST_TABLE_SCROLL_UPDATE,
  POST_TABLE_HTML_UPDATE,
  providedPostTableScrollScript,
  providedPostTableHtmlScript,
  providedAutoScrollScript,
  providedGroupCleanupScript,
  providedGroupHtmlScript,
  providedPendingPostsScript,
} from '../src/lib/provided-console-scripts';
import { LocalWorkspaceRepository } from '../src/lib/workspace-repository';
import suppliedScript from '../src/lib/provided-console-scripts.json';
import suppliedAutoScrollScript from '../src/lib/provided-auto-scroll-script.json';
import suppliedPostTableScrollScript from '../src/lib/provided-post-table-scroll-script.json';
import suppliedPostTableHtmlScript from '../src/lib/provided-post-table-html-script.json';

const POST_TABLE_UPDATES = [POST_TABLE_SCROLL_UPDATE, POST_TABLE_HTML_UPDATE];

// Isolate cleanup migrations from the independently bundled snippets below.
const createCleanupWorkspace = () => ({
  ...createEmptyWorkspace(),
  appliedDataUpdates: [
    ...POST_TABLE_UPDATES,
    AUTO_SCROLL_UPDATE,
    GROUP_HTML_UPDATE,
    PENDING_POSTS_UPDATE,
  ],
});

test('requested cleanup script is added once without changing existing records or source', () => {
  const before = createCleanupWorkspace();
  const original = structuredClone(before);
  const next = validateWorkspace(addProvidedConsoleScripts(before));
  assert.deepEqual(before, original);
  assert.deepEqual(next.posts, before.posts);
  assert.equal(next.scripts?.length, 1);
  assert.equal(next.scripts?.[0].companyId, '');
  assert.equal(
    next.scripts?.[0].code,
    readFileSync('public/console-scripts/facebook-remove-vetra-group-posts.js', 'utf8'),
  );
  assert.equal(addProvidedConsoleScripts(next), next);
  const removed = { ...next, scripts: [] };
  assert.equal(addProvidedConsoleScripts(removed), removed);
});

test('existing customized or trashed snippet is preserved instead of overwritten or duplicated', () => {
  for (const deletedAt of [undefined, '2026-11-07T00:00:00.000Z']) {
    const before = createCleanupWorkspace();
    before.scripts = [
      { ...providedGroupCleanupScript, title: 'My version', code: '// custom', deletedAt },
    ];
    assert.deepEqual(addProvidedConsoleScripts(before).scripts, before.scripts);
  }
  const before = createCleanupWorkspace();
  before.scripts = [{ ...providedGroupCleanupScript, id: 'my-imported-copy' }];
  assert.equal(addProvidedConsoleScripts(before).scripts?.length, 1);
});

test('untouched preview source upgrades while preserving metadata, edited code and Trash', () => {
  assert.ok(suppliedScript.previousCodes.length > 0);
  for (const code of suppliedScript.previousCodes) {
    const seeded = addProvidedConsoleScripts(createCleanupWorkspace());
    const preview = {
      ...providedGroupCleanupScript,
      code,
      title: 'My saved title',
      description: 'My notes',
      pinned: true,
      updatedAt: '2026-11-08T00:00:00.000Z',
    };
    const before = { ...seeded, scripts: [preview] };
    const upgraded = addProvidedConsoleScripts(before);
    assert.deepEqual(upgraded.scripts, [{ ...preview, code: providedGroupCleanupScript.code }]);
    assert.equal(before.scripts[0].code, code);
    assert.equal(addProvidedConsoleScripts(upgraded), upgraded);
    for (const saved of [
      { ...preview, code: code + '\n// user edit' },
      { ...preview, deletedAt: '2026-11-08T01:00:00.000Z' },
    ]) {
      const preserved = { ...seeded, scripts: [saved] };
      assert.equal(addProvidedConsoleScripts(preserved), preserved);
    }
  }
});

test('every older bundled default upgrades its instructions without requiring a new update marker', () => {
  assert.ok(suppliedScript.previousDetails.length >= 2);
  for (const code of suppliedScript.previousCodes) {
    for (const details of suppliedScript.previousDetails) {
      const before = addProvidedConsoleScripts(createCleanupWorkspace());
      before.scripts = [{ ...providedGroupCleanupScript, ...details, code }];
      const upgraded = addProvidedConsoleScripts(before);
      assert.deepEqual(upgraded.scripts, [providedGroupCleanupScript]);
      assert.deepEqual(upgraded.appliedDataUpdates, before.appliedDataUpdates);
      assert.equal(addProvidedConsoleScripts(upgraded), upgraded);
    }
  }
});

test('the installed automatic version upgrades once to the corrected removal script', () => {
  const previousCode = suppliedScript.previousCodes.find(
    (code) =>
      createHash('sha256').update(code).digest('hex') ===
      'd391f0e036f703449484cdb3c30cd842f98c749d6845a172d4a7250891277a5d',
  );
  const previousDetails = suppliedScript.previousDetails.find((details) =>
    details.description.includes('Uses varied 2–4 second action pauses'),
  );
  assert.ok(previousCode, 'Retain the exact previously installed automatic script for migration');
  assert.ok(previousDetails, 'Retain the previous default instructions for migration');
  const before = addProvidedConsoleScripts(createCleanupWorkspace());
  before.scripts = [
    {
      ...providedGroupCleanupScript,
      ...previousDetails,
      code: previousCode,
      pinned: true,
      updatedAt: '2026-11-07T00:00:00.001Z',
    },
  ];
  const upgraded = addProvidedConsoleScripts(before);
  assert.deepEqual(upgraded.scripts, [{ ...providedGroupCleanupScript, pinned: true }]);
  assert.deepEqual(upgraded.appliedDataUpdates, before.appliedDataUpdates);
  assert.equal(before.scripts[0].code, previousCode);
  assert.equal(addProvidedConsoleScripts(upgraded), upgraded);
});

test('updating bundled instructions preserves separately customized titles or notes', () => {
  for (const details of suppliedScript.previousDetails) {
    for (const custom of [{ title: 'My cleanup script' }, { description: 'My own instructions' }]) {
      const before = addProvidedConsoleScripts(createCleanupWorkspace());
      before.scripts = [
        {
          ...providedGroupCleanupScript,
          ...details,
          ...custom,
          code: suppliedScript.previousCodes.at(-1)!,
          pinned: true,
        },
      ];
      const upgraded = addProvidedConsoleScripts(before);
      assert.deepEqual(upgraded.scripts, [
        { ...providedGroupCleanupScript, ...custom, pinned: true },
      ]);
      assert.equal(addProvidedConsoleScripts(upgraded), upgraded);
    }
  }
});

test('the installed 400ms cleanup release upgrades while retaining custom edits and Trash', () => {
  const previousCode = suppliedScript.previousCodes.find(
    (code) =>
      createHash('sha256').update(code).digest('hex') ===
      '57c55cdf8b1674416f4d4e13a0b89da1cb186bd0b68ec57f0146a82e02a012a0',
  );
  const previousDetails = suppliedScript.previousDetails.find((details) =>
    details.description.includes('It fast-scrolls every 400ms to load posts'),
  );
  assert.ok(previousCode, 'Retain the exact installed fast-scroll release for existing libraries');
  assert.ok(previousDetails, 'Retain the installed default instructions for migration');
  assert.notEqual(previousCode, providedGroupCleanupScript.code);
  const seeded = addProvidedConsoleScripts(createCleanupWorkspace());
  const old = {
    ...providedGroupCleanupScript,
    ...previousDetails,
    code: previousCode,
    pinned: true,
    updatedAt: '2026-11-07T00:00:00.003Z',
  };
  const before = { ...seeded, scripts: [old] };
  const original = structuredClone(before);
  const upgraded = validateWorkspace(addProvidedConsoleScripts(before));
  assert.deepEqual(before, original);
  assert.deepEqual(upgraded.scripts, [{ ...providedGroupCleanupScript, pinned: true }]);
  assert.deepEqual(upgraded.appliedDataUpdates, before.appliedDataUpdates);
  assert.equal(addProvidedConsoleScripts(upgraded), upgraded);

  const customized = {
    ...old,
    title: 'My cleanup shortcut',
    description: 'Keep my instructions',
    updatedAt: '2026-11-08T00:00:00.000Z',
  };
  assert.deepEqual(addProvidedConsoleScripts({ ...seeded, scripts: [customized] }).scripts, [
    { ...customized, code: providedGroupCleanupScript.code },
  ]);
  for (const saved of [
    { ...customized, code: previousCode + '\n// Keep my custom behavior' },
    { ...old, deletedAt: '2026-11-07T01:00:00.000Z' },
  ]) {
    const retained = { ...seeded, scripts: [saved] };
    assert.equal(addProvidedConsoleScripts(retained), retained);
  }
});

test('supplied cleanup instructions describe very fast scrolling and unverified submissions', () => {
  assert.match(providedGroupCleanupScript.description, /100ms/);
  assert.match(providedGroupCleanupScript.description, /200[–-]800ms/);
  assert.match(providedGroupCleanupScript.description, /without waiting for (?:the )?post/);
  assert.match(providedGroupCleanupScript.description, /not verified/i);
  assert.doesNotMatch(providedGroupCleanupScript.description, /Scan & delete all|manifest|panel/);
  assert.ok(!('previousDetails' in providedGroupCleanupScript));
  assert.ok(!('previousCodes' in providedGroupCleanupScript));
});

test('fresh workspaces receive all independent scripts once with exact auto-scroll source', () => {
  const before = createEmptyWorkspace();
  const original = structuredClone(before);
  const next = validateWorkspace(addProvidedConsoleScripts(before));
  assert.deepEqual(before, original);
  assert.deepEqual(next.posts, before.posts);
  assert.deepEqual(next.scripts, [
    providedGroupCleanupScript,
    providedAutoScrollScript,
    providedGroupHtmlScript,
    providedPendingPostsScript,
    providedPostTableScrollScript,
    providedPostTableHtmlScript,
  ]);
  assert.deepEqual(next.appliedDataUpdates, [
    GROUP_CLEANUP_UPDATE,
    AUTO_SCROLL_UPDATE,
    GROUP_HTML_UPDATE,
    PENDING_POSTS_UPDATE,
    ...POST_TABLE_UPDATES,
  ]);
  assert.equal(providedAutoScrollScript.companyId, '');
  assert.equal(providedAutoScrollScript.platform, 'facebook');
  assert.equal(
    providedAutoScrollScript.code,
    readFileSync('public/console-scripts/facebook-very-fast-auto-scroll.js', 'utf8'),
  );
  assert.match(providedAutoScrollScript.description, /100ms/);
  assert.match(providedAutoScrollScript.description, /Esc while the page is focused/);
  assert.match(providedAutoScrollScript.description, /stopScroll\(\)/);
  assert.match(providedAutoScrollScript.description, /window\.stopFastAutoScroll = true/);
  assert.ok(!('previousCodes' in providedAutoScrollScript));
  assert.ok(!('previousDetails' in providedAutoScrollScript));
  assert.equal(addProvidedConsoleScripts(next), next);
});

test('the previously installed auto-scroll source upgrades once with its marker already applied', () => {
  assert.ok(suppliedAutoScrollScript.previousCodes.length > 0);
  assert.ok(suppliedAutoScrollScript.previousDetails.length > 0);
  for (const code of suppliedAutoScrollScript.previousCodes) {
    const seeded = addProvidedConsoleScripts(createEmptyWorkspace());
    const original = {
      ...providedAutoScrollScript,
      ...suppliedAutoScrollScript.previousDetails[0],
      code,
      pinned: true,
    };
    const before = {
      ...seeded,
      scripts: [providedGroupCleanupScript, original],
    };
    const upgraded = validateWorkspace(addProvidedConsoleScripts(before));
    assert.deepEqual(upgraded.scripts, [
      providedGroupCleanupScript,
      { ...providedAutoScrollScript, pinned: true },
    ]);
    assert.deepEqual(upgraded.appliedDataUpdates, before.appliedDataUpdates);
    assert.equal(before.scripts[1].code, code, 'Migration must not mutate the saved source');
    assert.equal(addProvidedConsoleScripts(upgraded), upgraded);
  }
});

test('the installed stop-shortcut version receives automatic end detection without a new marker', () => {
  const previousCode = suppliedAutoScrollScript.previousCodes.find(
    (code) =>
      createHash('sha256').update(code).digest('hex') ===
      '758aa3f0fb3c254bd64f5f94360fa7acd9e4d5d9bb4cb3d24fc0e24ee413dfb7',
  );
  const previousDetails = suppliedAutoScrollScript.previousDetails.find(
    (details) =>
      details.description.includes('at an unchanged bottom without a loading indicator') &&
      details.description.includes('stopScroll()'),
  );
  assert.ok(previousCode, 'Retain the exact stop-shortcut version for existing libraries');
  assert.ok(previousDetails);
  const seeded = addProvidedConsoleScripts(createEmptyWorkspace());
  const old = {
    ...providedAutoScrollScript,
    ...previousDetails,
    code: previousCode,
    pinned: true,
  };
  const before = { ...seeded, scripts: [providedGroupCleanupScript, old] };
  const upgraded = validateWorkspace(addProvidedConsoleScripts(before));
  assert.deepEqual(upgraded.scripts, [
    providedGroupCleanupScript,
    { ...providedAutoScrollScript, pinned: true },
  ]);
  assert.deepEqual(upgraded.appliedDataUpdates, before.appliedDataUpdates);
  assert.equal(before.scripts[1].code, previousCode);
  assert.equal(addProvidedConsoleScripts(upgraded), upgraded);
});

test('auto-scroll source upgrades preserve custom metadata and the latest saved timestamp', () => {
  const seeded = addProvidedConsoleScripts(createEmptyWorkspace());
  const old = {
    ...providedAutoScrollScript,
    title: 'My scrolling code',
    description: 'My notes',
    code: suppliedAutoScrollScript.previousCodes[0],
    pinned: true,
    updatedAt: '2026-11-08T00:00:00.000Z',
  };
  const before = { ...seeded, scripts: [old] };
  const upgraded = addProvidedConsoleScripts(before);
  assert.deepEqual(upgraded.scripts, [{ ...old, code: providedAutoScrollScript.code }]);
  assert.equal(addProvidedConsoleScripts(upgraded), upgraded);
});

test('the installed auto-stop release upgrades while preserving custom edits and Trash', () => {
  const previousCode = suppliedAutoScrollScript.previousCodes.find(
    (code) =>
      createHash('sha256').update(code).digest('hex') ===
      '9fd6d93e0fded22d38135089810f10d79166c939649acdce7539d8a0cffeb8a2',
  );
  const previousDetails = suppliedAutoScrollScript.previousDetails.find((details) =>
    details.description.includes('If a loading indicator remains without new items for 10 seconds'),
  );
  assert.ok(previousCode, 'Retain the exact installed auto-stop release for existing libraries');
  assert.ok(previousDetails);
  const seeded = addProvidedConsoleScripts(createEmptyWorkspace());
  const old = {
    ...providedAutoScrollScript,
    ...previousDetails,
    code: previousCode,
    pinned: true,
  };
  const before = { ...seeded, scripts: [providedGroupCleanupScript, old] };
  const upgraded = validateWorkspace(addProvidedConsoleScripts(before));
  assert.deepEqual(upgraded.scripts, [
    providedGroupCleanupScript,
    { ...providedAutoScrollScript, pinned: true },
  ]);
  assert.deepEqual(upgraded.appliedDataUpdates, before.appliedDataUpdates);
  assert.equal(before.scripts[1].code, previousCode);
  assert.equal(addProvidedConsoleScripts(upgraded), upgraded);

  for (const saved of [
    { ...old, code: previousCode + '\n// Keep my custom behavior' },
    { ...old, deletedAt: '2026-11-07T09:00:00.000Z' },
  ]) {
    const retained = { ...seeded, scripts: [saved] };
    assert.equal(addProvidedConsoleScripts(retained), retained);
  }
});

test('auto-scroll upgrades preserve custom source, Trash, and expired removed records', () => {
  const seeded = addProvidedConsoleScripts(createEmptyWorkspace());
  for (const saved of [
    {
      ...providedAutoScrollScript,
      code: suppliedAutoScrollScript.previousCodes[0] + '\n// my edit',
    },
    {
      ...providedAutoScrollScript,
      code: suppliedAutoScrollScript.previousCodes[0],
      deletedAt: '2026-11-07T01:00:00.000Z',
    },
  ]) {
    const before = { ...seeded, scripts: [saved] };
    assert.equal(addProvidedConsoleScripts(before), before);
  }
  const removed = { ...seeded, scripts: [providedGroupCleanupScript] };
  assert.equal(addProvidedConsoleScripts(removed), removed);
});

test('adding auto-scroll does not restore a previously removed cleanup script', () => {
  const before = {
    ...createEmptyWorkspace(),
    scripts: [],
    appliedDataUpdates: [
      ...POST_TABLE_UPDATES,
      GROUP_CLEANUP_UPDATE,
      GROUP_HTML_UPDATE,
      PENDING_POSTS_UPDATE,
    ],
  };
  const next = validateWorkspace(addProvidedConsoleScripts(before));
  assert.deepEqual(next.scripts, [providedAutoScrollScript]);
  assert.deepEqual(next.appliedDataUpdates, [
    ...POST_TABLE_UPDATES,
    GROUP_CLEANUP_UPDATE,
    GROUP_HTML_UPDATE,
    PENDING_POSTS_UPDATE,
    AUTO_SCROLL_UPDATE,
  ]);
  assert.equal(addProvidedConsoleScripts(next), next);
});

test('auto-scroll seeding preserves existing cleanup and customized or trashed auto-scroll', () => {
  for (const deletedAt of [undefined, '2026-11-07T00:00:00.000Z']) {
    const scripts = [
      { ...providedGroupCleanupScript, title: 'My removal code', code: '// custom cleanup' },
      {
        ...providedAutoScrollScript,
        title: 'My scrolling code',
        description: 'Retain my notes',
        code: '// custom scrolling',
        pinned: true,
        deletedAt,
      },
    ];
    const before = {
      ...createEmptyWorkspace(),
      scripts,
      appliedDataUpdates: [
        ...POST_TABLE_UPDATES,
        GROUP_CLEANUP_UPDATE,
        GROUP_HTML_UPDATE,
        PENDING_POSTS_UPDATE,
      ],
    };
    const next = addProvidedConsoleScripts(before);
    assert.deepEqual(next.scripts, scripts);
    assert.ok(next.appliedDataUpdates?.includes(AUTO_SCROLL_UPDATE));
    assert.equal(addProvidedConsoleScripts(next), next);
  }
});

test('an imported auto-scroll source is recognized without a duplicate library entry', () => {
  const imported = {
    ...providedAutoScrollScript,
    id: 'my-imported-scroll',
    title: 'Imported copy',
  };
  const before = {
    ...createEmptyWorkspace(),
    scripts: [imported],
    appliedDataUpdates: [
      ...POST_TABLE_UPDATES,
      GROUP_CLEANUP_UPDATE,
      GROUP_HTML_UPDATE,
      PENDING_POSTS_UPDATE,
    ],
  };
  const next = addProvidedConsoleScripts(before);
  assert.deepEqual(next.scripts, [imported]);
  assert.ok(next.appliedDataUpdates?.includes(AUTO_SCROLL_UPDATE));
  assert.equal(addProvidedConsoleScripts(next), next);
});

test('independent markers keep any bundled script removed after seeding', () => {
  const seeded = addProvidedConsoleScripts(createEmptyWorkspace());
  for (const scripts of [
    [providedGroupCleanupScript],
    [providedAutoScrollScript],
    [providedGroupHtmlScript],
    [providedPendingPostsScript],
    [providedPostTableScrollScript],
    [providedPostTableHtmlScript],
    [],
  ]) {
    const before = { ...seeded, scripts };
    assert.equal(addProvidedConsoleScripts(before), before);
  }
});

test('auto-scroll respects library capacity without changing the workspace on failure', () => {
  const scripts = Array.from({ length: 10000 }, (_, index) => ({
    ...providedAutoScrollScript,
    id: `custom-${index}`,
    code: '// custom source',
  }));
  const before = {
    ...createEmptyWorkspace(),
    scripts,
    appliedDataUpdates: [
      ...POST_TABLE_UPDATES,
      GROUP_CLEANUP_UPDATE,
      GROUP_HTML_UPDATE,
      PENDING_POSTS_UPDATE,
    ],
  };
  const original = structuredClone(before);
  assert.throws(() => addProvidedConsoleScripts(before), /Script library is full/);
  assert.deepEqual(before, original);

  scripts[0] = { ...providedAutoScrollScript, id: 'my-imported-scroll' };
  const matched = addProvidedConsoleScripts(before);
  assert.equal(matched.scripts?.length, 10000);
  assert.deepEqual(matched.scripts, before.scripts);
  assert.ok(matched.appliedDataUpdates?.includes(AUTO_SCROLL_UPDATE));
});

test('group HTML copying seeds exact standalone source without restoring removed snippets', () => {
  const before = {
    ...createEmptyWorkspace(),
    scripts: [],
    appliedDataUpdates: [
      ...POST_TABLE_UPDATES,
      GROUP_CLEANUP_UPDATE,
      AUTO_SCROLL_UPDATE,
      PENDING_POSTS_UPDATE,
    ],
  };
  const original = structuredClone(before);
  const next = validateWorkspace(addProvidedConsoleScripts(before));
  assert.deepEqual(before, original);
  assert.deepEqual(next.scripts, [providedGroupHtmlScript]);
  assert.equal(providedGroupHtmlScript.companyId, '');
  assert.equal(providedGroupHtmlScript.platform, 'facebook');
  assert.match(providedGroupHtmlScript.createdAt, /^2026-/);
  assert.match(providedGroupHtmlScript.updatedAt, /^2026-/);
  assert.equal(
    providedGroupHtmlScript.code,
    readFileSync('public/console-scripts/facebook-copy-joined-groups-html.js', 'utf8'),
  );
  assert.deepEqual(next.appliedDataUpdates, [
    ...POST_TABLE_UPDATES,
    GROUP_CLEANUP_UPDATE,
    AUTO_SCROLL_UPDATE,
    PENDING_POSTS_UPDATE,
    GROUP_HTML_UPDATE,
  ]);
  assert.equal(addProvidedConsoleScripts(next), next);
  const removed = { ...next, scripts: [] };
  assert.equal(addProvidedConsoleScripts(removed), removed);
});

test('group HTML seeding preserves custom source, metadata, Trash and imported copies', () => {
  for (const script of [
    { ...providedGroupHtmlScript, title: 'My HTML copier', code: '// my code', pinned: true },
    { ...providedGroupHtmlScript, deletedAt: '2026-11-07T01:00:00.000Z' },
    { ...providedGroupHtmlScript, id: 'imported-html-copy', description: 'Keep my notes' },
  ]) {
    const before = {
      ...createEmptyWorkspace(),
      scripts: [script],
      appliedDataUpdates: [
        ...POST_TABLE_UPDATES,
        GROUP_CLEANUP_UPDATE,
        AUTO_SCROLL_UPDATE,
        PENDING_POSTS_UPDATE,
      ],
    };
    const original = structuredClone(before);
    const next = addProvidedConsoleScripts(before);
    assert.deepEqual(before, original);
    assert.deepEqual(next.scripts, [script]);
    assert.ok(next.appliedDataUpdates?.includes(GROUP_HTML_UPDATE));
    assert.equal(addProvidedConsoleScripts(next), next);
  }
});

test('group HTML repairs only the exact installed Thai-calendar timestamp even after seeding', () => {
  const invalidTimestamp = '2569-11-07T08:24:22.705Z';
  const savedTimestamp = '2026-11-08T01:23:45.678Z';
  const seeded = addProvidedConsoleScripts(createEmptyWorkspace());
  for (const deletedAt of [undefined, '2026-11-08T02:00:00.000Z']) {
    for (const timestamps of [
      { createdAt: invalidTimestamp, updatedAt: invalidTimestamp },
      { createdAt: invalidTimestamp, updatedAt: savedTimestamp },
      { createdAt: savedTimestamp, updatedAt: invalidTimestamp },
    ]) {
      const saved = {
        ...providedGroupHtmlScript,
        ...timestamps,
        title: 'My HTML copier',
        description: 'Keep my notes',
        code: '// my edited code',
        pinned: true,
        deletedAt,
      };
      const unrelated = { ...saved, id: 'another-html-copy' };
      const before = { ...seeded, scripts: [saved, unrelated] };
      const original = structuredClone(before);
      const repaired = addProvidedConsoleScripts(before);
      assert.deepEqual(before, original);
      assert.deepEqual(repaired.scripts, [
        {
          ...saved,
          createdAt:
            saved.createdAt === invalidTimestamp
              ? providedGroupHtmlScript.createdAt
              : saved.createdAt,
          updatedAt:
            saved.updatedAt === invalidTimestamp
              ? providedGroupHtmlScript.updatedAt
              : saved.updatedAt,
        },
        unrelated,
      ]);
      assert.deepEqual(repaired.appliedDataUpdates, before.appliedDataUpdates);
      assert.equal(addProvidedConsoleScripts(repaired), repaired);
    }
  }
});

test('group HTML timestamp repair leaves modern and other custom timestamps unchanged', () => {
  const seeded = addProvidedConsoleScripts(createEmptyWorkspace());
  for (const timestamp of [
    providedGroupHtmlScript.createdAt,
    '2026-11-08T01:23:45.678Z',
    '2569-11-07T08:24:22.706Z',
  ]) {
    const before = {
      ...seeded,
      scripts: [{ ...providedGroupHtmlScript, createdAt: timestamp, updatedAt: timestamp }],
    };
    assert.equal(addProvidedConsoleScripts(before), before);
  }
});

test('group HTML seeding respects library capacity and recognizes a full-library imported copy', () => {
  const scripts = Array.from({ length: 10000 }, (_, index) => ({
    ...providedGroupHtmlScript,
    id: `custom-${index}`,
    code: '// custom source',
  }));
  const before = {
    ...createEmptyWorkspace(),
    scripts,
    appliedDataUpdates: [
      ...POST_TABLE_UPDATES,
      GROUP_CLEANUP_UPDATE,
      AUTO_SCROLL_UPDATE,
      PENDING_POSTS_UPDATE,
    ],
  };
  const original = structuredClone(before);
  assert.throws(() => addProvidedConsoleScripts(before), /Script library is full/);
  assert.deepEqual(before, original);

  scripts[0] = { ...providedGroupHtmlScript, id: 'imported-html-copy' };
  const matched = addProvidedConsoleScripts(before);
  assert.equal(matched.scripts?.length, 10000);
  assert.deepEqual(matched.scripts, before.scripts);
  assert.ok(matched.appliedDataUpdates?.includes(GROUP_HTML_UPDATE));
});

test('pending-post removal seeds exact standalone source once without restoring removed scripts', () => {
  const before = {
    ...createEmptyWorkspace(),
    scripts: [],
    appliedDataUpdates: [
      ...POST_TABLE_UPDATES,
      GROUP_CLEANUP_UPDATE,
      AUTO_SCROLL_UPDATE,
      GROUP_HTML_UPDATE,
    ],
  };
  const original = structuredClone(before);
  const next = validateWorkspace(addProvidedConsoleScripts(before));
  assert.deepEqual(before, original);
  assert.deepEqual(next.posts, before.posts);
  assert.deepEqual(next.groups, before.groups);
  assert.deepEqual(next.scripts, [providedPendingPostsScript]);
  assert.equal(providedPendingPostsScript.id, 'facebook-remove-my-pending-group-posts');
  assert.equal(providedPendingPostsScript.companyId, '');
  assert.equal(providedPendingPostsScript.platform, 'facebook');
  assert.match(providedPendingPostsScript.createdAt, /^2026-/);
  assert.match(providedPendingPostsScript.updatedAt, /^2026-/);
  assert.equal(
    providedPendingPostsScript.code,
    readFileSync('public/console-scripts/facebook-remove-my-pending-group-posts.js', 'utf8'),
  );
  assert.deepEqual(next.appliedDataUpdates, [
    ...POST_TABLE_UPDATES,
    GROUP_CLEANUP_UPDATE,
    AUTO_SCROLL_UPDATE,
    GROUP_HTML_UPDATE,
    PENDING_POSTS_UPDATE,
  ]);
  assert.equal(addProvidedConsoleScripts(next), next);
  const removed = { ...next, scripts: [] };
  assert.equal(addProvidedConsoleScripts(removed), removed);
});

test('pending-post seeding preserves custom code, metadata, Trash and imported copies', () => {
  for (const script of [
    {
      ...providedPendingPostsScript,
      title: 'My pending-post remover',
      description: 'Keep my instructions',
      code: '// my custom removal code',
      pinned: true,
    },
    { ...providedPendingPostsScript, deletedAt: '2026-11-07T01:00:00.000Z' },
    {
      ...providedPendingPostsScript,
      id: 'my-imported-pending-post-copy',
      description: 'Imported instructions',
    },
    {
      ...providedPendingPostsScript,
      id: 'my-trashed-imported-pending-post-copy',
      deletedAt: '2026-11-07T01:00:00.000Z',
    },
  ]) {
    const before = {
      ...createEmptyWorkspace(),
      scripts: [script],
      appliedDataUpdates: [
        ...POST_TABLE_UPDATES,
        GROUP_CLEANUP_UPDATE,
        AUTO_SCROLL_UPDATE,
        GROUP_HTML_UPDATE,
      ],
    };
    const original = structuredClone(before);
    const next = addProvidedConsoleScripts(before);
    assert.deepEqual(before, original);
    assert.deepEqual(next.scripts, [script]);
    assert.ok(next.appliedDataUpdates?.includes(PENDING_POSTS_UPDATE));
    assert.equal(addProvidedConsoleScripts(next), next);
  }
});

test('pending-post seeding respects capacity and recognizes existing copies in a full library', () => {
  const scripts = Array.from({ length: 10000 }, (_, index) => ({
    ...providedPendingPostsScript,
    id: `custom-${index}`,
    code: '// custom source',
  }));
  const before = {
    ...createEmptyWorkspace(),
    scripts,
    appliedDataUpdates: [
      ...POST_TABLE_UPDATES,
      GROUP_CLEANUP_UPDATE,
      AUTO_SCROLL_UPDATE,
      GROUP_HTML_UPDATE,
    ],
  };
  const original = structuredClone(before);
  assert.throws(() => addProvidedConsoleScripts(before), /Script library is full/);
  assert.deepEqual(before, original);

  for (const existing of [
    { ...providedPendingPostsScript, id: 'my-imported-pending-post-copy' },
    { ...providedPendingPostsScript, code: '// my saved code' },
  ]) {
    scripts[0] = existing;
    const matched = addProvidedConsoleScripts(before);
    assert.equal(matched.scripts?.length, 10000);
    assert.deepEqual(matched.scripts, before.scripts);
    assert.ok(matched.appliedDataUpdates?.includes(PENDING_POSTS_UPDATE));
  }
});

test('seeding retries a revision conflict and retains concurrent workspace changes', async () => {
  const values = new Map<string, string>();
  const repository = new LocalWorkspaceRepository(
    {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value);
      },
    },
    null,
  );
  const initial = await repository.load();
  const edited = structuredClone(initial.workspace);
  edited.companies[0].ownerName = 'Retain this edit';
  await repository.commit({
    workspace: edited,
    expectedRevision: initial.revision,
    operationId: 'concurrent-edit',
  });
  const saved = await ensureProvidedConsoleScripts(repository, initial);
  assert.equal(saved.workspace.companies[0].ownerName, 'Retain this edit');
  assert.equal(saved.workspace.scripts?.length, 6);
  assert.deepEqual((await repository.load()).workspace.scripts, saved.workspace.scripts);
});

const postTableScripts = [
  [providedPostTableScrollScript, POST_TABLE_SCROLL_UPDATE],
  [providedPostTableHtmlScript, POST_TABLE_HTML_UPDATE],
] as const;

for (const [provided, marker] of postTableScripts) {
  const isolatedWorkspace = () => ({
    ...createEmptyWorkspace(),
    appliedDataUpdates: [
      GROUP_CLEANUP_UPDATE,
      AUTO_SCROLL_UPDATE,
      GROUP_HTML_UPDATE,
      PENDING_POSTS_UPDATE,
      ...POST_TABLE_UPDATES.filter((item) => item !== marker),
    ],
  });

  test(`${provided.id} seeds exact standalone source once and preserves workspace data`, () => {
    const before = isolatedWorkspace();
    const original = structuredClone(before);
    const next = validateWorkspace(addProvidedConsoleScripts(before));
    assert.deepEqual(before, original);
    assert.deepEqual(next.posts, before.posts);
    assert.deepEqual(next.groups, before.groups);
    assert.deepEqual(next.scripts, [provided]);
    assert.equal(provided.companyId, '');
    assert.equal(provided.platform, 'facebook');
    assert.ok(!('previousCodes' in provided));
    assert.ok(!('previousDetails' in provided));
    assert.match(provided.createdAt, /^2026-11-08T/);
    assert.match(provided.description, /EN:.*Content library/);
    assert.match(provided.description, /TH:.*คลังเนื้อหา/);
    assert.equal(provided.code, readFileSync(`public/console-scripts/${provided.id}.js`, 'utf8'));
    assert.deepEqual(next.appliedDataUpdates, [...before.appliedDataUpdates, marker]);
    assert.equal(addProvidedConsoleScripts(next), next);
    const removed = { ...next, scripts: [] };
    assert.equal(addProvidedConsoleScripts(removed), removed);
  });

  test(`${provided.id} preserves custom edits, Trash and imported source copies`, () => {
    for (const script of [
      {
        ...provided,
        title: 'My table helper',
        description: 'My notes',
        code: '// custom',
        pinned: true,
      },
      { ...provided, deletedAt: '2026-11-08T01:00:00.000Z' },
      { ...provided, id: 'imported-table-helper', description: 'Imported notes' },
      { ...provided, id: 'trashed-table-helper', deletedAt: '2026-11-08T01:00:00.000Z' },
    ]) {
      const before = { ...isolatedWorkspace(), scripts: [script] };
      const original = structuredClone(before);
      const next = addProvidedConsoleScripts(before);
      assert.deepEqual(before, original);
      assert.deepEqual(next.scripts, [script]);
      assert.ok(next.appliedDataUpdates?.includes(marker));
      assert.equal(addProvidedConsoleScripts(next), next);
    }
  });

  test(`${provided.id} respects library capacity and recognizes existing full-library copies`, () => {
    const scripts = Array.from({ length: 10000 }, (_, index) => ({
      ...provided,
      id: `custom-${index}`,
      code: '// custom source',
    }));
    const before = { ...isolatedWorkspace(), scripts };
    const original = structuredClone(before);
    assert.throws(() => addProvidedConsoleScripts(before), /Script library is full/);
    assert.deepEqual(before, original);
    scripts[0] = { ...provided, id: 'imported-table-helper' };
    const next = addProvidedConsoleScripts(before);
    assert.equal(next.scripts?.length, 10000);
    assert.deepEqual(next.scripts, scripts);
    assert.ok(next.appliedDataUpdates?.includes(marker));
  });
}

test('untouched table-helper previews upgrade after seeding while preserving user edits and Trash', () => {
  assert.ok(suppliedPostTableScrollScript.previousCodes.length > 0);
  for (const [provided, supplied] of [
    [providedPostTableScrollScript, suppliedPostTableScrollScript],
    [providedPostTableHtmlScript, suppliedPostTableHtmlScript],
  ] as const) {
    for (const code of supplied.previousCodes) {
      const seeded = addProvidedConsoleScripts(createEmptyWorkspace());
      const preview = {
        ...provided,
        ...supplied.previousDetails[0],
        code,
        pinned: true,
      };
      const before = { ...seeded, scripts: [preview] };
      const original = structuredClone(before);
      const upgraded = validateWorkspace(addProvidedConsoleScripts(before));
      assert.deepEqual(before, original);
      assert.deepEqual(upgraded.scripts, [{ ...provided, pinned: true }]);
      assert.deepEqual(upgraded.appliedDataUpdates, before.appliedDataUpdates);
      assert.equal(addProvidedConsoleScripts(upgraded), upgraded);

      const customized = {
        ...preview,
        title: 'My table helper',
        description: 'Keep these notes',
        updatedAt: '2030-11-08T00:00:00.000Z',
      };
      assert.deepEqual(addProvidedConsoleScripts({ ...seeded, scripts: [customized] }).scripts, [
        { ...customized, code: provided.code },
      ]);
      for (const saved of [
        { ...customized, code: code + '\n// User source change' },
        { ...customized, deletedAt: '2026-11-08T01:00:00.000Z' },
      ]) {
        const preserved = { ...seeded, scripts: [saved] };
        assert.equal(addProvidedConsoleScripts(preserved), preserved);
      }
    }
  }
});
