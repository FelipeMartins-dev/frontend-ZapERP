/**
 * Heurísticas só para textos de ajuda na UI (Android vs iPhone/iPad vs desktop).
 * Não altera o comportamento técnico do Web Push — cada SO continua com as suas regras.
 */

function isStandaloneDisplay() {
  if (typeof window === "undefined") return false
  try {
    if (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) return true
  } catch (_) {}
  try {
    if (window.navigator && window.navigator.standalone === true) return true
  } catch (_) {}
  return false
}

function isIOSDevice() {
  if (typeof navigator === "undefined") return false
  const ua = String(navigator.userAgent || "")
  if (/iPad|iPhone|iPod/.test(ua)) return true
  if (navigator.platform === "MacIntel" && (navigator.maxTouchPoints || 0) > 1) return true
  return false
}

function isAndroidDevice() {
  if (typeof navigator === "undefined") return false
  return /Android/i.test(String(navigator.userAgent || ""))
}

/**
 * Mobile / PWA instalada: pode-se preferir Web Push quando a página está suspensa,
 * para evitar som/desktop duplicado com a Notification API.
 * No PC (Chrome/Edge/Firefox em janela normal), retorna false — o alerta nativo deve continuar
 * mesmo que exista subscription push (o push desktop nem sempre cobre o caso “aba em segundo plano”).
 */
export function shouldDeferLocalNotificationToWebPush() {
  if (typeof window === "undefined") return false
  // Só adiar para Web Push em telemóveis reais (iOS/Android), onde o JS da página é
  // suspenso em segundo plano e a Notification API local não é fiável.
  //
  // No PC — mesmo com o ZapERP instalado como app (display-mode: standalone) — a janela
  // continua viva em segundo plano (o socket entrega a mensagem e toca o som). Nesse caso o
  // card local (Notification API) é o canal FIÁVEL e deve ser sempre usado; o Web Push no
  // desktop frequentemente não cobre o caso "janela em segundo plano", o que fazia o som
  // chegar sem o card. Por isso o standalone deixou de forçar o adiamento aqui.
  return isIOSDevice() || isAndroidDevice()
}

/**
 * @returns {{ variant: 'ios' | 'android' | 'other', standalone: boolean, lines: string[] }}
 */
export function getPushPlatformHints() {
  const standalone = isStandaloneDisplay()

  if (isIOSDevice()) {
    return {
      variant: "ios",
      standalone,
      lines: standalone
        ? [
            "Neste iPhone/iPad, o Web Push segue as regras da Apple: costuma exigir iOS/iPadOS 16.4 ou superior e o ZapERP na Tela de Início. Som, agrupamento, sombra na Lock Screen e entrega em segundo plano dependem do sistema — não são idênticos em todos os modelos nem iguais ao Android.",
            "Permissões: Ajustes → Notificações (e/ou Safari, conforme a versão do iOS). O ZapERP não contorna limitações nativas da Apple.",
          ]
        : [
            "No iPhone/iPad, o comportamento completo de push costuma estar disponível quando o ZapERP está instalado na Tela de Início (Safari → compartilhar → Adicionar à Tela de Início). No Safari só na aba, o sistema pode não oferecer o mesmo suporte.",
            "Após instalar o ícone na Tela de Início, abra o ZapERP por esse ícone e ative as notificações aqui se solicitado.",
          ],
    }
  }

  if (isAndroidDevice()) {
    return {
      variant: "android",
      standalone,
      lines: [
        "No Android, com Chrome atualizado e permissões concedidas, as notificações Web Push costumam funcionar em segundo plano e com a tela bloqueada, mas o fabricante (Samsung, Xiaomi, Motorola, etc.) pode alterar gestão de bateria, canais de som e prioridade.",
        "Se deixar de receber alertas, verifique as configurações do sistema (notificações e otimização de bateria) para o Chrome ou para o ZapERP instalado.",
      ],
    }
  }

  return {
    variant: "other",
    standalone,
    lines: [
      "Em computador, o push depende do navegador e do sistema; nem sempre há o mesmo comportamento que no telemóvel em segundo plano.",
    ],
  }
}
