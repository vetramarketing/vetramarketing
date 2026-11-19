import suppliedScript from './provided-console-scripts.json';
import suppliedAutoScrollScript from './provided-auto-scroll-script.json';
import suppliedGroupHtmlScript from './provided-group-html-script.json';
import suppliedPendingPostsScript from './provided-pending-posts-script.json';
import suppliedPostTableScrollScript from './provided-post-table-scroll-script.json';
import suppliedPostTableHtmlScript from './provided-post-table-html-script.json';
import type { ConsoleScript } from './console-scripts';
import type { Workspace } from './types';
import {
  WorkspaceRevisionConflict,
  type WorkspaceRepository,
  type WorkspaceSnapshot,
} from './workspace-repository';

export const GROUP_CLEANUP_UPDATE = 'facebook-vetra-group-cleanup-2026-11-07';
export const AUTO_SCROLL_UPDATE = 'facebook-very-fast-auto-scroll-2026-11-07';
export const GROUP_HTML_UPDATE = 'facebook-copy-joined-groups-html-2026-11-07';
export const PENDING_POSTS_UPDATE = 'facebook-remove-my-pending-group-posts-2026-11-07';
export const POST_TABLE_SCROLL_UPDATE = 'facebook-post-table-fast-scroll-2026-11-08';
export const POST_TABLE_HTML_UPDATE = 'facebook-copy-post-table-html-2026-11-08';
const { previousCodes, previousDetails, ...currentScript } = suppliedScript;
const {
  previousCodes: previousAutoScrollCodes,
  previousDetails: previousAutoScrollDetails,
  ...currentAutoScrollScript
} = suppliedAutoScrollScript;
const {
  previousCodes: previousPostTableScrollCodes,
  previousDetails: previousPostTableScrollDetails,
  ...currentPostTableScrollScript
} = suppliedPostTableScrollScript;
const {
  previousCodes: previousPostTableHtmlCodes,
  previousDetails: previousPostTableHtmlDetails,
  ...currentPostTableHtmlScript
} = suppliedPostTableHtmlScript;
export const providedGroupCleanupScript: ConsoleScript = currentScript as ConsoleScript;
export const providedAutoScrollScript: ConsoleScript = currentAutoScrollScript as ConsoleScript;
export const providedGroupHtmlScript: ConsoleScript = suppliedGroupHtmlScript as ConsoleScript;
export const providedPendingPostsScript: ConsoleScript =
  suppliedPendingPostsScript as ConsoleScript;
export const providedPostTableScrollScript: ConsoleScript =
  currentPostTableScrollScript as ConsoleScript;
export const providedPostTableHtmlScript: ConsoleScript =
  currentPostTableHtmlScript as ConsoleScript;

/** Add the requested snippet once; later edits, deletion and Trash expiry remain respected. */
function addProvidedGroupCleanupScript(workspace: Workspace): Workspace {
  const applied = workspace.appliedDataUpdates?.includes(GROUP_CLEANUP_UPDATE);
  const appliedDataUpdates = applied
    ? workspace.appliedDataUpdates
    : [...(workspace.appliedDataUpdates ?? []), GROUP_CLEANUP_UPDATE];
  // Upgrade the bundled source and unchanged defaults while respecting custom edits and Trash.
  const previous = workspace.scripts?.find(
    (script) =>
      script.id === suppliedScript.id && !script.deletedAt && previousCodes.includes(script.code),
  );
  if (previous) {
    return {
      ...workspace,
      appliedDataUpdates,
      scripts: workspace.scripts?.map((script) =>
        script === previous
          ? {
              ...script,
              title: previousDetails.some((details) => script.title === details.title)
                ? suppliedScript.title
                : script.title,
              description: previousDetails.some(
                (details) => script.description === details.description,
              )
                ? suppliedScript.description
                : script.description,
              code: suppliedScript.code,
              updatedAt:
                script.updatedAt > suppliedScript.updatedAt
                  ? script.updatedAt
                  : suppliedScript.updatedAt,
            }
          : script,
      ),
    };
  }
  if (applied) return workspace;
  const scripts = workspace.scripts ?? [];
  const existing = scripts.some(
    (script) => script.id === suppliedScript.id || script.code === suppliedScript.code,
  );
  if (!existing && scripts.length >= 10000) throw new Error('Script library is full.');
  return {
    ...workspace,
    scripts: existing ? scripts : [...scripts, { ...providedGroupCleanupScript }],
    appliedDataUpdates,
  };
}

function addProvidedAutoScrollScript(next: Workspace): Workspace {
  const applied = next.appliedDataUpdates?.includes(AUTO_SCROLL_UPDATE);
  const appliedDataUpdates = applied
    ? next.appliedDataUpdates
    : [...(next.appliedDataUpdates ?? []), AUTO_SCROLL_UPDATE];
  const previous = next.scripts?.find(
    (script) =>
      script.id === providedAutoScrollScript.id &&
      !script.deletedAt &&
      previousAutoScrollCodes.includes(script.code),
  );
  if (previous) {
    return {
      ...next,
      appliedDataUpdates,
      scripts: next.scripts?.map((script) =>
        script === previous
          ? {
              ...script,
              title: previousAutoScrollDetails.some((details) => script.title === details.title)
                ? providedAutoScrollScript.title
                : script.title,
              description: previousAutoScrollDetails.some(
                (details) => script.description === details.description,
              )
                ? providedAutoScrollScript.description
                : script.description,
              code: providedAutoScrollScript.code,
              updatedAt:
                script.updatedAt > providedAutoScrollScript.updatedAt
                  ? script.updatedAt
                  : providedAutoScrollScript.updatedAt,
            }
          : script,
      ),
    };
  }
  if (applied) return next;
  const scripts = next.scripts ?? [];
  const existing = scripts.some(
    (script) =>
      script.id === providedAutoScrollScript.id || script.code === providedAutoScrollScript.code,
  );
  if (!existing && scripts.length >= 10000) throw new Error('Script library is full.');
  return {
    ...next,
    scripts: existing ? scripts : [...scripts, { ...providedAutoScrollScript }],
    appliedDataUpdates,
  };
}

