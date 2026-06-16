import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAuthStore } from "../auth/authStore";
import { can, canGerenciarRespostasSalvas, isSupervisorOrAdmin } from "../auth/permissions";
import ProtectedRoute from "./ProtectedRoute";

import Login from "../pages/Login";
import MainLayout from "../layouts/MainLayout";
import NotFound from "../pages/NotFound";
import Atendimento from "../pages/Atendimento";

const Dashboard = lazy(() => import("../dashboard/Dashboard"));
const Configuracoes = lazy(() => import("../pages/Configuracoes"));
const IA = lazy(() => import("../pages/IA"));
const DashboardIA = lazy(() => import("../pages/DashboardIA"));
const NovoContato = lazy(() => import("../pages/NovoContato"));
const NovoGrupo = lazy(() => import("../pages/NovoGrupo"));
const NovaComunidade = lazy(() => import("../pages/NovaComunidade"));
const ConnectWhatsApp = lazy(() => import("../pages/ConnectWhatsApp"));
const Permissoes = lazy(() => import("../pages/Permissoes"));
const Mensagens = lazy(() => import("../pages/Mensagens"));
const Atalhos = lazy(() => import("../pages/Atalhos"));
const InternalChat = lazy(() => import("../pages/InternalChat"));
const Supervisao = lazy(() => import("../pages/Supervisao"));

const CrmLayout = lazy(() => import("../crm/CrmLayout"));
const CrmDashboard = lazy(() => import("../crm/pages/CrmDashboard"));
const CrmKanban = lazy(() => import("../crm/pages/CrmKanban"));
const CrmAgenda = lazy(() => import("../crm/pages/CrmAgenda"));
const CrmLeads = lazy(() => import("../crm/pages/CrmLeads"));
const CrmLeadDetail = lazy(() => import("../crm/pages/CrmLeadDetail"));
const CrmPipelines = lazy(() => import("../crm/pages/CrmPipelines"));
const CrmStages = lazy(() => import("../crm/pages/CrmStages"));
const CrmOrigens = lazy(() => import("../crm/pages/CrmOrigens"));

/** Fallback leve para rotas lazy (sem alterar layout do MainLayout). */
function RoutePageFallback() {
  return (
    <div
      style={{
        flex: 1,
        minHeight: 120,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        color: "var(--ds-text-muted, var(--wa-text-muted, #64748b))",
        fontSize: 14,
      }}
      aria-busy="true"
      aria-live="polite"
    >
      Carregando…
    </div>
  );
}

function LazyPage({ children }) {
  return <Suspense fallback={<RoutePageFallback />}>{children}</Suspense>;
}

