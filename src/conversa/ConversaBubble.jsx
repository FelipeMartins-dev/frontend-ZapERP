import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { resolveContactMetaFromMessage } from "../utils/conversaUtils";
import { SwipeReplyTrack } from "./SwipeReplyTrack";
import { useConversaStore } from "./conversaStore";
import {
  safeString,
  isOutgoingMessage,
  isFilenameOnlyText,
  looksLikeDocumentFilenameOnly,
  getMediaPlaybackUrl,
  resolveBubbleMediaCandidates,
  resolveAudioPlaybackCandidates,
  formatHora,
  formatMmSs,
  formatFileSize,
  getFileExt,
  clamp,
  getVisualViewportLayout,
  seedFromAny,
  makeWaveBars,
  resolveDownloadFilename,
  buildMediaDownloadHref,
} from "./utils/conversaViewHelpers";
import { renderTextWithLinks } from "./utils/conversaViewFormat";
import {
  replySnippetDisplay,
  getReplySenderLabel,
  nameColor,
} from "./utils/conversaMessageDisplay";
import { copyTextToClipboard } from "./utils/conversaViewHelpers";
import {
  IconPlay,
  IconPause,
  IconClose,
  IconEmoji,
  TickSvg,
} from "./conversaViewIcons";

let __waCurrentAudio = null;
const WA_AUDIO_SPEEDS = [1, 1.5, 2];
const WA_REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏", "👏"];
const WA_REACTION_MORE_EMOJIS = ["😍", "🔥", "🎉", "✅", "🤔", "😡"];

/** Imagem na bolha com fallback: blob local → URL do servidor → proxy. */
function BubbleImage({ msg, alt, className }) {
  const candidates = useMemo(() => resolveBubbleMediaCandidates(msg), [
    msg?._optimisticBlobUrl,
    msg?.url,
    msg?.url_absoluta,
    msg?.media_url,
    msg?.mediaUrl,
    msg?.file_url,
    msg?.fileUrl,
    msg?.download_url,
    msg?.downloadUrl,
  ]);
  const [idx, setIdx] = useState(0);
  const [exhausted, setExhausted] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setIdx(0);
    setExhausted(false);
    setLoaded(false);
  }, [candidates.join("\u0001")]);

  const src = candidates[idx] || "";
  if (!src || exhausted) return <span className="wa-bubble-text wa-muted">(imagem)</span>;

  return (
    <img
      src={src}
      alt={alt}
      className={`${className || ""} ${loaded ? "is-loaded" : "is-loading"}`.trim()}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onLoad={() => setLoaded(true)}
      onError={() => {
        setLoaded(false);
        setIdx((cur) => {
          if (cur + 1 < candidates.length) return cur + 1;
          setExhausted(true);
          return cur;
        });
      }}
    />
  );
}

function MessageTicks({ msg, isGroup }) {
  const out = isOutgoingMessage(msg);
  if (!out) return null;

  const raw = msg?.status_mensagem ?? msg?.status ?? msg?.situacao;
  const maybeNum = typeof raw === "number" && Number.isFinite(raw) ? raw : (/^\d+$/.test(String(raw || "").trim()) ? Number(raw) : null);
  const rawStatus = raw != null && maybeNum == null ? safeString(raw).toLowerCase() : String(maybeNum ?? "");
  const hasReadAt = !!(msg?.lida_em || msg?.lidaEm || msg?.read_at || msg?.readAt);
  const hasDeliveredAt = !!(msg?.entregue_em || msg?.entregueEm || msg?.delivered_at || msg?.deliveredAt);

  if (maybeNum != null) {
    if (maybeNum <= 0) return <span className="wa-ticks isPending"><TickSvg kind="pending" /></span>;
    if (maybeNum === 1) return <span className="wa-ticks"><TickSvg kind="sent" /></span>;
    if (maybeNum === 2) return <span className="wa-ticks isDelivered"><TickSvg kind="delivered" /></span>;
    if (maybeNum >= 3 && !isGroup) return <span className="wa-ticks isRead"><TickSvg kind="read" /></span>;
    if (maybeNum >= 3 && isGroup) return <span className="wa-ticks isDelivered"><TickSvg kind="delivered" /></span>;
  }

  const s = rawStatus;
  const hasReadKeyword = /lida|read|seen|visualiz|played/.test(s);
  const hasDeliveredKeyword = /entregue|deliver|receiv/.test(s);
  const isErr = s === "erro" || s === "error" || s === "failed" || s === "falhou";
  const isRetry = !isErr && !!(msg?.em_retry);
  const isPending = !isRetry && (s === "pending" || s === "enviando" || s === "sending");
  let isRead =
    s === "lida" || s === "read" || s === "seen" ||
    s === "visualizada" || s === "played" ||
    hasReadAt ||
    hasReadKeyword;
  if (isGroup) isRead = false; // grupos: cap em delivered, nunca azul
  const isDelivered =
    isRead ||
    s === "entregue" || s === "delivered" || s === "received" ||
    hasDeliveredAt ||
    hasDeliveredKeyword;
  // sent: mensagem confirmada pelo servidor WA mas ainda não entregue ao dispositivo
  const isSent = !isErr && !isPending && !isDelivered && !isRead &&
    (!s || s === "sent" || s === "enviada" || s === "enviado");

  return (
    <span
      className={`wa-ticks ${isDelivered ? "isDelivered" : ""} ${isRead ? "isRead" : ""} ${isErr ? "isErr" : ""} ${isPending ? "isPending" : ""} ${isRetry ? "isPending isRetry" : ""}`}
      title={isRetry ? "Aguardando reenvio automático" : undefined}
    >
      <TickSvg kind={isErr ? "err" : (isPending || isRetry) ? "pending" : isRead ? "read" : isDelivered ? "delivered" : isSent ? "sent" : "sent"} />
    </span>
  );
}

/**
 * Card de arquivo estilo WhatsApp: ícone com extensão, nome, tipo/tamanho,
 * timestamp, ticks e links "Abrir" / "Salvar como..."
 */
function FileBubbleContent({ msg, mediaUrl, selectMode, onOpenMedia, isGroup, out }) {
  const nome = resolveDownloadFilename(
    msg?.nome_arquivo ?? msg?.n ?? (looksLikeDocumentFilenameOnly(msg?.texto) ? msg?.texto : null),
    mediaUrl
  );
  const ext = getFileExt(nome);
  const bytes = msg?.tamanho ?? msg?.tamanho_bytes;
  const size = formatFileSize(bytes);
  const typeSize = size ? `${ext} · ${size}` : ext;
  const encaminhado = !!msg?.encaminhado || (typeof msg?.texto === "string" && msg.texto.trimStart().startsWith("[Encaminhado]"));

  const handleCardClick = (e) => {
    if (!selectMode) e.stopPropagation();
  };

  return (
    <div className={`wa-bubble-fileCard ${out ? "wa-bubble-fileCard--out" : ""}`} onClick={handleCardClick}>
      {encaminhado ? <div className="wa-bubble-encaminhado">[Encaminhado]</div> : null}
      <div className="wa-bubble-fileTop">
        <div className={`wa-bubble-fileIconWrap wa-bubble-fileIconWrap--${ext.toLowerCase()}`} aria-hidden="true">
          <span className="wa-bubble-fileExt">{ext}</span>
        </div>
        <div className="wa-bubble-fileMain">
          <span className="wa-bubble-fileName">{nome}</span>
          <span className="wa-bubble-fileTypeSize">{typeSize}</span>
        </div>
        <span className="wa-bubble-fileTimeMeta">
          <span className="wa-bubble-fileTime">{formatHora(msg?.criado_em)}</span>
          <MessageTicks msg={msg} isGroup={Boolean(isGroup)} />
        </span>
      </div>
      <div className="wa-bubble-fileActions">
        <button
          type="button"
          className="wa-bubble-fileAction"
          disabled={!!selectMode}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!selectMode && mediaUrl) onOpenMedia?.(mediaUrl, "arquivo", nome);
          }}
        >
          Abrir
        </button>
        {mediaUrl ? (
          <>
            <span className="wa-bubble-fileActionSep" aria-hidden="true">·</span>
            <a
              href={buildMediaDownloadHref(msg?.url, msg?.url_absoluta, nome) || mediaUrl}
              download={nome}
              className="wa-bubble-fileAction"
              onClick={(e) => e.stopPropagation()}
              target="_blank"
              rel="noreferrer"
            >
              Salvar como...
            </a>
          </>
        ) : null}
      </div>
    </div>
  );
}