function addProvidedGroupHtmlScript(workspace: Workspace): Workspace {
  let next = workspace;
  // Repair only the exact timestamp installed by the initial Thai-locale seed.
  const initialGroupHtmlTimestamp = '2569-11-07T08:24:22.705Z';
  const invalidTimestampScript = next.scripts?.find(
    (script) =>
      script.id === providedGroupHtmlScript.id &&
      (script.createdAt === initialGroupHtmlTimestamp ||
        script.updatedAt === initialGroupHtmlTimestamp),
  );
  if (invalidTimestampScript) {
    next = {
      ...next,
      scripts: next.scripts?.map((script) =>
        script === invalidTimestampScript
          ? {
              ...script,
              createdAt:
                script.createdAt === initialGroupHtmlTimestamp
                  ? providedGroupHtmlScript.createdAt
                  : script.createdAt,
              updatedAt:
                script.updatedAt === initialGroupHtmlTimestamp
                  ? providedGroupHtmlScript.updatedAt
                  : script.updatedAt,
            }
          : script,
      ),
    };
  }
  if (next.appliedDataUpdates?.includes(GROUP_HTML_UPDATE)) return next;
  const scripts = next.scripts ?? [];
  const existing = scripts.some(
    (script) =>
      script.id === providedGroupHtmlScript.id || script.code === providedGroupHtmlScript.code,
  );
  if (!existing && scripts.length >= 10000) throw new Error('Script library is full.');
  return {
    ...next,
    scripts: existing ? scripts : [...scripts, { ...providedGroupHtmlScript }],
    appliedDataUpdates: [...(next.appliedDataUpdates ?? []), GROUP_HTML_UPDATE],
  };
}

function addProvidedScript(next: Workspace, supplied: ConsoleScript, marker: string): Workspace {
  if (next.appliedDataUpdates?.includes(marker)) return next;
  const scripts = next.scripts ?? [];
  const existing = scripts.some(
    (script) => script.id === supplied.id || script.code === supplied.code,
  );
  if (!existing && scripts.length >= 10000) throw new Error('Script library is full.');
  return {
    ...next,
    scripts: existing ? scripts : [...scripts, { ...supplied }],
    appliedDataUpdates: [...(next.appliedDataUpdates ?? []), marker],
  };
}

/** Replace only exact untouched development-preview source for these table helpers. */
function upgradePostTableScript(
  workspace: Workspace,
  supplied: ConsoleScript,
  marker: string,
  previousCodes: readonly string[],
  previousDetails: readonly { title: string; description: string }[],
): Workspace {
  const previous = workspace.scripts?.find(
    (script) =>
      script.id === supplied.id && !script.deletedAt && previousCodes.includes(script.code),
  );
  const next = previous
    ? {
        ...workspace,
        scripts: workspace.scripts?.map((script) =>
          script === previous
            ? {
                ...script,
                code: supplied.code,
                title: previousDetails.some((details) => details.title === script.title)
                  ? supplied.title
                  : script.title,
                description: previousDetails.some(
                  (details) => details.description === script.description,
                )
                  ? supplied.description
                  : script.description,
                updatedAt:
                  script.updatedAt > supplied.updatedAt ? script.updatedAt : supplied.updatedAt,
              }
            : script,
        ),
      }
    : workspace;
  return addProvidedScript(next, supplied, marker);
}

/** Independent markers preserve edits, Trash and removal of each bundled script. */
export function addProvidedConsoleScripts(workspace: Workspace): Workspace {
  let next = addProvidedGroupHtmlScript(
    addProvidedAutoScrollScript(addProvidedGroupCleanupScript(workspace)),
  );
  next = addProvidedScript(next, providedPendingPostsScript, PENDING_POSTS_UPDATE);
  next = upgradePostTableScript(
    next,
    providedPostTableScrollScript,
    POST_TABLE_SCROLL_UPDATE,
    previousPostTableScrollCodes,
    previousPostTableScrollDetails,
  );
  return upgradePostTableScript(
    next,
    providedPostTableHtmlScript,
    POST_TABLE_HTML_UPDATE,
    previousPostTableHtmlCodes,
    previousPostTableHtmlDetails,
  );
}

export async function ensureProvidedConsoleScripts(
  repository: WorkspaceRepository,
  initial: WorkspaceSnapshot,
): Promise<WorkspaceSnapshot> {
  let snapshot = initial;
  const operationId = `${GROUP_CLEANUP_UPDATE}:${crypto.randomUUID()}`;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const workspace = addProvidedConsoleScripts(snapshot.workspace);
    if (workspace === snapshot.workspace) return snapshot;
    try {
      return await repository.commit({
        workspace,
        expectedRevision: snapshot.revision,
        operationId,
      });
    } catch (error) {
      if (!(error instanceof WorkspaceRevisionConflict)) throw error;
      snapshot = await repository.load();
    }
  }
  throw new WorkspaceRevisionConflict();
}
