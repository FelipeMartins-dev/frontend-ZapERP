import IaMarkdownContent from "./IaMarkdownContent.jsx";
import IaAnaliticaAlerts from "./IaAnaliticaAlerts.jsx";
import IaPeriodoCabecalho from "./IaPeriodoCabecalho.jsx";
import IaPeriodoFonte from "./IaPeriodoFonte.jsx";
import IaCandidatosPicker from "./IaCandidatosPicker.jsx";
import IaEvidenciasChips from "./IaEvidenciasChips.jsx";
import IaEvidenciasMensagens from "./IaEvidenciasMensagens.jsx";
import IaConversasEnvolvidas from "./IaConversasEnvolvidas.jsx";
import IaTemporalAnswerHint from "./IaTemporalAnswerHint.jsx";
import IaArtifactsDownloads from "./IaArtifactsDownloads.jsx";
import { getOrientacaoResumoIa } from "./recorteTemporal.js";
import { getMensagensAnaliticasLista } from "./extractMensagensAnaliticas.js";
import { extractEvidenciasFromData } from "./extractEvidencias.js";
import { isPlainObject } from "./aiAskTypes.js";

/**
 * Card completo: período real acima do markdown, resposta, evidências (grid + ver mais), meta.
 * @param {{
 *   markdown: string,
 *   data: unknown,
 *   intentFromRoot?: string | null,
 *   onCandidatoPick: (s: string) => void,
 *   pickDisabled?: boolean,
 * }} props
 */
export default function IaAnaliticaRespostaCard({ markdown, data, intentFromRoot, onCandidatoPick, pickDisabled }) {
  if (!isPlainObject(data)) {
    return (
      <div className="ia-analitica-wrap">
        <div className="ia-analitica-card">
          <div className="ia-analitica-answer">
            <IaMarkdownContent markdown={markdown} />
          </div>
        </div>
      </div>
    );
  }

  const orientacao = getOrientacaoResumoIa(data);
  const msgList = getMensagensAnaliticasLista(data);
  const legacyChips = msgList.length === 0 && extractEvidenciasFromData(data).length > 0;

  return (
    <div className="ia-analitica-wrap">
      <div className="ia-analitica-card">
        <IaAnaliticaAlerts data={data} />
        <IaPeriodoCabecalho data={data} />
        {orientacao ? <p className="ia-analitica-dica-leitura">{orientacao}</p> : null}
        <IaTemporalAnswerHint answer={markdown} data={data} />
        <div className="ia-analitica-answer">
          <IaMarkdownContent markdown={markdown} />
        </div>
        <IaArtifactsDownloads data={data} />
        <IaEvidenciasMensagens data={data} />
        {legacyChips ? <IaEvidenciasChips data={data} /> : null}
        <IaConversasEnvolvidas data={data} />
        <div className="ia-analitica-meta-row">
          <IaPeriodoFonte data={data} intentFromRoot={intentFromRoot} />
        </div>
        <IaCandidatosPicker data={data} onPick={onCandidatoPick} disabled={pickDisabled} />
      </div>
    </div>
  );
}