function ContactBubbleContent({
  msg,
  contactMeta,
  selectMode,
  isGroup,
  out,
  onConversar,
  onAdicionarGrupo,
}) {
  const meta = contactMeta || resolveContactMetaFromMessage(msg);
  if (!meta) return null;
  const nome = meta.nome || "Contato";
  const telefone = meta.telefone || null;
  const fotoPerfil = meta.foto_perfil && String(meta.foto_perfil).trim().startsWith("http")
    ? String(meta.foto_perfil).trim()
    : null;
  const iniciais = nome
    .trim()
    .split(/\s+/)
    .map((s) => s[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) || "?";

  const handleCardClick = (e) => {
    if (!selectMode) e.stopPropagation();
  };

  return (
    <div className={`wa-bubble-contactCard ${out ? "wa-bubble-contactCard--out" : ""}`} onClick={handleCardClick}>
      <div className="wa-bubble-contactHeader">
        <div className="wa-bubble-contactAvatarWrap">
          {fotoPerfil ? (
            <img
              src={fotoPerfil}
              alt=""
              className="wa-bubble-contactAvatar"
              referrerPolicy="no-referrer"
              loading="lazy"
            />
          ) : (
            <span className="wa-bubble-contactInitials" aria-hidden="true">{iniciais}</span>
          )}
        </div>
        <div className="wa-bubble-contactInfo">
          <span className="wa-bubble-contactName">{nome}</span>
          <span className="wa-bubble-contactTimeMeta">
            <span className="wa-bubble-contactTime">{formatHora(msg?.criado_em)}</span>
            <MessageTicks msg={msg} isGroup={Boolean(isGroup)} />
          </span>
        </div>
      </div>
      <div className="wa-bubble-contactDivider" />
      <div className="wa-bubble-contactActions">
        <button
          type="button"
          className="wa-bubble-contactAction"
          disabled={!!selectMode}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!selectMode && onConversar) onConversar({ nome, telefone });
          }}
        >
          Conversar
        </button>
        <button
          type="button"
          className="wa-bubble-contactAction"
          disabled={!!selectMode}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!selectMode && onAdicionarGrupo) onAdicionarGrupo({ nome, telefone });
          }}
        >
          Adicionar a um grupo
        </button>
      </div>
    </div>
  );
}

/** Formata coordenadas com no máx. 5 decimais */
function formatCoords(lat, lng) {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  const rounded = (n) => Math.round(n * 100000) / 100000;
  return `${rounded(la)}, ${rounded(ln)}`;
}

/** Extrai endereço e coordenadas do texto da mensagem de localização */
function parseLocationText(texto) {
  const raw = safeString(texto).trim();
  if (!raw) return { address: null, coords: null, coordsFormatted: null };

  const coordsMatch = raw.match(/\(?(-?\d+\.?\d*),\s*(-?\d+\.?\d*)\)?/);
  const isCoordsOnly = /^\(?\s*-?\d+\.?\d*,\s*-?\d+\.?\d*\s*\)?$/.test(raw.replace(/\s+/g, " ").trim());
  const hasAddress = raw.includes("•") && !isCoordsOnly;

  let address = null;
  let coordsFormatted = null;

  if (coordsMatch) {
    coordsFormatted = formatCoords(coordsMatch[1], coordsMatch[2]);
  }

  if (isCoordsOnly && coordsMatch) {
    return { address: null, coords: raw, coordsFormatted };
  }

  if (hasAddress) {
    const withoutCoords = raw.replace(/\s*\(?(-?\d+\.?\d*),\s*(-?\d+\.?\d*)\)?\s*$/, "").trim().replace(/\s*•\s*$/, "").trim();
    address = withoutCoords || null;
  }

  return { address, coords: coordsMatch ? `${coordsMatch[1]}, ${coordsMatch[2]}` : null, coordsFormatted };
}

/** Mapa estático (OSM) — sem API key; fallback é só o link em `url`. */
function buildStaticMapUrl(lat, lng) {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  return `https://staticmap.openstreetmap.de/staticmap.php?center=${la},${ln}&zoom=15&size=320x160&maptype=mapnik&markers=${la},${ln},red-pushpin`;
}

