import { SkeletonLine } from "../components/feedback/Skeleton";

/** Tela leve de carregamento — evita montar o ConversaView completo enquanto o GET da conversa roda. */
export default function ConversaLoadingScreen() {
  return (
    <div className="wa-empty">
      <div className="wa-empty-card wa-empty-card-loading">
        <div className="wa-empty-title">Carregando conversa…</div>
        <div className="wa-empty-skel">
          <SkeletonLine width="70%" />
          <SkeletonLine width="92%" />
          <SkeletonLine width="84%" />
          <SkeletonLine width="60%" />
        </div>
      </div>
    </div>
  );
}
