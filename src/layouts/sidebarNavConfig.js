/** Match de rota ativa para itens da sidebar (evita /dashboard ativar junto com /dashboard/ia). */
export function isSidebarNavActive(to, pathname) {
  const path = String(pathname || "");
  if (to === "/dashboard") return path === "/dashboard";
  if (to === "/dashboard/ia") return path.startsWith("/dashboard/ia");
  if (to === "/atendimento") return path === "/atendimento" || path.startsWith("/atendimento/");
  if (to === "/crm") return path.startsWith("/crm");
  if (to === "/ia") return path === "/ia" || path.startsWith("/ia/");
  if (to === "/helpdesk") return path === "/helpdesk" || path.startsWith("/helpdesk/");
  return path === to || path.startsWith(`${to}/`);
}
