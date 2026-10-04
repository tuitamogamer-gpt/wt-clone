import { useEffect, useState } from "react";
import { ImageOff } from "lucide-react";

function useFileUrl(file: File) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url;
}

export function FileThumbnail({ file }: { file: File }) {
  const url = useFileUrl(file);
  const [failed, setFailed] = useState(false);
  return (
    <span className="file-preview-thumb" aria-hidden="true">
      {failed ? (
        <ImageOff size={20} />
      ) : (
        url && <img src={url} alt="" onError={() => setFailed(true)} />
      )}
    </span>
  );
}

export function FilePreview({ file }: { file: File }) {
  const url = useFileUrl(file);
  const [failed, setFailed] = useState(false);
  return (
    <div className="file-preview-content">
      {failed ? (
        <div className="preview-error">
          <ImageOff size={36} />
          <p>Ovu sliku nije moguće prikazati. I dalje je možeš poslati.</p>
        </div>
      ) : (
        url && <img src={url} alt={file.name} onError={() => setFailed(true)} />
      )}
      <p>Pregled ostaje na tvom uređaju. Datoteka još nije poslana.</p>
    </div>
  );
}
