import { useEffect, useId, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Copy,
  FileArchive,
  LockKeyhole,
  Search,
  Send,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import type { Transfer } from "../create-transfer";
import "./transfer-history.css";

type HistoryFilter = "all" | "active" | "expired";

type TransferHistoryProps = {
  items: Transfer[];
  onChange: (items: Transfer[]) => void;
  onCopy: (id: string) => void;
  onClose: () => void;
};

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 3);
  return `${(bytes / 1024 ** unit).toLocaleString("hr-HR", { maximumFractionDigits: unit ? 1 : 0 })} ${["B", "KB", "MB", "GB"][unit]}`;
}

function searchable(value: string) {
  return value
    .toLocaleLowerCase("hr-HR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function titleFor(item: Transfer) {
  return item.title || item.files[0]?.name || "Prijenos bez naslova";
}

export function TransferHistory({
  items,
  onChange,
  onCopy,
  onClose,
}: TransferHistoryProps) {
  const searchId = useId();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const [now, setNow] = useState(Date.now);
  const [removed, setRemoved] = useState<{
    item: Transfer;
    index: number;
  } | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const isExpired = (item: Transfer) => Date.parse(item.expiresAt) <= now;
  const activeCount = items.filter((item) => !isExpired(item)).length;
  const search = searchable(query.trim());
  const visible = items.filter((item) => {
    const expired = isExpired(item);
    if (filter === "active" && expired) return false;
    if (filter === "expired" && !expired) return false;
    return (
      !search ||
      searchable(
        `${item.title} ${item.files.map((file) => file.name).join(" ")}`,
      ).includes(search)
    );
  });

  const filters: { id: HistoryFilter; label: string; count: number }[] = [
    { id: "all", label: "Svi", count: items.length },
    { id: "active", label: "Aktivni", count: activeCount },
    { id: "expired", label: "Istekli", count: items.length - activeCount },
  ];

  function remove(item: Transfer) {
    setRemoved({
      item,
      index: items.findIndex((candidate) => candidate.id === item.id),
    });
    onChange(items.filter((candidate) => candidate.id !== item.id));
  }

  function undo() {
    if (!removed) return;
    if (!items.some((item) => item.id === removed.item.id)) {
      const restored = [...items];
      restored.splice(
        Math.min(removed.index, restored.length),
        0,
        removed.item,
      );
      onChange(restored.slice(0, 30));
    }
    setRemoved(null);
  }

  return (
    <div className="transfer-history">
      <p className="th-intro">Sve što si poslao, na jednom mjestu.</p>

      {(items.length > 0 || removed) && (
        <>
          <label className="th-search" htmlFor={searchId}>
            <Search size={17} aria-hidden="true" />
            <input
              id={searchId}
              type="search"
              placeholder="Pronađi prijenos ili datoteku"
              aria-label="Pretraži prijenose po naslovu ili nazivu datoteke"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div
            className="th-filters"
            role="group"
            aria-label="Filtriraj prijenose"
          >
            {filters.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={filter === option.id}
                onClick={() => setFilter(option.id)}
              >
                {option.label}
                <span>{option.count}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {removed && (
        <div className="th-undo">
          <span role="status">Prijenos je uklonjen iz povijesti.</span>
          <button type="button" onClick={undo}>
            <Undo2 size={15} /> Vrati
          </button>
          <button
            type="button"
            className="th-dismiss"
            aria-label="Zatvori obavijest"
            onClick={() => setRemoved(null)}
          >
            <X size={15} />
          </button>
        </div>
      )}

      {visible.length > 0 ? (
        <ul className="th-list" aria-label="Prijenosi">
          {visible.map((item) => {
            const expired = isExpired(item);
            const title = titleFor(item);
            const expiration = new Date(item.expiresAt).toLocaleString(
              "hr-HR",
              {
                day: "numeric",
                month: "short",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              },
            );
            return (
              <li
                className={`th-item${expired ? " th-item-expired" : ""}`}
                key={item.id}
              >
                <span className="th-file-icon">
                  <FileArchive size={22} strokeWidth={1.6} aria-hidden="true" />
                </span>
                <div className="th-info">
                  <div className="th-title-line">
                    <strong title={title}>{title}</strong>
                    {item.requiresPassword && (
                      <LockKeyhole size={13} aria-label="Zaštićeno lozinkom" />
                    )}
                  </div>
                  <p>
                    {item.files.length}{" "}
                    {item.files.length === 1
                      ? "datoteka"
                      : item.files.length % 10 >= 2 &&
                          item.files.length % 10 <= 4 &&
                          (item.files.length % 100 < 12 ||
                            item.files.length % 100 > 14)
                        ? "datoteke"
                        : "datoteka"}{" "}
                    <span>·</span> {formatBytes(item.totalSize)}
                  </p>
                  <time dateTime={item.expiresAt}>
                    {expired ? "Isteklo" : "Vrijedi do"} {expiration}
                  </time>
                </div>
                <span
                  className={`th-status ${expired ? "th-expired" : "th-active"}`}
                >
                  <span />
                  {expired ? "Istekao" : "Aktivan"}
                </span>
                <div className="th-actions">
                  {!expired && (
                    <>
                      <button
                        type="button"
                        aria-label={`Kopiraj poveznicu: ${title}`}
                        title="Kopiraj poveznicu"
                        onClick={() => onCopy(item.id)}
                      >
                        <Copy size={16} />
                      </button>
                      <a
                        href={`/t/${encodeURIComponent(item.id)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Otvori prijenos u novoj kartici: ${title}`}
                        title="Otvori prijenos"
                      >
                        <ArrowUpRight size={18} />
                      </a>
                    </>
                  )}
                  <button
                    type="button"
                    className="th-remove"
                    aria-label={`Ukloni iz povijesti: ${title}`}
                    title="Ukloni iz povijesti"
                    onClick={() => remove(item)}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : items.length || search || filter !== "all" ? (
        <div className="th-empty" role="status">
          <span className="th-empty-icon">
            <Search size={26} strokeWidth={1.5} />
          </span>
          <h3>Nema pronađenih prijenosa.</h3>
          <p>Pokušaj s drugim nazivom ili prikaži sve prijenose.</p>
          <button
            type="button"
            className="th-reset"
            onClick={() => {
              setQuery("");
              setFilter("all");
            }}
          >
            Poništi filtre
          </button>
        </div>
      ) : (
        <div className="th-empty">
          <span className="th-empty-icon">
            <Send size={30} strokeWidth={1.4} />
          </span>
          <h3>Tvoja sljedeća ideja ide prva.</h3>
          <p>Kad napraviš prijenos, pronaći ćeš ga ovdje.</p>
          <button type="button" className="primary-button" onClick={onClose}>
            Napravi prijenos <ArrowRight size={17} />
          </button>
        </div>
      )}
      <p className="th-footnote">
        Povijest ostaje u ovom pregledniku. Uklanjanje iz povijesti ne briše
        datoteke i ne opoziva poveznicu.
      </p>
    </div>
  );
}
