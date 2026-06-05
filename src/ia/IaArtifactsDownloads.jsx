import { Download } from "lucide-react";
import { isPlainObject } from "./aiAskTypes.js";

function getArtifacts(data) {
  if (!isPlainObject(data)) return [];
  const list = Array.isArray(data.csv_artifacts) ? data.csv_artifacts : [];
  return list.filter((a) => isPlainObject(a) && String(a.content || "").length > 0);
}

function downloadArtifact(artifact) {
  const filename = String(artifact.filename || "relatorio.csv").trim() || "relatorio.csv";
  const mime = String(artifact.mime_type || "text/csv;charset=utf-8");
  const blob = new Blob([String(artifact.content || "")], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function IaArtifactsDownloads({ data }) {
  const artifacts = getArtifacts(data);
  if (!artifacts.length) return null;

  return (
    <div className="ia-analitica-artifacts" aria-label="Arquivos gerados pela IA">
      {artifacts.map((artifact, idx) => (
        <button
          key={artifact.id || artifact.filename || idx}
          type="button"
          className="ia-analitica-artifact-btn"
          onClick={() => downloadArtifact(artifact)}
          title={artifact.filename || "Baixar arquivo"}
        >
          <Download size={16} aria-hidden />
          <span>{artifact.label || artifact.filename || "Baixar CSV"}</span>
          {artifact.rows != null ? <small>{artifact.rows} linhas</small> : null}
        </button>
      ))}
    </div>
  );
}
