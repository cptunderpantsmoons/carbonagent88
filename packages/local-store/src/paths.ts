import path from "node:path";
import os from "node:os";

/**
 * Filesystem Layout
 * 
 * All data lives under ~/.carbon-agent/
 */

export function getCarbonAgentDir(): string {
  return path.join(os.homedir(), ".carbon-agent");
}

export function getDatabasePath(): string {
  return path.join(getCarbonAgentDir(), "carbon.db");
}

export function getVaultDir(workspaceId: string): string {
  return path.join(getCarbonAgentDir(), "vault", workspaceId);
}

export function getDocumentsDir(): string {
  return path.join(getCarbonAgentDir(), "documents");
}

export function getRunsDir(): string {
  return path.join(getCarbonAgentDir(), "runs");
}

export function getRunLogPath(runId: string): string {
  return path.join(getRunsDir(), `${runId}.jsonl`);
}

export function getEmbeddingsDbPath(): string {
  return path.join(getCarbonAgentDir(), "embeddings.db");
}

/**
 * Warns if a path is inside cloud-synced directories.
 */
export function isPathSafeForVault(filePath: string): boolean {
  const checkPath = filePath.toLowerCase();
  const cloudDirs = ["onedrive", "dropbox", "google drive", "box", "icloud"];
  return !cloudDirs.some((d) => checkPath.includes(d));
}

export function getVaultWarningMessage(workspaceId: string): string | null {
  const vaultDir = getVaultDir(workspaceId);
  if (!isPathSafeForVault(vaultDir)) {
    return `Warning: Vault directory for workspace "${workspaceId}" is inside a cloud-synced folder. Consider moving to a local path.`;
  }
  return null;
}
