import api from "../api/http";

/**
 * GET /chats/whatsapp-instances — instâncias ativas (sem tokens).
 * @returns {Promise<{ instances: any[], hasMultipleWhatsappInstances: boolean, activeCount: number }>}
 */
export async function fetchWhatsappInstancesAtendimento(options = {}) {
  const { data } = await api.get("/chats/whatsapp-instances", {
    signal: options.signal,
    silent: options.silent === true,
  });
  const instances = Array.isArray(data?.instances)
    ? data.instances
    : Array.isArray(data)
      ? data
      : [];
  const hasMultipleWhatsappInstances =
    typeof data?.has_multiple_whatsapp_instances === "boolean"
      ? data.has_multiple_whatsapp_instances
      : instances.length > 1;
  return {
    instances,
    hasMultipleWhatsappInstances,
    activeCount: Number(data?.active_count) || instances.length,
  };
}

export function whatsappInstanceLabel(inst) {
  if (!inst || typeof inst !== "object") return "";
  return String(inst.nome || inst.display_phone || "").trim();
}
