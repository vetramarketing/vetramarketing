import directory from './facebook-group-directory.json';

/** Names supplied by the team, keyed by a numeric Facebook Group ID. */
const namesById = new Map(directory.groups.map(({ facebookId, name }) => [facebookId, name]));
const namesByHandle = new Map(
  directory.handlesWithoutId.map(({ handle, name }) => [handle.toLowerCase(), name]),
);

export function knownFacebookGroupName(facebookId: string): string | undefined {
  return namesById.get(facebookId.trim());
}

export function knownFacebookGroupHandleName(handle: string): string | undefined {
  return namesByHandle.get(handle.trim().toLowerCase());
}

/** Keep a team's own name; replace only an empty name or our generated placeholder. */
export function resolveFacebookGroupName(facebookId: string, currentName = ''): string {
  const placeholder = `Facebook group ${facebookId}`;
  const name = currentName.trim();
  return name && name !== placeholder
    ? currentName
    : knownFacebookGroupName(facebookId) || placeholder;
}
