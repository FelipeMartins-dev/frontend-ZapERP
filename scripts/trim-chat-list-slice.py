from pathlib import Path

root = Path(__file__).resolve().parents[1]
path = root / "src" / "chats" / "chatList.jsx"
lines = path.read_text(encoding="utf-8").splitlines(keepends=True)

start = next(i for i, l in enumerate(lines) if "const audioDurationCache" in l)
end = next(i for i, l in enumerate(lines) if "Linhas da lista" in l and "isolado" in l)

new_lines = lines[:start] + lines[end:]
path.write_text("".join(new_lines), encoding="utf-8")
print(f"Removed lines {start+1}-{end}, new count {len(new_lines)}")
