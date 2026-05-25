import re
from pathlib import Path

root = Path(__file__).resolve().parents[1]
chat_list = root / "src" / "chats" / "chatList.jsx"
lines = chat_list.read_text(encoding="utf-8").splitlines(keepends=True)

start = next(i for i, l in enumerate(lines) if "const audioDurationCache" in l)
end = next(i for i, l in enumerate(lines) if "Linhas da lista" in l and "isolado" in l)
body = lines[start:end]

header = """import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getApiBaseUrl } from "../api/baseUrl";
import {
  isGroupConversation,
  getStatusAtendimentoEffective,
  isAguardandoClienteManual,
  isVCardText,
  parseVCardMeta,
} from "../utils/conversaUtils";
import ConversationActionMenuTrigger from "./ConversationActionMenuTrigger";
import { getContactDisplay } from "./chatListDisplay";
import {
  rowPrefs,
  EMPTY_PENDENTES_SET,
  getLastMessage,
  getEsperaMinutosAnchorIso,
  isConversaAguardandoFuncionario,
  atendimentoRowVisualClass,
  isEmAtendimentoUltimaDoCliente,
} from "./chatListRowAtendimento";
import { chatRowPropsAreEqual } from "./chatListRowCompare";

export const CHAT_ROW_TOUCH_MOVE_PX = 12;

"""

out_lines = []
skip = False
for line in body:
    if "const CHAT_ROW_TOUCH_MOVE_PX" in line:
        continue
    if "NORMALIZAÇÃO DE CONTATO" in line or "NORMALIZACAO DE CONTATO" in line:
        skip = True
        continue
    if skip and line.startswith("function TagMini"):
        skip = False
    if skip:
        continue
    if line.startswith("function chatRowLastPreviewKey") or line.startswith("function chatRowContactSurfaceKey"):
        skip = True
        continue
    if skip and line.startswith("function TagMini"):
        skip = False
    if skip:
        continue
    out_lines.append(line)

content = header + "".join(out_lines)
content = re.sub(
    r"const MemoChatRow = memo\(ChatRow, \(prev, next\) => \{.*?\}\);\n",
    "const MemoChatRow = memo(ChatRow, chatRowPropsAreEqual);\n\nexport default MemoChatRow;\n",
    content,
    flags=re.S,
)

out_path = root / "src" / "chats" / "ChatListRow.jsx"
out_path.write_text(content, encoding="utf-8")
print(f"Wrote {out_path} ({len(content.splitlines())} lines)")
