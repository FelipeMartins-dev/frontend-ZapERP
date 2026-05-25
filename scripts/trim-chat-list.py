from pathlib import Path

root = Path(__file__).resolve().parents[1]
path = root / "src" / "chats" / "chatList.jsx"
lines = path.read_text(encoding="utf-8").splitlines(keepends=True)

# Remove COMPONENTES block through MemoChatRow comparator
start = next(i for i, l in enumerate(lines) if "const audioDurationCache" in l)
end = next(i for i, l in enumerate(lines) if "Linhas da lista" in l and "isolado" in l)
lines = lines[:start] + lines[end:]

# Remove rowPrefs (first occurrence after CHAT_ROW_TOUCH_MOVE_PX)
def remove_function_block(text_lines, start_pattern, end_patterns):
    """Remove from line matching start_pattern until next top-level function/const at col 0."""
    out = []
    i = 0
    while i < len(text_lines):
        line = text_lines[i]
        if start_pattern(line):
            i += 1
            while i < len(text_lines):
                nxt = text_lines[i]
                if nxt.startswith("function ") or nxt.startswith("const ") or nxt.startswith("export function"):
                    if not any(start_pattern(nxt) for _ in [0]):
                        break
                if nxt.startswith("/*") and "COMPONENTES" in nxt:
                    break
                i += 1
            continue
        out.append(line)
        i += 1
    return out

# Simpler: line-based removals by known markers
out = []
skip = False
for i, line in enumerate(lines):
    if line.startswith("function rowPrefs"):
        skip = True
        continue
    if skip and line.startswith("function mergeMinhaFilaPrefsFromChats"):
        skip = False
    if skip:
        continue
    if line.startswith("function isConversaAguardandoCliente"):
        skip = True
        continue
    if skip and line.startswith("function isConversaEmAtendimentoBadge"):
        continue
    if skip and line.startswith("const EMPTY_PENDENTES_SET"):
        continue
    if skip and (line.startswith("function isConversaAguardandoFuncionario") or line.startswith("function atendimentoRowVisualClass") or line.startswith("function isEmAtendimentoUltimaDoCliente")):
        continue
    if skip and line.startswith("/**"):
        if "Modo admin" in line or "Inclui só" in lines[i + 1] if i + 1 < len(lines) else "":
            skip = False
        continue
    if skip and line.startswith("function conversaMatchesAdminAtendenteFilter"):
        skip = False
    if skip:
        continue
    if "function getLastMessage" in line:
        skip = True
        continue
    if skip and line.startswith("function getMediaUrl"):
        skip = False
    if skip and line.startswith("function normalizeDirection"):
        continue
    if skip and line.startswith("function esperaMinutosAnchorKey"):
        continue
    if skip and line.startswith("function getEsperaMinutosAnchorIso"):
        continue
    if skip and line.startswith("function getListaUltimaMensagemCriadoEm"):
        continue
    if skip and line.startswith("function getLastDirection"):
        continue
    if skip:
        continue
    if line.startswith("function chatRowLastPreviewKey") or line.startswith("function chatRowContactSurfaceKey"):
        skip = True
        continue
    if skip and line.startswith("function TagMini"):
        skip = False
    if skip:
        continue
    if "NORMALIZAÇÃO DE CONTATO" in line or "export function getDisplayName" in line:
        skip = True
        continue
    if skip and line.startswith("function TagMini"):
        skip = False
    if skip and line.startswith("function getAvatarColor"):
        skip = False
    if skip:
        continue
    out.append(line)

text = "".join(out)
path.write_text(text, encoding="utf-8")
print(f"chatList.jsx -> {len(out)} lines")