export default function AppRoutes() {
  const { token, user } = useAuthStore();
  const canAccessConfig = can("config_acessar", user);
  const canAccessRespostasSalvas = canGerenciarRespostasSalvas(user);
  const canAccessDashboard_ = can("dashboard_acessar", user);
  const canAccessChatbot_ = can("chatbot_acessar", user);
  const canAccessUsers = can("usuarios_acessar", user);
  const canAccessSupervisao = isSupervisorOrAdmin(user);

  if (!token) {
    return (
      <BrowserRouter>
        <Routes>
          <Route path="*" element={<Login />} />
        </Routes>
      </BrowserRouter>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<MainLayout />}>
          <Route path="/" element={<Navigate to="/atendimento" replace />} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute canAccess={canAccessDashboard_} redirectTo="/atendimento">
                <LazyPage>
                  <Dashboard />
                </LazyPage>
              </ProtectedRoute>
            }
          />
          <Route
            path="/dashboard/ia"
            element={
              <ProtectedRoute canAccess={canAccessDashboard_} redirectTo="/atendimento">
                <LazyPage>
                  <DashboardIA />
                </LazyPage>
              </ProtectedRoute>
            }
          />
          <Route path="/atendimento" element={<Atendimento />} />
          <Route
            path="/chat-interno"
            element={
              <LazyPage>
                <InternalChat />
              </LazyPage>
            }
          />
          <Route
            path="/supervisao"
            element={
              <ProtectedRoute canAccess={canAccessSupervisao} redirectTo="/atendimento">
                <LazyPage>
                  <Supervisao />
                </LazyPage>
              </ProtectedRoute>
            }
          />
          <Route
            path="/atendimento/novo-contato"
            element={
              <LazyPage>
                <NovoContato />
              </LazyPage>
            }
          />
          <Route
            path="/atendimento/novo-grupo"
            element={
              <LazyPage>
                <NovoGrupo />
              </LazyPage>
            }
          />
          <Route
            path="/atendimento/nova-comunidade"
            element={
              <LazyPage>
                <NovaComunidade />
              </LazyPage>
            }
          />
          <Route
            path="/chatbot"
            element={
              canAccessChatbot_ ? (
                <Navigate to="/ia" replace />
              ) : (
                <Navigate to="/atendimento" replace />
              )
            }
          />
          <Route
            path="/configuracoes"
            element={
              <ProtectedRoute canAccess={canAccessConfig || canAccessRespostasSalvas} redirectTo="/atendimento">
                <LazyPage>
                  <Configuracoes />
                </LazyPage>
              </ProtectedRoute>
            }
          />
          <Route
            path="/configuracoes/whatsapp"
            element={
              <ProtectedRoute canAccess={canAccessConfig} redirectTo="/atendimento">
                <LazyPage>
                  <ConnectWhatsApp />
                </LazyPage>
              </ProtectedRoute>
            }
          />
          <Route
            path="/configuracoes/chatbot"
            element={
              canAccessChatbot_ ? (
                <Navigate to="/ia?tab=chatbot" replace />
              ) : (
                <Navigate to="/atendimento" replace />
              )
            }
          />
          <Route
            path="/ia"
            element={
              <ProtectedRoute canAccess={canAccessChatbot_} redirectTo="/atendimento">
                <LazyPage>
                  <IA />
                </LazyPage>
              </ProtectedRoute>
            }
          />
          <Route
            path="/usuarios"
            element={
              canAccessUsers ? (
                <Navigate to="/configuracoes?tab=usuarios" replace />
              ) : (
                <Navigate to="/atendimento" replace />
              )
            }
          />
          <Route
            path="/permissoes"
            element={
              canAccessUsers ? (
                <LazyPage>
                  <Permissoes />
                </LazyPage>
              ) : (
                <Navigate to="/atendimento" replace />
              )
            }
          />
          <Route path="/campanhas" element={<Navigate to="/atendimento" replace />} />
          <Route
            path="/mensagens"
            element={
              <LazyPage>
                <Mensagens />
              </LazyPage>
            }
          />
          <Route
            path="/atalhos"
            element={
              <LazyPage>
                <Atalhos />
              </LazyPage>
            }
          />

          <Route
            path="/crm"
            element={
              <LazyPage>
                <CrmLayout />
              </LazyPage>
            }
          >
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route
              path="dashboard"
              element={
                <LazyPage>
                  <CrmDashboard />
                </LazyPage>
              }
            />
            <Route
              path="kanban"
              element={
                <LazyPage>
                  <CrmKanban />
                </LazyPage>
              }
            />
            <Route
              path="agenda"
              element={
                <LazyPage>
                  <CrmAgenda />
                </LazyPage>
              }
            />
            <Route
              path="leads"
              element={
                <LazyPage>
                  <CrmLeads />
                </LazyPage>
              }
            />
            <Route
              path="leads/:id"
              element={
                <LazyPage>
                  <CrmLeadDetail />
                </LazyPage>
              }
            />
            <Route
              path="pipelines"
              element={
                <LazyPage>
                  <CrmPipelines />
                </LazyPage>
              }
            />
            <Route
              path="stages"
              element={
                <LazyPage>
                  <CrmStages />
                </LazyPage>
              }
            />
            <Route
              path="origens"
              element={
                <LazyPage>
                  <CrmOrigens />
                </LazyPage>
              }
            />
          </Route>

          <Route path="*" element={<NotFound />} />
        </Route>

        <Route path="/login" element={<Login />} />
      </Routes>
    </BrowserRouter>
  );
}
