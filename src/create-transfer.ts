export type TransferFile = {
  id: string;
  name: string;
  size: number;
  type: string;
};
export type Transfer = {
  id: string;
  title: string;
  message: string;
  files: TransferFile[];
  totalSize: number;
  createdAt: string;
  expiresAt: string;
  requiresPassword?: boolean;
};

type TransferInput = {
  files: File[];
  title: string;
  message: string;
  expiresIn: string;
  password: string;
  sender?: string;
  recipient?: string;
};

async function request<T>(
  url: string,
  signal: AbortSignal,
  body?: unknown,
): Promise<T> {
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    signal,
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const data = await response.json().catch(() => {
    throw new Error("Poslužitelj nije dostupan. Pokušaj ponovno.");
  });
  if (!response.ok)
    throw new Error(data.error || "Prijenos nije uspio. Pokušaj ponovno.");
  return data;
}

function localUpload(
  input: TransferInput,
  progress: (value: number) => void,
  signal: AbortSignal,
): Promise<Transfer> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const cleanup = () => signal.removeEventListener("abort", abort);
    const body = new FormData();
    input.files.forEach((file) => body.append("files", file));
    for (const [key, value] of Object.entries(input)) {
      if (key !== "files" && typeof value === "string") body.append(key, value);
    }
    xhr.open("POST", "/api/transfers");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable)
        progress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      cleanup();
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else
          reject(
            new Error(data.error || "Prijenos nije uspio. Pokušaj ponovno."),
          );
      } catch {
        reject(new Error("Poslužitelj nije dostupan. Pokušaj ponovno."));
      }
    };
    xhr.onerror = () => {
      cleanup();
      reject(
        new Error("Veza je prekinuta. Provjeri internet i pokušaj ponovno."),
      );
    };
    xhr.onabort = () => {
      cleanup();
      reject(new DOMException("Prijenos je otkazan.", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    xhr.send(body);
  });
}

export async function createTransfer(
  input: TransferInput,
  progress: (value: number) => void,
  signal: AbortSignal,
): Promise<Transfer> {
  const config = await request<{ uploadMode: "local" | "blob" }>(
    "/api/config",
    signal,
  );
  if (config.uploadMode === "local")
    return localUpload(input, progress, signal);
  if (config.uploadMode !== "blob")
    throw new Error("Pohrana datoteka trenutačno nije dostupna.");

  const { upload } = await import("@vercel/blob/client");
  signal.throwIfAborted();
  const draft = await request<{
    id: string;
    uploadToken: string;
    files: (TransferFile & { pathname: string })[];
  }>("/api/transfers/init", signal, {
    ...input,
    files: input.files.map((file) => ({
      name: file.name,
      size: file.size,
      type: file.type || "application/octet-stream",
    })),
  });
  const total = input.files.reduce((sum, file) => sum + file.size, 0);
  let completed = 0;
  for (let i = 0; i < input.files.length; i++) {
    signal.throwIfAborted();
    const file = input.files[i];
    await upload(draft.files[i].pathname, file, {
      access: "private",
      handleUploadUrl: "/api/blob/upload",
      clientPayload: JSON.stringify({ uploadToken: draft.uploadToken }),
      contentType: draft.files[i].type,
      multipart: file.size > 5 * 1024 * 1024,
      abortSignal: signal,
      onUploadProgress: (event) =>
        progress(
          Math.min(
            100,
            Math.round(
              ((completed + Math.min(event.loaded, file.size)) /
                Math.max(total, 1)) *
                100,
            ),
          ),
        ),
    });
    completed += file.size;
    progress(
      total
        ? Math.round((completed / total) * 100)
        : Math.round(((i + 1) / input.files.length) * 100),
    );
  }
  return request<Transfer>(`/api/transfers/${draft.id}/complete`, signal, {
    uploadToken: draft.uploadToken,
  });
}
