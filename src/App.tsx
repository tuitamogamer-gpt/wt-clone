import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { createTransfer } from "./create-transfer";
import type { Transfer } from "./create-transfer";
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
  ExternalLink,
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
function getHistory(): Transfer[] {
  try {
    return JSON.parse(localStorage.getItem("we-transfer-history") || "[]");
  } catch {
    return [];
  }
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
        const nodes = ref.current?.querySelectorAll<HTMLElement>(
          'button, input, select, textarea, a[href], [tabindex="0"]',
        );
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
  const [theme, setTheme] = useState("sage");
  const [faq, setFaq] = useState<number | null>(0);
  const [downloadTransfer, setDownloadTransfer] = useState<Transfer | null>(
    null,
  );
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [downloadError, setDownloadError] = useState("");
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
    if (toast) {
      const timer = window.setTimeout(() => setToast(""), 3500);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  useEffect(() => {
    if (!downloadId) return;
    const controller = new AbortController();
    setDownloadLoading(true);
    fetch(`/api/transfers/${downloadId}`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok)
          throw new Error(data.error || "Prijenos nije dostupan.");
        setDownloadTransfer(data);
      })
      .catch((err) => {
        if (err.name !== "AbortError") setDownloadError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setDownloadLoading(false);
      });
    return () => controller.abort();
  }, [downloadId]);

  function addFiles(incoming: FileList | File[]) {
    setError("");
    const next = [...files];
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
  }
  async function upload(event: FormEvent) {
    event.preventDefault();
    setError("");
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
      setHistory(updated);
      try {
        localStorage.setItem("we-transfer-history", JSON.stringify(updated));
      } catch {
        /* History is optional. */
      }
    } catch (err) {
      setStatus("idle");
      setProgress(0);
      if (!controller.signal.aborted)
        setError(
          err instanceof Error
            ? err.message
            : "Prijenos nije uspio. Pokušaj ponovno.",
        );
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
  const closeModal = useCallback(() => setModal(null), []);

  return (
    <div className={`app theme-${theme}`}>
      <header className="header">
        <a className="brand" href="/" aria-label="WeTransfer početna">
          <svg viewBox="0 0 72 40" aria-hidden="true">
            <path
              d="M3 8h10l5 18 6-18h9l6 18 4-18h10L42 38H32l-4-15-5 15H13L3 8Z"
              fill="currentColor"
            />
            <path
              d="M50 24c0-11 7-17 15-17 9 0 14 7 14 16v4H60c1 4 6 5 12 1l5 6c-11 9-27 4-27-10Zm10-3h10c-1-6-9-6-10 0Z"
              fill="currentColor"
              transform="translate(-8 0)"
            />
          </svg>
          <span>WeTransfer</span>
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
                            {downloadTransfer.files?.length} datoteka ·{" "}
                            {formatBytes(downloadTransfer.totalSize || 0)}
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
                      <h2>Ova je pošiljka otputovala.</h2>
                      <p>
                        {downloadError ||
                          "Poveznica je istekla ili ne postoji."}
                      </p>
                      <a className="primary-button" href="/">
                        Napravi novi prijenos <ArrowRight size={18} />
                      </a>
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
                    <span>{files.length} datoteka</span>
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
                        {created.files.length} datoteka ·{" "}
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
                    <span>OD TVOJIH RUKU. DO NJIHOVIH.</span>
                  </div>
                  <div
                    className={`drop-zone ${dragging ? "is-dragging" : ""} ${files.length ? "has-files" : ""}`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragging(true);
                    }}
                    onDragLeave={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node))
                        setDragging(false);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragging(false);
                      addFiles(e.dataTransfer.files);
                    }}
                  >
                    {files.length ? (
                      <>
                        <div className="files-heading">
                          <div>
                            <strong>
                              {files.length}{" "}
                              {files.length === 1 ? "datoteka" : "datoteka"}
                            </strong>
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
                              <FileIcon name={file.name} />
                              <div>
                                <strong>{file.name}</strong>
                                <span>{formatBytes(file.size)}</span>
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
                            {dragging ? "Pusti ih ovdje." : "Dodaj datoteke"}
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
                    >
                      <button
                        type="button"
                        role="tab"
                        aria-selected={mode === "link"}
                        className={mode === "link" ? "active" : ""}
                        onClick={() => setMode("link")}
                      >
                        <Link size={15} /> Poveznica
                      </button>
                      <button
                        type="button"
                        role="tab"
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
                    <button className="primary-button" type="submit">
                      {mode === "link"
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
            © {new Date().getFullYear()} WeTransfer
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
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Unesi lozinku"
                  maxLength={128}
                  autoComplete="new-password"
                />
                <p>Podijeli lozinku s primateljem zasebno od poveznice.</p>
              </label>
              <button className="primary-button" onClick={closeModal}>
                Spremi postavke <Check size={18} />
              </button>
            </>
          )}
          {modal === "history" && (
            <>
              <p className="modal-lead">
                Ideje koje si već poslao u svijet.
                <br />
                <small>Povijest je spremljena u ovom pregledniku.</small>
              </p>
              {history.length ? (
                <div className="history-list">
                  {history.map((item) => {
                    const expired = new Date(item.expiresAt) < new Date();
                    return (
                      <div className="history-item" key={item.id}>
                        <span className="history-icon">
                          <File size={22} />
                        </span>
                        <div className="history-info">
                          <strong>
                            {item.title ||
                              item.files?.[0]?.name ||
                              "Prijenos bez naslova"}
                          </strong>
                          <span>
                            {item.files?.length || 0} datoteka ·{" "}
                            {formatBytes(item.totalSize)} ·{" "}
                            {expired
                              ? "Isteklo"
                              : `Do ${formatDate(item.expiresAt)}`}
                          </span>
                        </div>
                        {!expired && (
                          <>
                            <button
                              className="icon-button"
                              aria-label="Kopiraj poveznicu prijenosa"
                              onClick={() => copyLink(item.id)}
                            >
                              <Copy size={16} />
                            </button>
                            <a
                              className="icon-button"
                              href={`/t/${item.id}`}
                              aria-label="Otvori prijenos"
                            >
                              <ExternalLink size={16} />
                            </a>
                          </>
                        )}
                        <button
                          className="icon-button"
                          aria-label="Ukloni iz povijesti"
                          onClick={() => {
                            const updated = history.filter(
                              (h) => h.id !== item.id,
                            );
                            setHistory(updated);
                            try {
                              localStorage.setItem(
                                "we-transfer-history",
                                JSON.stringify(updated),
                              );
                            } catch {
                              /* optional history */
                            }
                          }}
                        >
                          <X size={16} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="history-empty">
                  <Send size={39} strokeWidth={1.2} />
                  <h3>Tvoja sljedeća ideja ide prva.</h3>
                  <p>Kad napraviš prvi prijenos, pojavit će se ovdje.</p>
                  <button className="primary-button" onClick={closeModal}>
                    Napravi prvi prijenos <ArrowRight size={18} />
                  </button>
                </div>
              )}
            </>
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
