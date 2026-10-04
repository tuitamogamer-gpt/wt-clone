import { useCallback, useEffect, useRef, useState } from "react";
import type { DragEvent, FormEvent, ReactNode } from "react";
import { createTransfer } from "./create-transfer";
import type { Transfer } from "./create-transfer";
import { useTransferService } from "./use-transfer-service";
import {
  canPreview,
  readDroppedFiles,
  formatFileCount,
} from "./file-selection";
import { FilePreview, FileThumbnail } from "./components/FilePreview";
import { TransferHistory } from "./components/TransferHistory";
import { readHistory as getHistory, saveHistory } from "./history";
import {
  ArrowUpRight,
  ArrowRight,
  Plus,
  Link,
  Mail,
  X,
  Check,
  Copy,
  Clock3,
  LockKeyhole,
  ShieldCheck,
  ChevronDown,
  Download,
  File,
  FileImage,
  FileVideo,
  FileAudio,
  FileText,
  FolderPlus,
  SlidersHorizontal,
  Globe2,
  MoveUpRight,
  LoaderCircle,
  Send,
  CircleHelp,
  Sparkles,
  CloudOff,
  WifiOff,
  RefreshCw,
  Upload,
  Eye,
  EyeOff,
} from "lucide-react";

type ModalName =
  | "how"
  | "about"
  | "help"
  | "history"
  | "settings"
  | "privacy"
  | "terms"
  | null;