/** Mensagem de localização — `location_meta` + mapa/link; fallback texto/url legado */
function LocationBubbleContent({ msg, selectMode, isGroup, out }) {
  const texto = safeString(msg?.texto);
  const isLive = msg?.location_live === true;
  const meta = msg?.location_meta && typeof msg.location_meta === "object" ? msg.location_meta : null;
  const latM = meta != null ? Number(meta.latitude) : NaN;
  const lngM = meta != null ? Number(meta.longitude) : NaN;
  const hasMetaCoords = Number.isFinite(latM) && Number.isFinite(lngM);

  const mapUrl =
    (msg?.url && String(msg.url).trim()) ||
    (hasMetaCoords
      ? `https://www.google.com/maps?q=${encodeURIComponent(`${latM},${lngM}`)}`
      : `https://www.google.com/maps/search/${encodeURIComponent(texto || "localização")}`);

  const staticMapUrl = hasMetaCoords ? buildStaticMapUrl(latM, lngM) : null;

  const nomeMeta = meta ? safeString(meta.nome) : "";
  const enderecoMeta = meta ? safeString(meta.endereco) : "";

  const { address, coordsFormatted } = parseLocationText(texto);
  const hasCoords = !!coordsFormatted;
  const legacyLine =
    !hasMetaCoords && (address || (texto && !hasCoords ? texto : null) || null);

  const handleCardClick = (e) => {
    if (!selectMode) e.stopPropagation();
  };

  return (
    <div
      className={`wa-bubble-locationCard ${out ? "wa-bubble-locationCard--out" : ""}`}
      onClick={handleCardClick}
    >
      <span className="wa-bubble-locationBadge">
        {isLive ? "Localização em tempo real" : "Localização"}
      </span>
      {staticMapUrl ? (
        <a
          href={mapUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="wa-bubble-locationMapLink"
          onClick={(e) => e.stopPropagation()}
          aria-label="Abrir localização no mapa"
        >
          <img
            src={staticMapUrl}
            alt=""
            className="wa-bubble-locationMap"
            loading="lazy"
            decoding="async"
          />
        </a>
      ) : null}
      <div className="wa-bubble-locationContent">
        <span className="wa-bubble-locationIcon" aria-hidden="true">📍</span>
        {hasMetaCoords ? (
          <>
            {nomeMeta ? <p className="wa-bubble-locationAddress">{nomeMeta}</p> : null}
            {enderecoMeta ? (
              <p
                className={`wa-bubble-locationAddress ${nomeMeta ? "wa-bubble-locationAddress--sub" : ""}`}
              >
                {enderecoMeta}
              </p>
            ) : null}
          </>
        ) : legacyLine ? (
          <p className="wa-bubble-locationAddress">{legacyLine}</p>
        ) : null}
        {hasMetaCoords ? (
          <p className="wa-bubble-locationCoords">{formatCoords(latM, lngM)}</p>
        ) : hasCoords ? (
          <p className="wa-bubble-locationCoords">{coordsFormatted}</p>
        ) : null}
        <a
          href={mapUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="wa-bubble-locationCta"
          onClick={(e) => e.stopPropagation()}
        >
          Abrir no mapa
        </a>
      </div>
      <div className="wa-bubble-locationFooter">
        <span className="wa-bubble-locationTime">{formatHora(msg?.criado_em)}</span>
        <MessageTicks msg={msg} isGroup={Boolean(isGroup)} />
      </div>
    </div>
  );
}

function AudioWavePlayer({ src, candidates, msgKey, avatarUrl, avatarLabel, onDuration, sentAtLabel }) {
  const sourceList = useMemo(() => {
    const list = Array.isArray(candidates) && candidates.length ? candidates : src ? [src] : [];
    const seen = new Set();
    return list.filter((u) => {
      const s = String(u || "").trim();
      if (!s || seen.has(s)) return false;
      seen.add(s);
      return true;
    });
  }, [candidates, src]);
  const [sourceIdx, setSourceIdx] = useState(0);
  const activeSrc = sourceList[sourceIdx] || "";
  const audioRef = useRef(null);
  const waveMeasureRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [dur, setDur] = useState(0);
  const [cur, setCur] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [waveBarCount, setWaveBarCount] = useState(34);
  const rafRef = useRef(null);
  const rafLastRef = useRef(0);
  const pointerToggleRef = useRef(false);

  useEffect(() => {
    setSourceIdx(0);
    setPlaying(false);
    setCur(0);
    setDur(0);
  }, [sourceList.join("\u0001")]);

  useLayoutEffect(() => {
    const el = waveMeasureRef.current;
    if (!el || typeof ResizeObserver === "undefined") {
      setWaveBarCount(34);
      return;
    }
    let rafId = 0;
    const update = () => {
      const w = el.getBoundingClientRect?.().width || el.offsetWidth || 200;
      const n = clamp(Math.floor(w / 4), 18, 56);
      setWaveBarCount((prev) => (prev === n ? prev : n));
    };
    const schedule = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        update();
      });
    };
    schedule();
    const ro = new ResizeObserver(() => schedule());
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [activeSrc]);

  const bars = useMemo(() => makeWaveBars(waveBarCount, seedFromAny(msgKey)), [msgKey, waveBarCount]);

  useEffect(() => {
    setPlaybackRate(1);
  }, [activeSrc]);

  useEffect(() => {
    const el = audioRef.current;
    return () => {
      if (!el) return;
      try {
        el.pause();
      } catch {
        /* ignore */
      }
      if (__waCurrentAudio === el) {
        __waCurrentAudio = null;
      }
    };
  }, [activeSrc]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    try {
      el.playbackRate = playbackRate;
    } catch {
      /* ignore */
    }
  }, [playbackRate, activeSrc]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    const onLoaded = () => {
      const d = Number(el.duration);
      if (Number.isFinite(d) && d > 0) {
        setDur(d);
        try { onDuration?.(d); } catch {}
      }
      try {
        el.playbackRate = playbackRate;
      } catch {
        /* ignore */
      }
    };
    const onSeeked = () => setCur(Number(el.currentTime || 0));
    const onEnded = () => {
      setPlaying(false);
      setCur(0);
    };
    const onPlay = () => {
      setPlaying(true);
      try {
        el.playbackRate = playbackRate;
      } catch {
        /* ignore */
      }
    };
    const onPause = () => setPlaying(false);
    const onError = () => {
      setPlaying(false);
      setSourceIdx((curIdx) => (curIdx + 1 < sourceList.length ? curIdx + 1 : curIdx));
    };

    el.addEventListener("loadedmetadata", onLoaded);
    el.addEventListener("seeked", onSeeked);
    el.addEventListener("ended", onEnded);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("error", onError);
    return () => {
      el.removeEventListener("loadedmetadata", onLoaded);
      el.removeEventListener("seeked", onSeeked);
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("error", onError);
    };
  }, [activeSrc, playbackRate, sourceList.length]);

  // Progresso mais fluido (rAF com throttle leve) enquanto toca
  useEffect(() => {
    const el = audioRef.current;
    if (!el || !playing) return;

    const tick = (t) => {
      if (!audioRef.current) return;
      const last = rafLastRef.current || 0;
      if (!last || t - last >= 66) {
        rafLastRef.current = t;
        setCur(Number(audioRef.current.currentTime || 0));
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      rafLastRef.current = 0;
    };
  }, [playing]);

  const toggle = useCallback(async () => {
    const el = audioRef.current;
    if (!el) return;
    try {
      if (__waCurrentAudio && __waCurrentAudio !== el) {
        try { __waCurrentAudio.pause(); } catch {}
      }
      __waCurrentAudio = el;
      try {
        el.playbackRate = playbackRate;
      } catch {
        /* ignore */
      }
      if (el.paused) {
        await el.play();
      } else {
        el.pause();
      }
    } catch {
      if (sourceIdx + 1 < sourceList.length) {
        setSourceIdx((curIdx) => curIdx + 1);
      }
    }
  }, [playbackRate, sourceIdx, sourceList.length]);

  const handlePlayPointerUp = useCallback(
    (e) => {
      if (e.pointerType !== "touch" && e.pointerType !== "pen") return;
      e.preventDefault();
      e.stopPropagation();
      pointerToggleRef.current = true;
      void toggle();
    },
    [toggle]
  );

  const handlePlayClick = useCallback(
    (e) => {
      e.stopPropagation();
      if (pointerToggleRef.current) {
        pointerToggleRef.current = false;
        return;
      }
      void toggle();
    },
    [toggle]
  );

  const seek = useCallback((e) => {
    const el = audioRef.current;
    if (!el) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const frac = rect.width > 0 ? clamp(x / rect.width, 0, 1) : 0;
    const target = (dur || el.duration || 0) * frac;
    if (Number.isFinite(target)) {
      el.currentTime = target;
      setCur(target);
    }
  }, [dur]);

  const frac = dur > 0 ? clamp(cur / dur, 0, 1) : 0;
  const playedBars = Math.round(frac * bars.length);
  const remaining = dur > 0 ? Math.max(0, dur - cur) : 0;
  const pLabel = `${Math.round(frac * 100)}%`;

  return (
    <div className={`wa-audioPlayer ${playing ? "isPlaying" : ""}`}>
      <button
        type="button"
        className={`wa-audioPlayBtn ${playing ? "isPlaying" : ""}`}
        onPointerUp={handlePlayPointerUp}
        onClick={handlePlayClick}
        aria-label={playing ? "Pausar áudio" : "Tocar áudio"}
      >
        <span className="wa-audioPlayIcon wa-audioPlayIcon--play" aria-hidden="true">
          <IconPlay width="22" height="22" />
        </span>
        <span className="wa-audioPlayIcon wa-audioPlayIcon--pause" aria-hidden="true">
          <IconPause width="22" height="22" />
        </span>
      </button>
      <div className="wa-audioMid">
        <div className="wa-audioWaveRow">
          <div
            ref={waveMeasureRef}
            className="wa-audioWave"
            role="slider"
            aria-label="Progresso do áudio"
            onClick={seek}
            style={{ "--p": pLabel }}
          >
            {bars.map((v, i) => (
              <div
                key={i}
                className={`wa-audioBar ${i < playedBars ? "isPlayed" : ""}`}
                style={{ height: `${Math.round(8 + v * 18)}px`, "--i": i }}
              />
            ))}
            <div className="wa-audioDot" style={{ left: `${Math.round(frac * 100)}%` }} aria-hidden="true" />
          </div>
          <div className="wa-audioDurSlot">
            {playing ? (
              <span className="wa-audioRemain wa-audioRemain--slot" title={`Restante ${formatMmSs(remaining)}`}>
                -{formatMmSs(remaining)}
              </span>
            ) : null}
            <span className="wa-audioTime wa-audioTime--dur" title={formatMmSs(dur || 0)}>
              {formatMmSs(dur || 0)}
            </span>
          </div>
          <div className="wa-audioSpeedGroup" role="group" aria-label="Velocidade de reprodução">
            {WA_AUDIO_SPEEDS.map((rate) => (
              <button
                key={rate}
                type="button"
                className={`wa-audioSpeedBtn ${playbackRate === rate ? "isActive" : ""}`}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setPlaybackRate(rate);
                  const a = audioRef.current;
                  if (a) {
                    try {
                      a.playbackRate = rate;
                    } catch {
                      /* ignore */
                    }
                  }
                }}
                aria-pressed={playbackRate === rate}
                aria-label={rate === 1 ? "Velocidade normal" : `Velocidade ${rate} vezes`}
                title={rate === 1 ? "1×" : `${rate}×`}
              >
                {rate === 1 ? "1×" : `${rate}×`}
              </button>
            ))}
          </div>
        </div>
        <div className="wa-audioSub">
          <span className="wa-audioTime wa-audioTime--cur" title={formatMmSs(cur)}>
            {formatMmSs(cur)}
          </span>
          {sentAtLabel ? (
            <span className="wa-audioSentAt" title={`Enviado às ${sentAtLabel}`}>
              {sentAtLabel}
            </span>
          ) : null}
        </div>
      </div>
      {avatarUrl ? (
        <span className="wa-audioAvatarWrap" aria-hidden="true">
          <img
            className="wa-audioAvatar"
            src={avatarUrl}
            alt={avatarLabel ? `Foto de ${avatarLabel}` : "Foto do contato"}
            referrerPolicy="no-referrer"
            loading="lazy"
          />
        </span>
      ) : null}
      <audio ref={audioRef} src={activeSrc || undefined} preload="metadata" className="wa-audioElHidden" />
    </div>
  );
}

