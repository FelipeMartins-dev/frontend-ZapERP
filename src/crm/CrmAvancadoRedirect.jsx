import { useEffect, useState } from "react";
import CrmLayout from "./CrmLayout";
import api from "../api/http";

/**
 * Ponto de entrada do CRM no ZapERP.
 *
 * Quando a integração com o CRM Avançado está configurada (o backend
 * responde a URL de SSO), redireciona o navegador para lá. Se não estiver
 * configurada (backend responde 503), cai de volta no CRM interno do
 * ZapERP — assim esta mudança é 100% não-destrutiva: sem CRM_AVANCADO_URL
 * definido, o comportamento é exatamente o de antes.
 */
export default function CrmAvancadoRedirect() {
  const [fallback, setFallback] = useState(false);
  const [erro, setErro] = useState(null);

  useEffect(() => {
    let ativo = true;

    api
      .get("/api/crm/abrir-avancado")
      .then(({ data }) => {
        if (!ativo) return;
        if (data && data.url) {
          window.location.replace(data.url);
        } else {
          setFallback(true);
        }
      })
      .catch((e) => {
        if (!ativo) return;
        // 503 = integração desativada neste ambiente → usa o CRM interno.
        if (e && e.response && e.response.status === 503) {
          setFallback(true);
        } else {
          setErro("Não foi possível abrir o CRM Avançado. Tente novamente.");
        }
      });

    return () => {
      ativo = false;
    };
  }, []);

  if (fallback) {
    // Renderiza o CRM interno original (com seu <Outlet/> e sub-rotas).
    return <CrmLayout />;
  }

  if (erro) {
    return (
      <div style={{ padding: 24, color: "#b91c1c" }} role="alert">
        {erro}
      </div>
    );
  }

  return (
    <div style={{ padding: 24, color: "#475569" }} aria-busy="true">
      Abrindo o CRM Avançado…
    </div>
  );
}