const LIMIT = 2 * 1024 * 1024 * 1024;

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 3);
  return `${(bytes / 1024 ** unit).toLocaleString("hr-HR", { maximumFractionDigits: unit ? 1 : 0 })} ${["B", "KB", "MB", "GB"][unit]}`;
}
function formatDate(date: string) {
  return new Date(date).toLocaleDateString("hr-HR", {
    day: "numeric",
    month: "long",
  });
}
function transferUrl(id: string) {
  return `${window.location.origin}/t/${id}`;
}
function FileIcon({ name }: { name: string }) {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  const Icon = /^(jpg|jpeg|png|gif|svg|webp|heic)$/.test(ext)
    ? FileImage
    : /^(mp4|mov|webm|avi)$/.test(ext)
      ? FileVideo
      : /^(mp3|wav|flac|m4a)$/.test(ext)
        ? FileAudio
        : /^(pdf|txt|docx|md)$/.test(ext)
          ? FileText
          : File;
  return (
    <span className={`file-icon ${Icon === FileImage ? "image-file" : ""}`}>
      <Icon size={19} strokeWidth={1.6} />
    </span>
  );
}
function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab") {
        const nodes = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]',
          ) || [],
        ).filter((node) => node.getClientRects().length > 0);
        if (!nodes?.length) return;
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === ref.current)
        ) {
          event.preventDefault();
          last.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last ||
            document.activeElement === ref.current)
        ) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", handler);
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`modal ${wide ? "wide-modal" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabIndex={-1}
        ref={ref}
      >
        <div className="modal-heading">
          <h2 id="modal-title">{title}</h2>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Zatvori"
          >
            <X size={21} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function App() {
  const [modal, setModal] = useState<ModalName>(null);
  const [mode, setMode] = useState<"link" | "email">("link");
  const [files, setFiles] = useState<File[]>([]);
  const latestFiles = useRef(files);
  latestFiles.current = files;
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [sender, setSender] = useState("");
  const [recipient, setRecipient] = useState("");
  const [expires, setExpires] = useState("7");
  const [password, setPassword] = useState("");
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<"idle" | "uploading" | "success">(
    "idle",
  );
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<Transfer | null>(null);
  const [copied, setCopied] = useState(false);
  const [toast, setToast] = useState("");
  const [history, setHistory] = useState<Transfer[]>(getHistory);
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem("wt-theme");
      return saved && ["sage", "lilac", "peach"].includes(saved)
        ? saved
        : "sage";
    } catch {
      return "sage";
    }
  });
  const { state: serviceState, check: checkService } = useTransferService();
  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [readingDrop, setReadingDrop] = useState(false);
  const dragDepth = useRef(0);
  const [faq, setFaq] = useState<number | null>(0);
  const [downloadTransfer, setDownloadTransfer] = useState<Transfer | null>(
    null,
  );
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const [downloadFailure, setDownloadFailure] = useState<
    "missing" | "unavailable"
  >("missing");
  const [downloadRetry, setDownloadRetry] = useState(0);
  const [unlockPassword, setUnlockPassword] = useState("");
  const [token, setToken] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const uploadController = useRef<AbortController | null>(null);
  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  const downloadId = window.location.pathname.match(
    /^\/t\/([a-zA-Z0-9_-]+)\/?$/,
  )?.[1];

  useEffect(() => {
    const clearDrag = () => {
      dragDepth.current = 0;
      setDragging(false);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") clearDrag();
    };
    window.addEventListener("blur", clearDrag);
    window.addEventListener("dragend", clearDrag);
    window.addEventListener("keydown", onEscape);
    return () => {
      window.removeEventListener("blur", clearDrag);
      window.removeEventListener("dragend", clearDrag);
      window.removeEventListener("keydown", onEscape);
    };
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("wt-theme", theme);
    } catch {
      /* Preferences are optional. */
    }
  }, [theme]);
  useEffect(() => {
    const syncHistory = (event: StorageEvent) => {
      if (event.key === "we-transfer-history") setHistory(getHistory());
    };
    window.addEventListener("storage", syncHistory);
    return () => window.removeEventListener("storage", syncHistory);
  }, []);
  useEffect(() => {
    if (status !== "uploading") return;
    const preventLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventLeaving);
    return () => window.removeEventListener("beforeunload", preventLeaving);
  }, [status]);
  useEffect(() => () => uploadController.current?.abort(), []);
  useEffect(() => {
    if (!token || !downloadTransfer?.requiresPassword) return;
    const expiresAt = Number(token.split(".").at(-2));
    if (!Number.isFinite(expiresAt)) return;
    const timeout = window.setTimeout(
      () => {
        setToken("");
        setUnlockPassword("");
        setDownloadError("Za nastavak ponovno unesi lozinku.");
      },
      Math.max(0, expiresAt - Date.now()),
    );
    return () => clearTimeout(timeout);
  }, [token, downloadTransfer?.requiresPassword]);
  useEffect(() => {
    if (toast) {
      const timer = window.setTimeout(() => setToast(""), 3500);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  useEffect(() => {
    if (!downloadId) return;
    const controller = new AbortController();
    setDownloadLoading(true);
    setDownloadError("");
    fetch(`/api/transfers/${downloadId}`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok)
          throw Object.assign(
            new Error(data.error || "Prijenos nije dostupan."),
            { status: response.status },
          );
        setDownloadTransfer(data);
      })
      .catch((err) => {
        if (err.name !== "AbortError") {
          setDownloadFailure(
            [404, 410].includes(err.status) ? "missing" : "unavailable",
          );
          setDownloadError(
            [404, 410].includes(err.status)
              ? err.message
              : "Ne možemo dohvatiti datoteke. Pokušaj ponovno za koji trenutak.",
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setDownloadLoading(false);
      });
    return () => controller.abort();
  }, [downloadId, downloadRetry]);

  function addFiles(incoming: FileList | File[]) {
    setError("");
    const next = [...latestFiles.current];
    for (const file of Array.from(incoming)) {
      if (
        !next.some(
          (f) =>
            f.name === file.name &&
            f.size === file.size &&
            f.lastModified === file.lastModified &&
            f.webkitRelativePath === file.webkitRelativePath,
        )
      )
        next.push(file);
    }
    if (next.length > 100) {
      setError("U jedan prijenos možeš dodati najviše 100 datoteka.");
      return;
    }
    if (next.reduce((sum, file) => sum + file.size, 0) > LIMIT) {
      setError("Datoteke zajedno mogu imati najviše 2 GB.");
      return;
    }
    setFiles(next);
  }
  function updateHistory(items: Transfer[]) {
    setHistory(items);
    saveHistory(items);
  }
  function isFileDrag(event: DragEvent) {
    return Array.from(event.dataTransfer.types).includes("Files");
  }
  const canDrop =
    !downloadId && status === "idle" && !modal && !previewFile && !readingDrop;
  async function dropFiles(event: DragEvent) {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (!canDrop) return;
    setReadingDrop(true);
    try {
      const dropped = await readDroppedFiles(event.dataTransfer);
      if (!dropped.length) throw new Error("U odabranoj mapi nema datoteka.");
      addFiles(dropped);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Nije moguće otvoriti ovu mapu. Pokušaj s odabirom datoteka.",
      );
    } finally {
      setReadingDrop(false);
    }
  }
  async function copyLink(id: string) {
    const url = transferUrl(id);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setToast("Poveznica je kopirana. Spremna za dijeljenje!");
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      const field = document.createElement("textarea");
      field.value = url;
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.appendChild(field);
      field.select();
      const didCopy = document.execCommand("copy");
      field.remove();
      setToast(
        didCopy
          ? "Poveznica je kopirana."
          : "Označi i kopiraj poveznicu iz polja.",
      );
    }
  }
  function reset() {
    setStatus("idle");
    setFiles([]);
    setTitle("");
    setMessage("");
    setError("");
    setCreated(null);
    setProgress(0);
    setPassword("");
    setPasswordVisible(false);
  }
  async function upload(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (serviceState !== "ready" || readingDrop) {
      void checkService();
      return;
    }
    if (!files.length) {
      inputRef.current?.click();
      return;
    }
    if (mode === "email" && (!sender || !recipient)) {
      setError("Upiši svoju i primateljevu e-adresu.");
      return;
    }
    const controller = new AbortController();
    uploadController.current = controller;
    setStatus("uploading");
    setProgress(0);
    try {
      const data = await createTransfer(
        {
          files,
          title: title.trim(),
          message: message.trim(),
          expiresIn: expires,
          password,
          ...(mode === "email" ? { sender, recipient } : {}),
        },
        setProgress,
        controller.signal,
      );
      setCreated(data);
      setStatus("success");
      const updated = [data, ...getHistory()].slice(0, 30);
      updateHistory(updated);
    } catch (err) {
      setStatus("idle");
      setProgress(0);
      if (!controller.signal.aborted) {
        void checkService();
        setError(
          err instanceof Error
            ? err.message
            : "Prijenos nije uspio. Pokušaj ponovno.",
        );
      }
    } finally {
      if (uploadController.current === controller)
        uploadController.current = null;
    }
  }
  async function unlock(event: FormEvent) {
    event.preventDefault();
    setUnlocking(true);
    setDownloadError("");
    try {
      const response = await fetch(`/api/transfers/${downloadId}/unlock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: unlockPassword }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Lozinka nije ispravna.");
      setDownloadTransfer(data.transfer || data);
      setToken(data.token);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : "Pokušaj ponovno.");
    } finally {
      setUnlocking(false);
    }
  }
  const emailHref = created
    ? `mailto:${encodeURIComponent(recipient)}?subject=${encodeURIComponent(created.title || "Datoteke za tebe")}&body=${encodeURIComponent(`${message ? message + "\n\n" : ""}Preuzmi datoteke: ${transferUrl(created.id)}\n\nPoveznica vrijedi do ${formatDate(created.expiresAt)}.\n${sender ? "Šalje: " + sender : ""}`)}`
    : "#";
  const closeModal = useCallback(() => {
    setModal(null);
    setPasswordVisible(false);
  }, []);
  const closePreview = useCallback(() => setPreviewFile(null), []);

  return (
    <div
      className={`app theme-${theme}`}
      onDragEnter={(event) => {
        if (isFileDrag(event)) {
          event.preventDefault();
          if (canDrop) {
            dragDepth.current += 1;
            setDragging(true);
          }
        }
      }}
      onDragOver={(event) => {
        if (isFileDrag(event)) {
          event.preventDefault();
          event.dataTransfer.dropEffect = canDrop ? "copy" : "none";
        }
      }}
      onDragLeave={(event) => {
        if (isFileDrag(event)) {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (!dragDepth.current) setDragging(false);
        }
      }}
      onDrop={dropFiles}
    >
      {dragging && canDrop && (
        <div className="page-drop-overlay" aria-hidden="true">
          <div>
            <Upload size={42} strokeWidth={1.5} />
            <h2>Pusti ideje ovdje.</h2>
            <p>Datoteke ili cijela mapa. Do 2 GB.</p>
          </div>
        </div>
      )}
      <header className="header">
        <a className="brand" href="/" aria-label="WT Transfer početna">
          <span className="brand-mark">
            wt<span>.</span>
          </span>
          <span className="brand-caption">
            transfer
            <br />
            <small>IDEJE U POKRETU</small>
          </span>
        </a>
        <nav className="nav" aria-label="Glavna navigacija">
          <button onClick={() => setModal("how")}>
            Kako radi <ChevronDown size={14} />
          </button>
          <button onClick={() => setModal("about")}>
            Za tvoje ideje <ArrowUpRight size={15} />
          </button>
          <span className="nav-separator" />
          <button className="help-nav" onClick={() => setModal("help")}>
            Pomoć
          </button>
          <button
            className="history-button"
            onClick={() => {
              setHistory(getHistory());
              setModal("history");
            }}
          >
            Moji prijenosi <ArrowUpRight size={16} />
          </button>
        </nav>
      </header>

      <main>
        <div className="main-layout">
          <section
            className="transfer-column"
            aria-label={downloadId ? "Preuzimanje datoteka" : "Novi prijenos"}
          >
            {!downloadId &&
              (serviceState === "unavailable" ||
                serviceState === "offline") && (
                <div className="service-notice" role="status">
                  <span className="service-notice-icon">
                    {serviceState === "offline" ? (
                      <WifiOff size={19} />
                    ) : (
                      <CloudOff size={19} />
                    )}
                  </span>
                  <div>
                    <strong>
                      {serviceState === "offline"
                        ? "Nema internetske veze"
                        : "Slanje je trenutačno na pauzi"}
                    </strong>
                    <p>
                      Možeš odabrati i pregledati datoteke. Ostaju samo na tvom
                      uređaju.
                    </p>
                    <button
                      className="notice-retry"
                      onClick={() => void checkService()}
                    >
                      <RefreshCw size={13} /> Provjeri ponovno
                    </button>
                  </div>
                </div>
              )}
            <div className="transfer-card">
              {downloadId ? (
                <div className="download-content">
                  {downloadLoading ? (
                    <div className="loading-state">
                      <LoaderCircle className="spin" size={36} />
                      <h2>Samo trenutak...</h2>
                      <p>Pripremamo tvoje datoteke.</p>
                    </div>
                  ) : downloadTransfer ? (
                    <>
                      <div className="success-icon">
                        {downloadTransfer.requiresPassword && !token ? (
                          <LockKeyhole size={31} />
                        ) : (
                          <Download size={31} />
                        )}
                      </div>
                      <div className="state-eyebrow">NEŠTO DOBRO JE STIGLO</div>
                      <h2>{downloadTransfer.title || "Datoteke za tebe."}</h2>
                      {downloadTransfer.requiresPassword && !token ? (
                        <form onSubmit={unlock} className="unlock-form">
                          <p>
                            Ovaj je prijenos zaštićen lozinkom. Unesi je za
                            preuzimanje.
                          </p>
                          <label className="field">
                            <span>Lozinka</span>
                            <input
                              type="password"
                              value={unlockPassword}
                              onChange={(e) =>
                                setUnlockPassword(e.target.value)
                              }
                              required
                              autoFocus
                              placeholder="Unesi lozinku"
                            />
                          </label>
                          {downloadError && (
                            <p className="error-message" role="alert">
                              {downloadError}
                            </p>
                          )}
                          <button
                            className="primary-button"
                            disabled={unlocking}
                          >
                            {unlocking ? (
                              <LoaderCircle className="spin" size={18} />
                            ) : (
                              "Otključaj datoteke"
                            )}
                            <ArrowRight size={18} />
                          </button>
                        </form>
                      ) : (
                        <>
                          {downloadTransfer.message && (
                            <p className="transfer-message">
                              {downloadTransfer.message}
                            </p>
                          )}
                          <p className="download-meta">
                            {formatFileCount(
                              downloadTransfer.files?.length || 0,
                            )}{" "}
                            · {formatBytes(downloadTransfer.totalSize || 0)}
                          </p>
                          <div className="download-files">
                            {downloadTransfer.files?.map((file) => (
                              <div className="file-row" key={file.id}>
                                <FileIcon name={file.name} />
                                <div>
                                  <strong>{file.name}</strong>
                                  <span>{formatBytes(file.size)}</span>
                                </div>
                                <a
                                  className="icon-button"
                                  aria-label={`Preuzmi ${file.name}`}
                                  href={`/api/transfers/${downloadId}/files/${file.id}${token ? "?token=" + encodeURIComponent(token) : ""}`}
                                  download
                                >
                                  <Download size={17} />
                                </a>
                              </div>
                            ))}
                          </div>
                          <a
                            className="primary-button"
                            href={`/api/transfers/${downloadId}/download${token ? "?token=" + encodeURIComponent(token) : ""}`}
                            download
                          >
                            Preuzmi sve <Download size={19} />
                          </a>
                          <p className="expires-note">
                            <Clock3 size={14} /> Dostupno do{" "}
                            {formatDate(downloadTransfer.expiresAt)}
                          </p>
                        </>
                      )}
                    </>
                  ) : (
                    <div className="unavailable-state">
                      <div className="success-icon">
                        <Link size={30} />
                      </div>
                      <h2>
                        {downloadFailure === "missing"
                          ? "Ova je pošiljka otputovala."
                          : "Veza je nakratko zastala."}
                      </h2>
                      <p>
                        {downloadError ||
                          "Poveznica je istekla ili ne postoji."}
                      </p>
                      {downloadFailure === "unavailable" ? (
                        <button
                          className="primary-button"
                          onClick={() => setDownloadRetry((value) => value + 1)}
                        >
                          Pokušaj ponovno <RefreshCw size={18} />
                        </button>
                      ) : (
                        <a className="primary-button" href="/">
                          Napravi novi prijenos <ArrowRight size={18} />
                        </a>
                      )}
                    </div>
                  )}
                </div>
              ) : status === "uploading" ? (
                <div className="uploading-state" aria-live="polite">
                  <div
                    className="progress-circle"
                    style={
                      {
                        "--progress": `${progress * 3.6}deg`,
                      } as React.CSSProperties
                    }
                  >
                    <div>
                      <Send size={31} />
                      <strong>{progress}%</strong>
                    </div>
                  </div>
                  <span className="state-eyebrow">IDEJE SU NA PUTU</span>
                  <h2>
                    {progress === 100
                      ? "Još samo trenutak."
                      : "Šaljemo nešto dobro."}
                  </h2>
                  <p>
                    {progress === 100
                      ? "Sigurno spremamo tvoje datoteke."
                      : "Ostavi ovaj prozor otvoren dok se datoteke učitavaju."}
                  </p>
                  <div className="upload-stats">
                    <span>{formatFileCount(files.length)}</span>
                    <span>{formatBytes(totalSize)}</span>
                  </div>
                  <div className="progress-track">
                    <span style={{ width: `${progress}%` }} />
                  </div>
                  <button
                    className="text-button"
                    onClick={() => uploadController.current?.abort()}
                  >
                    Otkaži prijenos
                  </button>
                </div>
              ) : status === "success" && created ? (
                <div className="success-state">
                  <div className="success-icon">
                    <Check size={34} strokeWidth={1.8} />
                  </div>
                  <span className="state-eyebrow">SPREMNO ZA SVIJET</span>
                  <h2>
                    To je to.
                    <br />
                    Podijeli nešto dobro.
                  </h2>
                  <p>
                    Tvoje su datoteke spremne. Poveznicu pošalji kome god želiš.
                  </p>
                  <div className="success-summary">
                    <div>
                      <File size={19} />
                      <span>
                        {formatFileCount(created.files.length)} ·{" "}
                        {formatBytes(created.totalSize)}
                      </span>
                    </div>
                    <div>
                      <Clock3 size={17} />
                      <span>Vrijedi do {formatDate(created.expiresAt)}</span>
                    </div>
                    {password && (
                      <div>
                        <LockKeyhole size={17} />
                        <span>Zaštićeno lozinkom</span>
                      </div>
                    )}
                  </div>
                  <label className="link-field">
                    <span className="sr-only">Poveznica za dijeljenje</span>
                    <input
                      value={transferUrl(created.id)}
                      readOnly
                      onFocus={(e) => e.target.select()}
                    />
                    <button
                      aria-label="Kopiraj poveznicu"
                      onClick={() => copyLink(created.id)}
                    >
                      {copied ? <Check size={17} /> : <Copy size={17} />}
                    </button>
                  </label>
                  {mode === "email" ? (
                    <>
                      <a className="primary-button" href={emailHref}>
                        Otvori e-poštu <Mail size={18} />
                      </a>
                      <p className="email-note">
                        Poruku šalješ iz svoje aplikacije za e-poštu.
                      </p>
                    </>
                  ) : (
                    <button
                      className="primary-button"
                      onClick={() => copyLink(created.id)}
                    >
                      {copied ? "Kopirano!" : "Kopiraj poveznicu"}
                      {copied ? <Check size={18} /> : <Copy size={18} />}
                    </button>
                  )}
                  <button className="text-button" onClick={reset}>
                    <Plus size={16} /> Pošalji još nešto
                  </button>
                </div>
              ) : (
                <form onSubmit={upload}>
                  <div className="card-intro">
                    <span className="small-star">
                      <Sparkles size={15} />
                    </span>
                    <span>TVOJE DATOTEKE. NJIHOV SLJEDEĆI KORAK.</span>
                  </div>
                  <div
                    className={`drop-zone ${dragging ? "is-dragging" : ""} ${files.length ? "has-files" : ""}`}
                  >
                    {files.length ? (
                      <>
                        <div className="files-heading">
                          <div>
                            <strong>{formatFileCount(files.length)}</strong>
                            <span>{formatBytes(totalSize)} od 2 GB</span>
                          </div>
                          <button
                            type="button"
                            className="add-small"
                            aria-label="Dodaj još datoteka"
                            onClick={() => inputRef.current?.click()}
                          >
                            <Plus size={22} />
                          </button>
                        </div>
                        <div className="selected-files">
                          {files.map((file, index) => (
                            <div
                              className="file-row"
                              key={`${file.name}-${file.size}-${index}`}
                            >
                              {canPreview(file) ? (
                                <FileThumbnail file={file} />
                              ) : (
                                <FileIcon name={file.name} />
                              )}
                              <div>
                                {canPreview(file) ? (
                                  <button
                                    type="button"
                                    className="file-name-button"
                                    onClick={() => setPreviewFile(file)}
                                    title={`Pregledaj ${file.name}`}
                                  >
                                    {file.name}
                                  </button>
                                ) : (
                                  <strong title={file.name}>{file.name}</strong>
                                )}
                                <span>
                                  {formatBytes(file.size)}
                                  {canPreview(file)
                                    ? " · Klikni za pregled"
                                    : ""}
                                </span>
                              </div>
                              <button
                                type="button"
                                className="icon-button"
                                onClick={() =>
                                  setFiles(files.filter((_, i) => i !== index))
                                }
                                aria-label={`Ukloni ${file.name}`}
                              >
                                <X size={15} />
                              </button>
                            </div>
                          ))}
                        </div>
                        <div className="selection-summary">
                          <div
                            className="selection-progress"
                            role="meter"
                            aria-label="Iskorišteni prostor prijenosa"
                            aria-valuenow={totalSize}
                            aria-valuemin={0}
                            aria-valuemax={LIMIT}
                          >
                            <span
                              style={{
                                width: `${Math.max(1, (totalSize / LIMIT) * 100)}%`,
                              }}
                            />
                          </div>
                          <div className="selection-footer">
                            <span>
                              {formatBytes(LIMIT - totalSize)} slobodno
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                setFiles([]);
                                setError("");
                              }}
                            >
                              Ukloni sve
                            </button>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="add-more"
                          onClick={() => inputRef.current?.click()}
                        >
                          <Plus size={13} /> Dodaj još datoteka
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="upload-trigger"
                          onClick={() => inputRef.current?.click()}
                        >
                          <span className="plus-circle">
                            <Plus size={29} strokeWidth={1.5} />
                          </span>
                          <h1>
                            {readingDrop
                              ? "Čitamo datoteke…"
                              : dragging
                                ? "Pusti ih ovdje."
                                : "Dodaj datoteke"}
                          </h1>
                        </button>
                        <p>ili ih jednostavno povuci ovdje</p>
                        <span className="size-pill">
                          Do 2 GB. Potpuno besplatno.
                        </span>
                        <button
                          type="button"
                          className="folder-button"
                          onClick={() => folderRef.current?.click()}
                        >
                          <FolderPlus size={14} /> Odaberi mapu
                        </button>
                      </>
                    )}
                  </div>
                  <input
                    ref={inputRef}
                    type="file"
                    multiple
                    hidden
                    onChange={(e) => {
                      if (e.target.files) addFiles(e.target.files);
                      e.target.value = "";
                    }}
                  />
                  <input
                    ref={(element) => {
                      folderRef.current = element;
                      element?.setAttribute("webkitdirectory", "");
                    }}
                    type="file"
                    multiple
                    hidden
                    onChange={(e) => {
                      if (e.target.files) addFiles(e.target.files);
                      e.target.value = "";
                    }}
                  />
                  <div className="transfer-fields">
                    <div
                      className="mode-tabs"
                      role="tablist"
                      aria-label="Način dijeljenja"
                      onKeyDown={(event) => {
                        if (
                          ["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                            event.key,
                          )
                        ) {
                          event.preventDefault();
                          const next =
                            event.key === "Home"
                              ? "link"
                              : event.key === "End"
                                ? "email"
                                : mode === "link"
                                  ? "email"
                                  : "link";
                          setMode(next);
                          document.getElementById(`mode-${next}`)?.focus();
                        }
                      }}
                    >
                      <button
                        type="button"
                        role="tab"
                        id="mode-link"
                        tabIndex={mode === "link" ? 0 : -1}
                        aria-selected={mode === "link"}
                        className={mode === "link" ? "active" : ""}
                        onClick={() => setMode("link")}
                      >
                        <Link size={15} /> Poveznica
                      </button>
                      <button
                        type="button"
                        role="tab"
                        id="mode-email"
                        tabIndex={mode === "email" ? 0 : -1}
                        aria-selected={mode === "email"}
                        className={mode === "email" ? "active" : ""}
                        onClick={() => setMode("email")}
                      >
                        <Mail size={15} /> E-pošta
                      </button>
                    </div>
                    {mode === "email" && (
                      <div className="email-fields">
                        <label className="field">
                          <span>E-pošta primatelja</span>
                          <input
                            type="email"
                            placeholder="za@nekog.posebnog"
                            value={recipient}
                            onChange={(e) => setRecipient(e.target.value)}
                            required
                          />
                        </label>
                        <label className="field">
                          <span>Tvoja e-pošta</span>
                          <input
                            type="email"
                            placeholder="ti@primjer.com"
                            value={sender}
                            onChange={(e) => setSender(e.target.value)}
                            required
                          />
                        </label>
                      </div>
                    )}
                    <label className="field">
                      <span>
                        Naslov <small>Neobavezno</small>
                      </span>
                      <input
                        aria-label="Naslov prijenosa"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        maxLength={120}
                        placeholder="Daj ime svojim idejama"
                      />
                    </label>
                    <label className="field message-field">
                      <span>
                        Poruka <small>Neobavezno</small>
                      </span>
                      <textarea
                        aria-label="Poruka"
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        maxLength={2000}
                        placeholder="Dodaj koju riječ..."
                        rows={2}
                      />
                    </label>
                    <div className="transfer-options">
                      <label className="expiry-select">
                        <Clock3 size={14} />
                        <span className="sr-only">Rok valjanosti</span>
                        <select
                          value={expires}
                          onChange={(e) => setExpires(e.target.value)}
                        >
                          <option value="1">Vrijedi 1 dan</option>
                          <option value="3">Vrijedi 3 dana</option>
                          <option value="7">Vrijedi 7 dana</option>
                        </select>
                        <ChevronDown size={12} />
                      </label>
                      <button
                        className={`settings-button ${password ? "protected" : ""}`}
                        type="button"
                        onClick={() => setModal("settings")}
                        aria-label="Postavke prijenosa"
                      >
                        {password ? (
                          <LockKeyhole size={16} />
                        ) : (
                          <SlidersHorizontal size={16} />
                        )}
                      </button>
                    </div>
                    {error && (
                      <p className="error-message" role="alert">
                        {error}
                      </p>
                    )}
                    <button
                      className="primary-button"
                      type="submit"
                      disabled={serviceState !== "ready" || readingDrop}
                    >
                      {serviceState === "checking"
                        ? "Provjeravamo vezu…"
                        : serviceState !== "ready"
                          ? "Slanje trenutačno nedostupno"
                          : readingDrop
                            ? "Čitamo datoteke…"
                            : mode === "link"
                              ? "Izradi poveznicu"
                              : "Pripremi prijenos"}
                      <ArrowRight size={19} />
                    </button>
                    <div className="card-security">
                      <LockKeyhole size={11} />
                      <span>Tvoje datoteke. Samo putem poveznice.</span>
                    </div>
                  </div>
                </form>
              )}
            </div>
            <p className="terms-note">
              Slanjem prihvaćaš naše{" "}
              <button onClick={() => setModal("terms")}>
                Uvjete korištenja
              </button>
              <br />i{" "}
              <button onClick={() => setModal("privacy")}>
                Pravila privatnosti.
              </button>{" "}
              Bez sitnih iznenađenja.
            </p>
          </section>

          <section className="hero" aria-label="Dobre ideje putuju daleko">
            <div className="hero-tag">
              <span /> SLOBODNO STVARAJ. JEDNOSTAVNO DIJELI.
            </div>
            <h2>
              Dobre ideje
              <br />
              putuju{" "}
              <span>
                daleko.
                <svg
                  viewBox="0 0 280 22"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <path d="M4 14C60 3 195 1 274 10M20 21C85 10 190 10 248 15" />
                </svg>
              </span>
            </h2>
            <p className="hero-description">
              Velike datoteke. Mali koraci.
              <br />
              Pošalji ono što stvaraš i pokreni nešto dobro.
            </p>
            <div className="artwork">
              <div className="art-orbit orbit-one" />
              <div className="art-orbit orbit-two" />
              <img
                src="/hero-art.svg"
                alt="Papirnati avion koji leti kroz ljubičastu vrpcu"
              />
              <span className="art-label label-one">
                <span /> SVE POČINJE IDEJOM
              </span>
              <span className="art-label label-two">
                PODIJELI JE SA SVIJETOM <ArrowUpRight size={13} />
              </span>
              <span className="tiny-spark spark-one">✳</span>
              <span className="tiny-spark spark-two">+</span>
            </div>
            <div className="hero-bottom">
              <span className="little-arrow">
                <MoveUpRight size={21} strokeWidth={1.5} />
              </span>
              <p>
                Za velike vizije i male „evo ti”.
                <br />
                <strong>Za sve što vrijedi podijeliti.</strong>
              </p>
            </div>
          </section>
        </div>

        <section className="benefits" aria-label="Prednosti">
          <div>
            <span className="benefit-icon">
              <Send size={20} strokeWidth={1.5} />
            </span>
            <p>
              <strong>Velike datoteke. Bez brige.</strong>
              <span>Do 2 GB u jednom prijenosu, besplatno.</span>
            </p>
          </div>
          <div>
            <span className="benefit-icon">
              <Sparkles size={20} strokeWidth={1.5} />
            </span>
            <p>
              <strong>Bez računa. Bez komplikacija.</strong>
              <span>Dodaj datoteke i spreman si za slanje.</span>
            </p>
          </div>
          <div>
            <span className="benefit-icon">
              <ShieldCheck size={21} strokeWidth={1.5} />
            </span>
            <p>
              <strong>Tvoje datoteke, tvoja pravila.</strong>
              <span>Ti biraš tko, kako i koliko dugo.</span>
            </p>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="footer-left">
          <span className="footer-copyright">
            © {new Date().getFullYear()} WT Transfer
          </span>
          <span className="footer-dot">·</span>
          <button onClick={() => setModal("privacy")}>Privatnost</button>
          <button onClick={() => setModal("terms")}>Uvjeti</button>
        </div>
        <div className="footer-mood">
          <span>Malo boje za velike ideje.</span>
          <div className="theme-dots" aria-label="Boja pozadine">
            {[
              { id: "sage", label: "Kadulja" },
              { id: "lilac", label: "Lila" },
              { id: "peach", label: "Breskva" },
            ].map((t) => (
              <button
                key={t.id}
                className={`theme-dot ${t.id} ${theme === t.id ? "selected" : ""}`}
                aria-label={t.label}
                aria-pressed={theme === t.id}
                onClick={() => setTheme(t.id)}
              />
            ))}
          </div>
        </div>
        <span className="language">
          <Globe2 size={14} /> Hrvatski
        </span>
      </footer>

      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
        </div>
      )}
      {previewFile && (
        <Modal title={previewFile.name} onClose={closePreview} wide>
          <FilePreview file={previewFile} />
        </Modal>
      )}
      {modal && (
        <Modal
          title={
            {
              how: "Od ideje do „stiglo je”.",
              about: "Stvoreno za ono što stvaraš.",
              help: "Tu smo da pomognemo.",
              history: "Moji prijenosi",
              settings: "Tvoje datoteke, tvoja pravila.",
              privacy: "Tvoja privatnost.",
              terms: "Jednostavna pravila dijeljenja.",
            }[modal]
          }
          onClose={closeModal}
          wide={modal === "history"}
        >
          {modal === "how" && (
            <>
              <p className="modal-lead">
                Tri mala koraka. Beskrajno mnogo mogućnosti.
              </p>
              <div className="how-steps">
                {[
                  {
                    icon: Plus,
                    title: "Dodaj ono što stvaraš.",
                    text: "Povuci datoteke ili odaberi mapu. Možeš dodati do 100 datoteka, ukupno do 2 GB.",
                  },
                  {
                    icon: SlidersHorizontal,
                    title: "Uredi po svom.",
                    text: "Dodaj naslov i poruku, odaberi rok valjanosti i, ako želiš, zaštiti prijenos lozinkom.",
                  },
                  {
                    icon: ArrowUpRight,
                    title: "Pusti ideje u svijet.",
                    text: "Kopiraj poveznicu ili otvori pripremljenu poruku u svojoj aplikaciji za e-poštu. Primatelju ne treba račun.",
                  },
                ].map((step, i) => (
                  <div className="how-step" key={step.title}>
                    <span>
                      <step.icon size={21} />
                    </span>
                    <div>
                      <small>0{i + 1}</small>
                      <h3>{step.title}</h3>
                      <p>{step.text}</p>
                    </div>
                  </div>
                ))}
              </div>
              <button className="primary-button" onClick={closeModal}>
                Krenimo <ArrowRight size={18} />
              </button>
            </>
          )}
          {modal === "about" && (
            <>
              <div className="about-graphic">
                <Send size={62} strokeWidth={1} />
                <Sparkles size={30} />
              </div>
              <p className="modal-lead">
                Tvoj prvi demo. Posljednja verzija dizajna. Fotografije koje ne
                stanu u poruku.
              </p>
              <p className="modal-copy">
                Vjerujemo da dijeljenje treba biti najlakši dio stvaranja. Zato
                smo napravili prostor u kojem tvoje datoteke brzo pronalaze put
                do pravih ljudi.
              </p>
              <div className="about-note">
                <strong>Manje čekanja. Više stvaranja.</strong>
                <span>Besplatno, do 2 GB i bez registracije.</span>
              </div>
              <button className="primary-button" onClick={closeModal}>
                Podijeli svoju ideju <ArrowRight size={18} />
              </button>
            </>
          )}
          {modal === "help" && (
            <>
              <p className="modal-lead">
                Mali odgovori za jednostavnije dijeljenje.
              </p>
              <div className="faq-list">
                {[
                  {
                    q: "Koje datoteke mogu poslati?",
                    a: "Fotografije, videozapise, dokumente, glazbu i sve druge vrste datoteka. Jedan prijenos može sadržavati do 100 datoteka ukupne veličine do 2 GB.",
                  },
                  {
                    q: "Koliko dugo je poveznica dostupna?",
                    a: "Odaberi 1, 3 ili 7 dana prije prijenosa. Nakon isteka datoteke više nisu dostupne putem poveznice. Rok se računa od trenutka učitavanja.",
                  },
                  {
                    q: "Kako funkcionira slanje e-poštom?",
                    a: "Nakon učitavanja pripremamo poruku s poveznicom. Klikni „Otvori e-poštu” pa poruku pošalji iz svoje aplikacije. Aplikacija ne šalje e-poštu automatski.",
                  },
                  {
                    q: "Kako zaštititi prijenos lozinkom?",
                    a: "Klikni ikonu postavki iznad gumba za prijenos i unesi lozinku. Podijeli je s primateljem zasebno. Lozinka nije uključena u poveznicu.",
                  },
                  {
                    q: "Gdje mogu pronaći stare prijenose?",
                    a: "Otvori „Moji prijenosi”. Povijest se sprema samo u ovom pregledniku, pa nije dostupna na drugom uređaju ili nakon brisanja podataka preglednika.",
                  },
                ].map((item, i) => (
                  <div
                    className={`faq-item ${faq === i ? "open" : ""}`}
                    key={item.q}
                  >
                    <button
                      aria-expanded={faq === i}
                      onClick={() => setFaq(faq === i ? null : i)}
                    >
                      {item.q}
                      <Plus size={17} />
                    </button>
                    {faq === i && <p>{item.a}</p>}
                  </div>
                ))}
              </div>
              <div className="help-note">
                <CircleHelp size={18} />
                <span>
                  Nešto je zapelo? Pokušaj osvježiti stranicu i ponovno dodati
                  datoteke.
                </span>
              </div>
            </>
          )}
          {modal === "settings" && (
            <>
              <p className="modal-lead">
                Malo više kontrole nad onim što dijeliš.
              </p>
              <label className="settings-field">
                <span>
                  <Clock3 size={18} /> Koliko dugo vrijedi poveznica?
                </span>
                <select
                  value={expires}
                  onChange={(e) => setExpires(e.target.value)}
                >
                  <option value="1">1 dan</option>
                  <option value="3">3 dana</option>
                  <option value="7">7 dana</option>
                </select>
              </label>
              <label className="settings-field">
                <span>
                  <LockKeyhole size={18} /> Zaštiti lozinkom{" "}
                  <small>Neobavezno</small>
                </span>
                <div className="password-input-wrap">
                  <input
                    type={passwordVisible ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Unesi lozinku"
                    maxLength={128}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    className="icon-button password-visibility"
                    aria-label={
                      passwordVisible ? "Sakrij lozinku" : "Prikaži lozinku"
                    }
                    onClick={(event) => {
                      event.preventDefault();
                      setPasswordVisible((value) => !value);
                    }}
                  >
                    {passwordVisible ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                <p>
                  {password && password.length < 8
                    ? "Za bolju zaštitu preporučujemo barem 8 znakova. "
                    : ""}
                  Podijeli lozinku s primateljem zasebno od poveznice.
                </p>
              </label>
              <button className="primary-button" onClick={closeModal}>
                Spremi postavke <Check size={18} />
              </button>
            </>
          )}
          {modal === "history" && (
            <TransferHistory
              items={history}
              onChange={updateHistory}
              onCopy={copyLink}
              onClose={closeModal}
            />
          )}
          {modal === "privacy" && (
            <div className="legal-copy">
              <p>
                Datoteke se pohranjuju na poslužitelju aplikacije kako bi ih
                primatelji mogli preuzeti. Svatko tko ima poveznicu može
                pristupiti prijenosu, osim ako ga zaštitiš lozinkom.
              </p>
              <h3>Ti biraš rok.</h3>
              <p>
                Nakon odabranog roka prijenos više nije dostupan. Lozinke se
                pohranjuju kao kriptografski sažeci, a ne kao čitljiv tekst.
              </p>
              <h3>Povijest ostaje u tvom pregledniku.</h3>
              <p>
                Za popis tvojih prijenosa koristimo lokalnu pohranu preglednika.
                Možeš ukloniti stavku iz povijesti ili obrisati podatke
                preglednika. To ne opoziva samu poveznicu.
              </p>
              <h3>E-pošta ostaje tvoja.</h3>
              <p>
                Poruku s poveznicom šalješ preko vlastite aplikacije za e-poštu.
                Ova aplikacija ne šalje poruke automatski.
              </p>
            </div>
          )}
          {modal === "terms" && (
            <div className="legal-copy">
              <p>
                Ovo je samostalna aplikacija inspirirana WeTransferom i nije
                povezana sa službenom uslugom WeTransfer.
              </p>
              <h3>Dijeli odgovorno.</h3>
              <p>
                Učitavaj samo datoteke koje imaš pravo dijeliti. Nemoj slati
                zlonamjerne ili nezakonite sadržaje.
              </p>
              <h3>Prijenos ima svoj rok.</h3>
              <p>
                Jedan prijenos može imati do 100 datoteka i ukupno 2 GB.
                Poveznica vrijedi 1, 3 ili 7 dana. Uvijek zadrži vlastitu kopiju
                važnih datoteka.
              </p>
              <h3>Poveznica otvara vrata.</h3>
              <p>
                Podijeli je samo s ljudima kojima vjeruješ. Za dodatnu kontrolu
                postavi lozinku i pošalji je odvojenim putem.
              </p>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