const Bubble = memo(function Bubble({
  msg,
  showRemetente,
  isGroup,
  peerAvatarUrl,
  peerName,
  selectMode,
  selected,
  onToggleSelected,
  onInfo,
  onReply,
  onCopy,
  onForward,
  onTogglePin,
  onToggleStar,
  onStartSelect,
  onDeleteForMe,
  onDeleteForEveryone,
  isPinned,
  isStarred,
  currentUserId,
  onJumpToReply,
  onOpenMedia,
  localReaction,
  onReact,
  onRemoveReaction,
  reactionBusy,
  onConversarContact,
  onAdicionarGrupoContact,
  mostrarNomeAoCliente = true,
  swipeReplyEnabled = false,
  captionBundleTop = false,
  captionBundleFollow = false,
  /** Mobile/tablet: sem setinha fixa; menu por long press + folha inferior */
  mobileMessageChrome = false,
  menuUsesBottomSheet = false,
  showMobileReactionPicker = false,
  zapAnimateIn = false,
}) {
  const out = isOutgoingMessage(msg);
  const tipoMsg = safeString(msg?.tipo).toLowerCase();
  const isApagadaParaTodos = !!msg?.apagada_para_todos;
  const mediaCandidates = useMemo(
    () => resolveBubbleMediaCandidates(msg),
    [
      msg?._optimisticBlobUrl,
      msg?.url,
      msg?.url_absoluta,
      msg?.media_url,
      msg?.mediaUrl,
      msg?.file_url,
      msg?.fileUrl,
      msg?.download_url,
      msg?.downloadUrl,
    ]
  );
  const mediaUrl = mediaCandidates[0] || "";
  const audioPlaybackCandidates = useMemo(
    () => resolveAudioPlaybackCandidates(msg),
    [
      msg?._optimisticBlobUrl,
      msg?.url,
      msg?.url_absoluta,
      msg?.media_url,
      msg?.mediaUrl,
      msg?.file_url,
      msg?.fileUrl,
      msg?.download_url,
      msg?.downloadUrl,
      msg?.tipo,
    ]
  );
  const videoPlaybackUrl =
    (tipoMsg === "video" || tipoMsg === "vídeo") && mediaUrl
      ? getMediaPlaybackUrl(msg?.url, msg?.url_absoluta)
      : mediaUrl;
  const canDeleteForEveryone = useMemo(() => {
    if (!out) return false;
    if (msg?.apagada_para_todos) return false;
    if (currentUserId == null) return false;
    if (msg?.autor_usuario_id == null) return false;
    return String(msg.autor_usuario_id) === String(currentUserId);
  }, [out, currentUserId, msg?.autor_usuario_id, msg?.apagada_para_todos]);
  /* Com mídia preservada no painel, ainda exibe imagem/áudio após “apagar para todos” no WhatsApp. */
  const isImg =
    (tipoMsg === "imagem" || tipoMsg === "image") && !!mediaUrl && (!isApagadaParaTodos || !!mediaUrl);
  const isSticker =
    tipoMsg === "sticker" && !!mediaUrl && (!isApagadaParaTodos || !!mediaUrl);
  const isFile =
    (["arquivo", "documento", "document", "file"].includes(tipoMsg) ||
      looksLikeDocumentFilenameOnly(msg?.texto, msg?.nome_arquivo)) &&
    (!isApagadaParaTodos || !!mediaUrl);
  const isAudio = tipoMsg === "audio" && (!isApagadaParaTodos || !!mediaUrl);
  const isVoice = (tipoMsg === "voice" || tipoMsg === "ptt") && (!isApagadaParaTodos || !!mediaUrl);
  const isAudioOrVoice = isAudio || isVoice;
  const isVideo = (tipoMsg === "video" || tipoMsg === "vídeo") && (!isApagadaParaTodos || !!mediaUrl);
  const contactBubbleMeta = useMemo(() => resolveContactMetaFromMessage(msg), [msg]);
  const isContact = !!contactBubbleMeta;
  const isLocation = tipoMsg === "location";
  const textoRaw = safeString(msg?.texto);
  const textoRawNorm = String(textoRaw || "").trim().toLowerCase();
  const isGenericMessagePlaceholder = textoRawNorm === "(mensagem)" || textoRawNorm === "(mensagem vazia)";
  const texto =
    isApagadaParaTodos && !textoRaw
      ? "Esta mensagem foi apagada para todos."
      : (isGenericMessagePlaceholder ? "" : textoRaw);
  const hasText = !!texto;
  // Rótulo de fallback quando o texto é um placeholder genérico ('(mensagem)'/'(mensagem vazia)')
  // e não há mídia para renderizar: mostra o TIPO da mensagem em vez de "Sem conteudo".
  // Deriva do `tipoMsg` (preservado no banco); se o tipo for desconhecido, cai em "Mensagem".
  const fallbackContentLabel = (() => {
    const t = String(tipoMsg || "").toLowerCase();
    if (t === "audio") return "🎤 Áudio";
    if (t === "voice" || t === "ptt") return "🎤 Mensagem de voz";
    if (t === "imagem" || t === "image") return "📷 Foto";
    if (t === "video" || t === "vídeo") return "🎥 Vídeo";
    if (["arquivo", "documento", "document", "file"].includes(t)) return "📄 Documento";
    if (t === "sticker") return "Figurinha";
    if (t === "location") return "📍 Localização";
    if (t === "contact" || t === "contato") return "👤 Contato";
    return "Mensagem";
  })();
  const remetente = showRemetente && !out && (msg?.remetente_nome || msg?.remetente_telefone);
  const isPlaceholderCaption =
    !texto ||
    isGenericMessagePlaceholder ||
    texto === "(mídia)" ||
    texto === "(mensagem vazia)" ||
    texto === "(imagem)" ||
    texto === "(áudio)" ||
    texto === "(áudio de voz)" ||
    texto === "(vídeo)" ||
    texto === "(figurinha)" ||
    texto === "(arquivo)" ||
    // Casos legados: backend antigo gravava o nome do arquivo no texto
    // (ex.: "IMG_6559.png", "VID-20260508.mp4", "WhatsApp Image 2026.jpeg",
    // "image1714560000000.jpg"). Tratamos isso como placeholder para nunca
    // exibir o nome do arquivo como legenda no balão da mensagem.
    isFilenameOnlyText(texto, msg?.nome_arquivo);
  const showCaption = (isImg || isVideo || isSticker) && hasText && !isPlaceholderCaption;
  const showAudioText = isAudioOrVoice && hasText && !isPlaceholderCaption;
  // Detecta mensagem encaminhada: campo encaminhado=true ou texto começa com [Encaminhado]
  const isEncaminhado =
    !isApagadaParaTodos &&
    (!!msg?.encaminhado ||
      (typeof msg?.texto === "string" && msg.texto.trimStart().startsWith("[Encaminhado]")));
  /* Imagem/vídeo/figurinha com legenda: meta (hora/ticks) no rodapé do balão — hasInlineMeta reserva padding à direita sem uso e estoura o layout. */
  const inlineMeta = !showCaption || (!isImg && !isVideo && !isSticker);
  /* Só mensagens de texto usam classe hasInlineMeta (evita CSS esconder .wa-bubble-metaLeft em foto sem legenda). */
  const hasInlineMetaClass = inlineMeta && !isImg && !isVideo && !isSticker && !isAudioOrVoice;
  /* Hora + ticks: rodapé/canto quando não há meta na linha do texto; áudio/voz nunca têm meta inline no corpo. */
  const showFloatingMetaTime =
    (!inlineMeta || ((isImg || isSticker || isVideo) && !showCaption)) ||
    (isAudioOrVoice && !!mediaUrl);
  const replyMeta = !isApagadaParaTodos ? msg?.reply_meta || null : null;
  const hasReply = !!(replyMeta && (replyMeta.name || replyMeta.snippet || replyMeta.thumb));

  // pedido do usuário: setinha no hover para mensagens do cliente
  const showMenuButton = !selectMode;
  const [menuOpen, setMenuOpen] = useState(false);
  /** Âncora da bolha (long press / mobile). */
  const menuAnchorRef = useRef(null);
  /** Botão ▾ no topo — evita menu cortado em fotos/vídeos altos. */
  const menuBtnRef = useRef(null);
  const menuElRef = useRef(null);
  const longPressTimerRef = useRef(null);
  const longPressCleanupRef = useRef(null);
  const skipNextMediaTapTimerRef = useRef(null);
  const mediaTapStartRef = useRef(null);
  const mediaPointerOpenedRef = useRef(false);
  const mediaPointerOpenedTimerRef = useRef(null);
  const bubbleRef = useRef(null);
  /** Mobile: após long press abrir menu, ignorar o próximo clique na foto/vídeo (evita abrir viewer). */
  const skipNextMediaTapRef = useRef(false);

  const clearSkipNextMediaTap = useCallback(() => {
    skipNextMediaTapRef.current = false;
    if (skipNextMediaTapTimerRef.current != null) {
      clearTimeout(skipNextMediaTapTimerRef.current);
      skipNextMediaTapTimerRef.current = null;
    }
  }, []);

  const armSkipNextMediaTap = useCallback(() => {
    clearSkipNextMediaTap();
    skipNextMediaTapRef.current = true;
    skipNextMediaTapTimerRef.current = window.setTimeout(() => {
      skipNextMediaTapRef.current = false;
      skipNextMediaTapTimerRef.current = null;
    }, 650);
  }, [clearSkipNextMediaTap]);

  useEffect(() => {
    if (!zapAnimateIn || !bubbleRef.current) return undefined;
    const el = bubbleRef.current;
    const onEnd = () => el.classList.add("zap-anim-settled");
    el.addEventListener("animationend", onEnd, { once: true });
    return () => el.removeEventListener("animationend", onEnd);
  }, [zapAnimateIn]);

  useEffect(() => {
    if (!menuOpen) clearSkipNextMediaTap();
  }, [menuOpen, clearSkipNextMediaTap]);

  const [menuStyle, setMenuStyle] = useState(null);
  const [reactionOpen, setReactionOpen] = useState(false);
  const [reactionExpanded, setReactionExpanded] = useState(false);
  const isCall = !isApagadaParaTodos && tipoMsg === "call";
  const showReactionPicker = !isCall && (reactionOpen || showMobileReactionPicker);
  const reactionEmojiOptions = reactionExpanded
    ? [...WA_REACTION_EMOJIS, ...WA_REACTION_MORE_EMOJIS]
    : WA_REACTION_EMOJIS;
  const [audioDur, setAudioDur] = useState(0);
  const audioDurLabel = useMemo(() => (audioDur > 0 ? formatMmSs(audioDur) : null), [audioDur]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e) => {
      const a = menuAnchorRef.current;
      const m = menuElRef.current;
      if (a && a.contains(e.target)) return;
      if (m && m.contains(e.target)) return;
      setMenuOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("touchstart", onDoc, { passive: true });
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("touchstart", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const computeMenuPosition = useCallback(() => {
    const anchorEl = menuBtnRef.current || menuAnchorRef.current;
    if (!anchorEl) return;
    const { innerWidth: vw, visibleHeight, visibleTop, keyboardInsetBottom } = getVisualViewportLayout();
    const visibleBottom = visibleTop + visibleHeight;

    if (menuUsesBottomSheet) {
      const bottomPx = Math.max(8, keyboardInsetBottom + 6);
      const maxSheetPx = Math.max(200, Math.floor(visibleHeight - bottomPx - 14));
      setMenuStyle({
        position: "fixed",
        left: 10,
        right: 10,
        width: "auto",
        bottom: `${bottomPx}px`,
        top: "auto",
        maxHeight: `${maxSheetPx}px`,
        overflowY: "auto",
        WebkitOverflowScrolling: "touch",
        overscrollBehavior: "contain",
        zIndex: 10002,
      });
      return;
    }

    const rect = anchorEl.getBoundingClientRect();
    const desiredW = 220;
    const w = Math.max(180, Math.min(desiredW, vw - 16));

    let left = rect.right - w;
    left = clamp(left, 8, Math.max(8, vw - w - 8));

    const menuH = Math.max(menuElRef.current?.offsetHeight || 0, 300);
    const spaceBelow = visibleBottom - rect.bottom - 10;
    const spaceAbove = rect.top - visibleTop - 10;
    const openDown = spaceBelow >= spaceAbove;

    let placed = openDown ? "down" : "up";
    let top = openDown ? rect.bottom + 6 : Math.max(visibleTop + 8, rect.top - menuH - 6);
    let maxHeight = Math.max(200, openDown ? spaceBelow : spaceAbove);

    if (openDown && top + menuH > visibleBottom - 8 && spaceAbove > spaceBelow) {
      placed = "up";
      top = Math.max(visibleTop + 8, rect.top - menuH - 6);
      maxHeight = Math.max(200, spaceAbove);
    } else if (!openDown && top < visibleTop + 8 && spaceBelow >= spaceAbove) {
      placed = "down";
      top = rect.bottom + 6;
      maxHeight = Math.max(200, spaceBelow);
    }

    if (maxHeight < menuH - 12) {
      const fitH = Math.min(menuH, visibleHeight - 16);
      top = visibleTop + Math.max(8, (visibleHeight - fitH) / 2);
      maxHeight = fitH;
      placed = "center";
    }

    top = clamp(top, visibleTop + 8, Math.max(visibleTop + 8, visibleBottom - Math.min(menuH, maxHeight) - 8));

    setMenuStyle({
      position: "fixed",
      top,
      left,
      width: w,
      maxHeight,
      overflowY: maxHeight < menuH - 4 ? "auto" : "visible",
      WebkitOverflowScrolling: "touch",
      zIndex: 10002,
    });
  }, [menuUsesBottomSheet]);

  useLayoutEffect(() => {
    if (!menuOpen || menuUsesBottomSheet) return;
    computeMenuPosition();
    const raf = requestAnimationFrame(() => computeMenuPosition());
    return () => cancelAnimationFrame(raf);
  }, [menuOpen, menuUsesBottomSheet, computeMenuPosition]);

  useEffect(() => {
    if (!menuOpen) return;
    const tick = () => computeMenuPosition();
    tick();
    const raf = requestAnimationFrame(tick);

    const onReflow = () => computeMenuPosition();
    window.addEventListener("resize", onReflow);
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    vv?.addEventListener("resize", onReflow);
    vv?.addEventListener("scroll", onReflow);
    // captura scroll dentro do container de mensagens também
    document.addEventListener("scroll", onReflow, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onReflow);
      vv?.removeEventListener("resize", onReflow);
      vv?.removeEventListener("scroll", onReflow);
      document.removeEventListener("scroll", onReflow, true);
    };
  }, [menuOpen, computeMenuPosition]);

  const LONG_PRESS_MS = 480;
  const LONG_PRESS_MOVE_PX = 14;

  const clearLongPressTracking = useCallback(() => {
    if (longPressTimerRef.current != null) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    const rm = longPressCleanupRef.current;
    longPressCleanupRef.current = null;
    if (typeof rm === "function") rm();
  }, []);

  const onBubblePointerDown = useCallback(
    (e) => {
      if (!mobileMessageChrome || selectMode || menuOpen) return;
      if (e.button !== 0) return;
      const el = e.target;
      if (el && typeof el.closest === "function") {
        if (
          el.closest(
            ".wa-reactionBtn, .wa-reactionPicker, .wa-msgMenuBtn, .wa-selectChk, .wa-bubble-fileAction, .wa-audioPlayBtn, [role=\"slider\"]"
          )
        )
          return;
        // Media preview buttons (image/video thumbnails) must still allow long-press
        if (el.closest("button:not(.wa-bubble-imgLink):not(.wa-bubble-videoLink), a[href]")) return;
      }
      clearLongPressTracking();
      const x0 = e.clientX;
      const y0 = e.clientY;

      const onMove = (ev) => {
        if (
          Math.abs(ev.clientX - x0) > LONG_PRESS_MOVE_PX ||
          Math.abs(ev.clientY - y0) > LONG_PRESS_MOVE_PX
        ) {
          clearLongPressTracking();
        }
      };
      const onEnd = () => {
        clearLongPressTracking();
      };

      window.addEventListener("pointermove", onMove, { passive: true });
      window.addEventListener("pointerup", onEnd);
      window.addEventListener("pointercancel", onEnd);

      longPressCleanupRef.current = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onEnd);
        window.removeEventListener("pointercancel", onEnd);
      };

      longPressTimerRef.current = window.setTimeout(() => {
        longPressTimerRef.current = null;
        const rmListeners = longPressCleanupRef.current;
        longPressCleanupRef.current = null;
        if (typeof rmListeners === "function") rmListeners();
        try {
          if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(12);
        } catch (_) {}
        armSkipNextMediaTap();
        setMenuOpen(true);
      }, LONG_PRESS_MS);
    },
    [mobileMessageChrome, selectMode, menuOpen, clearLongPressTracking, armSkipNextMediaTap]
  );

  useEffect(() => () => {
    clearLongPressTracking();
    clearSkipNextMediaTap();
    if (mediaPointerOpenedTimerRef.current != null) {
      clearTimeout(mediaPointerOpenedTimerRef.current);
      mediaPointerOpenedTimerRef.current = null;
    }
  }, [clearLongPressTracking, clearSkipNextMediaTap]);

  useLayoutEffect(() => {
    const el = bubbleRef.current;
    if (!el) return;
    const onSelectStart = (ev) => ev.preventDefault();
    el.addEventListener("selectstart", onSelectStart);
    return () => el.removeEventListener("selectstart", onSelectStart);
  }, [msg?.id]);

  const handleToggleSelect = useCallback(
    (e) => {
      e?.preventDefault?.();
      e?.stopPropagation?.();
      onToggleSelected?.(msg);
    },
    [onToggleSelected, msg]
  );

  const handleMediaPointerDown = useCallback((e) => {
    if (e.pointerType !== "touch" && e.pointerType !== "pen") {
      mediaTapStartRef.current = null;
      return;
    }
    mediaTapStartRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const openMediaFromEvent = useCallback(
    (e, url, kind) => {
      if (selectMode) return;
      e?.stopPropagation?.();
      if (skipNextMediaTapRef.current) {
        clearSkipNextMediaTap();
        return;
      }
      onOpenMedia?.(url, kind);
    },
    [clearSkipNextMediaTap, onOpenMedia, selectMode]
  );

  const handleMediaPointerUp = useCallback(
    (e, url, kind) => {
      if (e.pointerType !== "touch" && e.pointerType !== "pen") return;
      if (selectMode) return;
      const start = mediaTapStartRef.current;
      mediaTapStartRef.current = null;
      if (!start) return;
      const moved =
        Math.abs(e.clientX - start.x) > 12 ||
        Math.abs(e.clientY - start.y) > 12;
      if (moved) return;
      e.preventDefault();
      mediaPointerOpenedRef.current = true;
      if (mediaPointerOpenedTimerRef.current != null) {
        clearTimeout(mediaPointerOpenedTimerRef.current);
      }
      mediaPointerOpenedTimerRef.current = window.setTimeout(() => {
        mediaPointerOpenedRef.current = false;
        mediaPointerOpenedTimerRef.current = null;
      }, 500);
      openMediaFromEvent(e, url, kind);
    },
    [openMediaFromEvent, selectMode]
  );

  const handleMediaClick = useCallback(
    (e, url, kind) => {
      if (mediaPointerOpenedRef.current) {
        mediaPointerOpenedRef.current = false;
        e?.stopPropagation?.();
        return;
      }
      openMediaFromEvent(e, url, kind);
    },
    [openMediaFromEvent]
  );

  const doCopy = useCallback(async () => {
    const text =
      safeString(msg?.texto) ||
      (mediaUrl ? `${msg?.nome_arquivo ? `${msg.nome_arquivo}\n` : ""}${mediaUrl}` : "");
    const ok = await copyTextToClipboard(text);
    onCopy?.(ok);
  }, [msg, mediaUrl, onCopy]);

  const runAction = useCallback(
    async (action) => {
      setMenuOpen(false);
      if (action === "info") onInfo?.(msg);
      if (action === "reply") onReply?.(msg);
      if (action === "copy") await doCopy();
      if (action === "forward") onForward?.(msg);
      if (action === "pin") onTogglePin?.(msg);
      if (action === "star") onToggleStar?.(msg);
      if (action === "select") onStartSelect?.(msg);
      if (action === "deleteForMe") onDeleteForMe?.(msg);
      if (action === "deleteForEveryone") onDeleteForEveryone?.(msg);
    },
    [msg, onInfo, onReply, doCopy, onForward, onTogglePin, onToggleStar, onStartSelect, onDeleteForMe, onDeleteForEveryone]
  );

  const reactionPicker = (mobileSelected = false, menuInline = false) => (
    <div
      className={`wa-reactionPicker${mobileSelected ? " wa-reactionPicker--selectedMobile" : ""}${
        menuInline ? " wa-reactionPicker--menuMobile" : ""
      }${
        reactionExpanded ? " isExpanded" : ""
      }`}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {reactionEmojiOptions.map((emo) => (
        <button
          key={emo}
          type="button"
          className="wa-reactionPicker-btn"
          disabled={reactionBusy || !!msg?.apagada_para_todos}
          onClick={() => {
            onReact?.(msg, emo);
            setReactionOpen(false);
            setReactionExpanded(false);
            if (menuInline) setMenuOpen(false);
          }}
          aria-label={`Reagir com ${emo}`}
        >
          {emo}
        </button>
      ))}
      {mobileSelected || menuInline ? (
        <button
          type="button"
          className="wa-reactionPicker-more"
          disabled={reactionBusy || !!msg?.apagada_para_todos}
          onClick={() => setReactionExpanded((v) => !v)}
          aria-label="Mais reações"
          aria-expanded={reactionExpanded}
        >
          +
        </button>
      ) : null}
      {localReaction ? (
        <button
          type="button"
          className="wa-reactionPicker-remove"
          disabled={reactionBusy || !!msg?.apagada_para_todos}
          onClick={() => {
            onRemoveReaction?.(msg);
            setReactionOpen(false);
            setReactionExpanded(false);
            if (menuInline) setMenuOpen(false);
          }}
        >
          Remover reação
        </button>
      ) : null}
    </div>
  );

  return (
      <div
        className={`wa-row ${out ? "wa-row-out" : "wa-row-in"}${localReaction ? " wa-row--hasReaction" : ""}${
          captionBundleTop ? " wa-row--captionBundleTop" : ""
        }${captionBundleFollow ? " wa-row--captionBundleFollow" : ""}${menuOpen ? " wa-row--menuOpen" : ""}`}
        data-msg-id={msg?.id}
        data-group-start={showRemetente && !out ? "1" : "0"}
      >
      {selectMode && !msg?.apagada_para_todos ? (
        <button
          type="button"
          className={`wa-selectChk ${selected ? "isOn" : ""}`}
          onClick={handleToggleSelect}
          title={selected ? "Desmarcar" : "Selecionar"}
          aria-label={selected ? "Desmarcar mensagem" : "Selecionar mensagem"}
        >
          {selected ? "✓" : ""}
        </button>
      ) : null}

      <SwipeReplyTrack
        enabled={Boolean(swipeReplyEnabled && !isCall && !msg?.apagada_para_todos)}
        outgoing={out}
        gestureBlocked={menuOpen || showReactionPicker || selectMode}
        onCommit={() => {
          setMenuOpen(false);
          setReactionOpen(false);
          setReactionExpanded(false);
          onReply?.(msg);
        }}
      >
      {showMobileReactionPicker && !isCall ? reactionPicker(true) : null}
      <div
        ref={(node) => {
          menuAnchorRef.current = node;
          bubbleRef.current = node;
        }}
        className={[
          "wa-bubble",
          zapAnimateIn ? "zap-message-enter" : "",
          out ? "wa-bubble-out" : "wa-bubble-in",
          hasInlineMetaClass ? "hasInlineMeta" : "",
          (isImg || isSticker) ? "wa-bubble-media" : "",
          isSticker ? "wa-bubble-sticker sticker-message" : "",
          isImg && !isSticker ? "image-message" : "",
          isFile ? "wa-bubble-fileWrap" : "",
          isContact ? "wa-bubble-contactWrap" : "",
          isLocation ? "wa-bubble-locationWrap" : "",
          isAudioOrVoice ? "wa-bubble-audio audio-message" : "",
          isVideo ? "wa-bubble-video" : "",
          selected ? "isSelected" : "",
          menuOpen ? "wa-bubble--menuOpen" : "",
          mobileMessageChrome ? "wa-bubble--mobileUx" : "",
          msg?.apagada_para_todos ? "wa-bubble--revokedEveryone" : "",
        ].filter(Boolean).join(" ")}
        onClick={selectMode && !msg?.apagada_para_todos ? handleToggleSelect : undefined}
        onPointerDown={mobileMessageChrome && !selectMode ? onBubblePointerDown : undefined}
        onContextMenu={mobileMessageChrome ? (ev) => ev.preventDefault() : undefined}
        role="group"
        aria-label="Mensagem"
      >
        {showMenuButton && !mobileMessageChrome ? (
          <button
            ref={menuBtnRef}
            type="button"
            className={`wa-msgMenuBtn wa-msgMenuBtn--top ${menuOpen ? "isOpen" : ""}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
            title="Mais opções"
            aria-label="Abrir opções da mensagem"
          >
            ▾
          </button>
        ) : null}
        <div className="wa-bubble-body">
          {/* Badge de mensagem encaminhada — acima de tudo */}
          {isEncaminhado && !isFile && !isContact && !isLocation ? (
            <div className="wa-bubble-fwd-badge">
              <svg className="wa-bubble-fwd-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="15 10 20 15 15 20" />
                <path d="M4 4v7a4 4 0 0 0 4 4h12" />
              </svg>
              <span>Encaminhado</span>
            </div>
          ) : null}
          {/* Citação (reply) — sempre no topo, antes de qualquer conteúdo */}
          {hasReply && (
            <div
              className={`wa-replyCtx ${out ? "isOut" : "isIn"}`}
              aria-label="Mensagem citada"
              role="button"
              tabIndex={0}
              title="Ver mensagem respondida"
              onClick={(e) => {
                e?.stopPropagation?.();
                const rid = replyMeta?.replyToId;
                if (rid && onJumpToReply) onJumpToReply(rid);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  const rid = replyMeta?.replyToId;
                  if (rid && onJumpToReply) onJumpToReply(rid);
                }
              }}
            >
              <div className="wa-replyCtx-bar" aria-hidden="true" />
              <div className="wa-replyCtx-content">
                {safeString(replyMeta.thumb) ? (
                  <img
                    src={replyMeta.thumb}
                    alt=""
                    className="wa-replyCtx-thumb"
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                  />
                ) : null}
                <div className="wa-replyCtx-textStack">
                  <div className="wa-replyCtx-name">
                    {replyMeta.name && replyMeta.name !== "Contato"
                      ? replyMeta.name
                      : (peerName || replyMeta.name)}
                  </div>
                  <div className="wa-replyCtx-snippet">{replySnippetDisplay(replyMeta)}</div>
                </div>
              </div>
            </div>
          )}
          {/* Nome do atendente acima da mensagem enviada pelo sistema (respeita mostrar_nome_ao_cliente) */}
          {out &&
          msg?.enviado_por_usuario &&
          !isApagadaParaTodos &&
          safeString(msg?.usuario_nome) &&
          mostrarNomeAoCliente ? (
            <div className="wa-bubble-atendente" aria-label={`Enviado por ${msg.usuario_nome}`}>
              {msg.usuario_nome}
            </div>
          ) : null}
          {remetente ? (
            <div className="wa-bubble-remetente">
              <span className="wa-bubble-remetente-nome">
                {remetente}:
              </span>
              {isImg || isSticker ? (
                <div className="wa-bubble-mediaStack">
                  <button
                    type="button"
                    className="wa-bubble-imgLink"
                    onPointerDown={handleMediaPointerDown}
                    onPointerUp={(e) => handleMediaPointerUp(e, mediaUrl, isSticker ? "figurinha" : "imagem")}
                    onClick={(e) => handleMediaClick(e, mediaUrl, isSticker ? "figurinha" : "imagem")}
                  >
                    <BubbleImage
                      msg={msg}
                      alt={isSticker ? "figurinha" : "imagem"}
                      className="wa-bubble-img"
                    />
                  </button>
                  {showCaption ? <div className="wa-bubble-caption">{renderTextWithLinks(texto)}</div> : null}
                </div>
              ) : isVideo ? (
                <div className="wa-bubble-mediaStack">
                  <button
                    type="button"
                    className="wa-bubble-videoLink"
                    onPointerDown={handleMediaPointerDown}
                    onPointerUp={(e) => handleMediaPointerUp(e, videoPlaybackUrl || mediaUrl, "video")}
                    onClick={(e) => handleMediaClick(e, videoPlaybackUrl || mediaUrl, "video")}
                  >
                    <video
                      src={videoPlaybackUrl || mediaUrl}
                      playsInline
                      preload="metadata"
                      className="wa-bubble-videoEl"
                    />
                  </button>
                  {showCaption ? <div className="wa-bubble-caption">{renderTextWithLinks(texto)}</div> : null}
                </div>
              ) : isFile ? (
                <FileBubbleContent
                  msg={msg}
                  mediaUrl={mediaUrl}
                  selectMode={selectMode}
                  onOpenMedia={onOpenMedia}
                  isGroup={isGroup}
                  out={out}
                />
              ) : isLocation ? (
                <LocationBubbleContent msg={msg} selectMode={selectMode} isGroup={isGroup} out={out} />
              ) : isContact ? (
                <ContactBubbleContent
                  msg={msg}
                  contactMeta={contactBubbleMeta}
                  selectMode={selectMode}
                  isGroup={isGroup}
                  out={out}
                  onConversar={onConversarContact}
                  onAdicionarGrupo={onAdicionarGrupoContact}
                />
              ) : hasText ? (
                inlineMeta ? (
                  <span className="wa-bubble-text wa-bubble-textInline">
                    {renderTextWithLinks(texto)}
                    <span className="wa-inlineMeta" aria-label="Horário e status">
                      <span className="wa-inlineTime">{formatHora(msg?.criado_em)}</span>
                      <MessageTicks msg={msg} isGroup={Boolean(isGroup)} />
                    </span>
                  </span>
                ) : (
                  <span className="wa-bubble-text">{renderTextWithLinks(texto)}</span>
                )
              ) : (
                <span className="wa-bubble-text wa-muted">{isGenericMessagePlaceholder ? fallbackContentLabel : "(mídia)"}</span>
              )}
            </div>
          ) : isImg || isSticker ? (
            <div className="wa-bubble-mediaStack">
              <button
                type="button"
                className="wa-bubble-imgLink"
                onPointerDown={handleMediaPointerDown}
                onPointerUp={(e) => handleMediaPointerUp(e, mediaUrl, isSticker ? "figurinha" : "imagem")}
                onClick={(e) => handleMediaClick(e, mediaUrl, isSticker ? "figurinha" : "imagem")}
              >
                <BubbleImage
                  msg={msg}
                  alt={isSticker ? "figurinha" : "imagem"}
                  className="wa-bubble-img"
                />
              </button>
              {showCaption ? <div className="wa-bubble-caption">{renderTextWithLinks(texto)}</div> : null}
            </div>
          ) : isVideo && mediaUrl ? (
            <div className="wa-bubble-mediaStack">
              <button
                type="button"
                className="wa-bubble-videoLink"
                onPointerDown={handleMediaPointerDown}
                onPointerUp={(e) => handleMediaPointerUp(e, videoPlaybackUrl || mediaUrl, "video")}
                onClick={(e) => handleMediaClick(e, videoPlaybackUrl || mediaUrl, "video")}
              >
                <video src={videoPlaybackUrl || mediaUrl} playsInline className="wa-bubble-videoEl" />
              </button>
              {showCaption ? <div className="wa-bubble-caption">{renderTextWithLinks(texto)}</div> : null}
            </div>
          ) : isAudioOrVoice && mediaUrl ? (
            <div className="wa-bubble-audioStack">
              <div className="wa-bubble-audioWrap">
                <AudioWavePlayer
                  candidates={audioPlaybackCandidates}
                  msgKey={msg?.whatsapp_id || msg?.id || msg?.tempId || audioPlaybackCandidates[0] || mediaUrl}
                  avatarUrl={!out ? peerAvatarUrl : null}
                  avatarLabel={!out ? peerName : null}
                  sentAtLabel={formatHora(msg?.criado_em)}
                  onDuration={(d) => {
                    setAudioDur(d);
                    if (msg?.id) {
                      try {
                        useConversaStore.getState().patchMensagem(msg.id, { audio_duracao_sec: d });
                      } catch {}
                    }
                  }}
                />
              </div>
              {showAudioText ? <div className="wa-bubble-audioCaption">{renderTextWithLinks(texto)}</div> : null}
            </div>
          ) : isFile ? (
            <FileBubbleContent
              msg={msg}
              mediaUrl={mediaUrl}
              selectMode={selectMode}
              onOpenMedia={onOpenMedia}
              isGroup={isGroup}
              out={out}
            />
          ) : isLocation ? (
            <LocationBubbleContent msg={msg} selectMode={selectMode} isGroup={isGroup} out={out} />
          ) : isContact ? (
            <ContactBubbleContent
              msg={msg}
              contactMeta={contactBubbleMeta}
              selectMode={selectMode}
              isGroup={isGroup}
              out={out}
              onConversar={onConversarContact}
              onAdicionarGrupo={onAdicionarGrupoContact}
            />
          ) : isCall ? (
            <div className="wa-callBubble">
              <div className="wa-callIcon" aria-hidden="true">📞</div>
              <div className="wa-callText">
                {texto || "Ligação via WhatsApp"}
              </div>
            </div>
          ) : hasText ? (
            inlineMeta ? (
              <span className="wa-bubble-text wa-bubble-textInline">
                {renderTextWithLinks(texto)}
                <span className="wa-inlineMeta" aria-label="Horário e status">
                  <span className="wa-inlineTime">{formatHora(msg?.criado_em)}</span>
                  <MessageTicks msg={msg} isGroup={Boolean(isGroup)} />
                </span>
              </span>
            ) : (
              <span className="wa-bubble-text">{renderTextWithLinks(texto)}</span>
            )
          ) : (
            <span className="wa-bubble-text wa-muted">{isGenericMessagePlaceholder ? fallbackContentLabel : "(mensagem vazia)"}</span>
          )}
        </div>
        {!isCall && !mobileMessageChrome ? (
          <button
            type="button"
            className={`wa-reactionBtn ${reactionOpen ? "isOpen" : ""}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setReactionOpen((v) => !v);
              setReactionExpanded(false);
            }}
            title="Reagir"
            aria-label="Reagir à mensagem"
            disabled={reactionBusy || !!msg?.apagada_para_todos}
          >
            <IconEmoji style={{ width: 12, height: 12 }} />
          </button>
        ) : null}
        <div className="wa-bubble-meta">
          <div className="wa-bubble-metaLeft">
            {showFloatingMetaTime ? (
              <>
                {!(isAudioOrVoice && mediaUrl) ? (
                  <span className="wa-bubble-time">{formatHora(msg?.criado_em)}</span>
                ) : null}
                <MessageTicks msg={msg} isGroup={Boolean(isGroup)} />
              </>
            ) : null}
            {isPinned ? <span className="wa-bubble-badge" title="Fixada">📌</span> : null}
            {isStarred ? <span className="wa-bubble-badge" title="Favorita">★</span> : null}
          </div>
        </div>

        {reactionOpen && !isCall ? reactionPicker(false) : null}

        {localReaction ? (
          <div className="wa-bubble-reaction" aria-label={`Sua reação: ${localReaction}`}>
            {localReaction}
          </div>
        ) : null}
      </div>
      </SwipeReplyTrack>

      {menuOpen
        ? createPortal(
            <>
              <div
                className={`wa-msgMenuBackdrop${menuUsesBottomSheet ? " wa-msgMenuBackdrop--sheet" : ""}`}
                aria-hidden="true"
                onPointerDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  e.preventDefault();
                  setMenuOpen(false);
                }}
              />
              <div
                ref={menuElRef}
                className={`wa-msgMenu${menuUsesBottomSheet ? " wa-msgMenu--sheet" : ""}`}
                style={menuStyle || { position: "fixed", top: -9999, left: -9999 }}
                role="menu"
                aria-label="Opções da mensagem"
                onMouseDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
              >
              {mobileMessageChrome && !isCall && !msg?.apagada_para_todos ? (
                <>
                  {reactionPicker(false, true)}
                  <div className="wa-msgMenuSep" aria-hidden="true" />
                </>
              ) : null}
              {out ? (
                <>
                  <button type="button" className="wa-msgMenuItem" onClick={() => runAction("info")} role="menuitem">
                    Dados da mensagem
                  </button>
                  <div className="wa-msgMenuSep" aria-hidden="true" />
                </>
              ) : null}
              {!msg?.apagada_para_todos ? (
                <button type="button" className="wa-msgMenuItem" onClick={() => runAction("reply")} role="menuitem">
                  Responder
                </button>
              ) : null}
              <button type="button" className="wa-msgMenuItem" onClick={() => runAction("copy")} role="menuitem">
                Copiar
              </button>
              {!msg?.apagada_para_todos ? (
                <>
                  <button type="button" className="wa-msgMenuItem" onClick={() => runAction("forward")} role="menuitem">
                    Encaminhar
                  </button>
                  <button type="button" className="wa-msgMenuItem" onClick={() => runAction("pin")} role="menuitem">
                    {isPinned ? "Desafixar" : "Fixar"}
                  </button>
                  <button type="button" className="wa-msgMenuItem" onClick={() => runAction("star")} role="menuitem">
                    {isStarred ? "Desfavoritar" : "Favoritar"}
                  </button>
                  <button type="button" className="wa-msgMenuItem" onClick={() => runAction("select")} role="menuitem">
                    Selecionar
                  </button>
                </>
              ) : null}
              <div className="wa-msgMenuSep" aria-hidden="true" />
              <button
                type="button"
                className="wa-msgMenuItem"
                onClick={() => runAction("deleteForMe")}
                role="menuitem"
              >
                Apagar para mim
              </button>
              {canDeleteForEveryone ? (
                <button
                  type="button"
                  className="wa-msgMenuItem wa-msgMenuItemDanger"
                  onClick={() => runAction("deleteForEveryone")}
                  role="menuitem"
                >
                  Apagar para todos
                </button>
              ) : null}
              </div>
            </>,
            document.body
          )
        : null}
    </div>
  );
});
export default Bubble;
