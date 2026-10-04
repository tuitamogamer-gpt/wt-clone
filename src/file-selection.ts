const MAX_FILES = 100;
const MAX_BYTES = 2 * 1024 * 1024 * 1024;
const PREVIEW_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/bmp",
]);

/** Read dropped files, including every batch in nested directories. */
export async function readDroppedFiles(dataTransfer: DataTransfer): Promise<File[]> {
  // The browser clears DataTransfer after the drop handler returns, so capture
  // entry handles and ordinary files before awaiting any directory reads.
  const sources = Array.from(dataTransfer.items || [])
    .filter((item) => item.kind === "file")
    .map((item) => ({
      entry: item.webkitGetAsEntry?.() ?? null,
      file: item.getAsFile(),
    }));
  const fallback = Array.from(dataTransfer.files);
  const files: File[] = [];
  let bytes = 0;

  function add(file: File, relativePath?: string) {
    if (files.length >= MAX_FILES)
      throw new Error("Možeš dodati najviše 100 datoteka po prijenosu.");
    if (bytes + file.size > MAX_BYTES)
      throw new Error("Ukupna veličina datoteka ne smije prelaziti 2 GB.");
    if (relativePath) {
      try {
        Object.defineProperty(file, "webkitRelativePath", {
          value: relativePath,
          configurable: true,
        });
      } catch {
        // Some browsers do not allow overriding this read-only property.
      }
    }
    files.push(file);
    bytes += file.size;
  }

  async function visit(entry: FileSystemEntry, parent = ""): Promise<void> {
    const path = parent ? `${parent}/${entry.name}` : entry.name;
    const readError = () => new Error(`Nije moguće pročitati „${path}”. Pokušaj ponovno.`);
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => {
        (entry as FileSystemFileEntry).file(resolve, () => reject(readError()));
      });
      add(file, parent ? path : undefined);
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      while (true) {
        const entries = await new Promise<FileSystemEntry[]>((resolve, reject) => {
          reader.readEntries(resolve, () => reject(readError()));
        });
        if (!entries.length) break;
        for (const child of entries) await visit(child, path);
      }
    }
  }

  if (sources.some(({ entry, file }) => entry || file)) {
    for (const { entry, file } of sources) {
      if (entry) await visit(entry);
      else if (file) add(file);
    }
  } else {
    for (const file of fallback) add(file);
  }
  return files;
}

export function canPreview(file: File): boolean {
  return file.size <= 20 * 1024 * 1024 && PREVIEW_TYPES.has(file.type.toLowerCase());
}

export function formatFileCount(count: number): string {
  const lastTwo = Math.abs(count) % 100;
  const last = lastTwo % 10;
  const noun = last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14)
    ? "datoteke"
    : "datoteka";
  return `${count} ${noun}`;
}
