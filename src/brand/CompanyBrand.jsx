import { useEffect, useState } from "react";
import ZapERPLogo from "./ZapERPLogo";
import { FONT_FAMILIES } from "../pages/Configuracoes";
import "./CompanyBrand.css";

/**
 * Gera até 2 iniciais a partir do nome da empresa.
 * "Brasão & Prata"  → "BP"
 * "WM Sistemas"     → "WS"
 * "Miguel"          → "MI"
 * ""                → "?"
 */
function getInitials(nome) {
  if (!nome) return "?";
  const words = String(nome)
    .trim()
    .split(/[\s&_\-\/\\|]+/)
    .filter((w) => /[a-zA-ZÀ-ÿ0-9]/.test(w));
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/**
 * CompanyBrand — marca da empresa no cabeçalho.
 *
 * Se logo_url existir → mostra imagem dentro de um container elegante.
 * Se imagem falhar ou logo_url ausente → mostra iniciais com fundo gradiente.
 * Ao lado sempre exibe o nome da empresa (truncado se longo).
 * Se não houver dados da empresa (loading) → mostra ZapERPLogo padrão.
 *
 * Props:
 *   logoUrl   {string|null}  URL da imagem do logo
 *   nome      {string|null}  Nome da empresa
 *   nomeFonte {string|null}  Chave da fonte (ex.: "poppins") — ver FONT_FAMILIES
 *   className {string}       Classes extras opcionais
 */
export default function CompanyBrand({ logoUrl, nome, nomeFonte, className = "" }) {
  const [imgError, setImgError] = useState(false);
  const normalizedLogoUrl = typeof logoUrl === "string" ? logoUrl.trim() : "";

  useEffect(() => {
    setImgError(false);
  }, [normalizedLogoUrl]);

  const showLogo = Boolean(normalizedLogoUrl) && !imgError;
  const hasCustomBrand = Boolean(normalizedLogoUrl || nome);

  // Sem dados ainda (store carregando) → ZapERPLogo padrão
  if (!hasCustomBrand) {
    return (
      <ZapERPLogo
        variant="horizontal"
        size="md"
        tagline="Atendimento inteligente"
        title="ZapERP — Atendimento inteligente"
        interactive={false}
      />
    );
  }

  const initials = getInitials(nome);

  return (
    <div
      className={`cb ${className}`.trim()}
      title={nome || "Empresa"}
      aria-label={nome ? `Logo de ${nome}` : "Logo da empresa"}
    >
      {/* Box da marca: logo ou iniciais */}
      <div className={`cb-mark ${showLogo ? "cb-mark--logo" : "cb-mark--initials"}`}>
        {showLogo ? (
          <img
            src={normalizedLogoUrl}
            alt={nome || "Logo da empresa"}
            className="cb-img"
            draggable={false}
            onError={() => setImgError(true)}
          />
        ) : (
          <span className="cb-initials" data-len={initials.length} aria-hidden="true">
            {initials}
          </span>
        )}
      </div>

      {/* Nome da empresa */}
      {nome && (
        <div className="cb-word">
          <span
            className="cb-name"
            style={nomeFonte && FONT_FAMILIES[nomeFonte]
              ? { fontFamily: FONT_FAMILIES[nomeFonte] }
              : undefined}
          >
            {nome}
          </span>
        </div>
      )}
    </div>
  );
}
