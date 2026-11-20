import packageJson from "../../package.json";

/** The app version from package.json, shown in the sidebar and in Settings → About. */
export const appVersion: string = packageJson.version;

/** SemVer build metadata keeps the upstream version intact for update comparisons. */
export function forkVersion(revision: string): string {
  return `${appVersion}+fork.${revision.slice(0, 12)}`;
}
