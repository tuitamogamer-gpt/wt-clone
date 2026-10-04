import type { Transfer, TransferFile } from "./create-transfer";

const STORAGE_KEY = "we-transfer-history";
const MAX_HISTORY = 30;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSize(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function readFile(value: unknown): TransferFile | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !value.id ||
    typeof value.name !== "string" ||
    !value.name ||
    !isSize(value.size) ||
    typeof value.type !== "string"
  )
    return null;

  return { id: value.id, name: value.name, size: value.size, type: value.type };
}

function readTransfer(value: unknown): Transfer | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !/^[a-zA-Z0-9_-]+$/.test(value.id) ||
    typeof value.title !== "string" ||
    typeof value.message !== "string" ||
    !isSize(value.totalSize) ||
    !isDate(value.createdAt) ||
    !isDate(value.expiresAt) ||
    !Array.isArray(value.files) ||
    value.files.length === 0 ||
    value.files.length > 100 ||
    (value.requiresPassword !== undefined &&
      typeof value.requiresPassword !== "boolean")
  )
    return null;

  const files = value.files.map(readFile);
  if (files.some((file) => file === null)) return null;

  // Copy only display metadata. Passwords, upload tokens and storage paths
  // must never be written to the browser's transfer history.
  return {
    id: value.id,
    title: value.title,
    message: value.message,
    files: files as TransferFile[],
    totalSize: value.totalSize,
    createdAt: value.createdAt,
    expiresAt: value.expiresAt,
    ...(value.requiresPassword === undefined
      ? {}
      : { requiresPassword: value.requiresPassword }),
  };
}

function cleanHistory(value: unknown): Transfer[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: Transfer[] = [];
  for (const candidate of value) {
    const transfer = readTransfer(candidate);
    if (transfer && !seen.has(transfer.id)) {
      seen.add(transfer.id);
      result.push(transfer);
      if (result.length === MAX_HISTORY) break;
    }
  }
  return result;
}

export function readHistory(): Transfer[] {
  try {
    return cleanHistory(JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"));
  } catch {
    return [];
  }
}

export function saveHistory(items: Transfer[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cleanHistory(items)));
  } catch {
    // A full or disabled browser store must not interrupt the transfer.
  }
}
