#!/usr/bin/env node
/**
 * Smoke test autenticado da API (backend local ou staging).
 * Uso:
 *   ZAPERP_API_URL=http://localhost:5000 ZAPERP_TEST_EMAIL=... ZAPERP_TEST_PASSWORD=... node scripts/api-smoke.mjs
 */
import axios from "axios";
import { io } from "socket.io-client";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const base = (process.env.ZAPERP_API_URL || "http://localhost:5000").replace(/\/$/, "");
const email = process.env.ZAPERP_TEST_EMAIL || "e2e-audit@zaperp.local";
const password = process.env.ZAPERP_TEST_PASSWORD || "E2eAudit2026!";

const results = [];

function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  const invalid = await axios.post(`${base}/usuarios/login`, { email: "x@y.com", senha: "wrong" }, { validateStatus: () => true });
  record("login_invalido_401", invalid.status === 401, String(invalid.status));

  const noToken = await axios.get(`${base}/chats`, { validateStatus: () => true });
  record("rotas_protegidas_401", noToken.status === 401, String(noToken.status));

  const login = await axios.post(`${base}/usuarios/login`, { email, senha: password }, { validateStatus: () => true });
  record("login_valido", login.status === 200 && !!login.data?.token, String(login.status));
  if (!login.data?.token) {
    printSummary();
    process.exit(1);
  }

  const token = login.data.token;
  const headers = { Authorization: `Bearer ${token}` };

  const me = await axios.get(`${base}/usuarios/me`, { headers, validateStatus: () => true });
  record("usuarios_me", me.status === 200, me.data?.email);

  const counts = await axios.get(`${base}/chats/counts`, { headers, validateStatus: () => true });
  record("chats_counts", counts.status === 200, `total=${counts.data?.total ?? "?"}`);

  const chats = await axios.get(`${base}/chats`, { headers, params: { limit: 10 }, validateStatus: () => true });
  const list = Array.isArray(chats.data) ? chats.data : chats.data?.chats || [];
  record("chats_lista", chats.status === 200 && list.length >= 0, `items=${list.length}`);

  let cid = list[0]?.id;
  if (cid) {
    const detail = await axios.get(`${base}/chats/${cid}`, { headers, validateStatus: () => true });
    const msgs = detail.data?.mensagens || [];
    record("chat_mensagens", detail.status === 200, `msgs=${msgs.length}`);

    const assumir = await axios.post(`${base}/chats/${cid}/assumir`, {}, { headers, validateStatus: () => true });
    if (assumir.status !== 200) {
      const alt = list.find((c) => !c.atendente_id) || list[1];
      if (alt?.id) {
        cid = alt.id;
        await axios.post(`${base}/chats/${cid}/assumir`, {}, { headers, validateStatus: () => true });
      }
    }

    const text = `[E2E-API] ${Date.now()}`;
    const sent = await axios.post(`${base}/chats/${cid}/mensagens`, { texto: text }, { headers, validateStatus: () => true });
    record("enviar_texto", sent.status === 200, `status=${sent.status}`);

    const after = await axios.get(`${base}/chats/${cid}`, { headers, validateStatus: () => true });
    const found = (after.data?.mensagens || []).some((m) => String(m.texto || "").includes("[E2E-API]"));
    record("mensagem_persiste", found);

    let wsNova = false;
    await new Promise((resolve) => {
      const s = io(base, { auth: { token }, transports: ["websocket"], timeout: 8000 });
      const timer = setTimeout(() => {
        s.disconnect();
        resolve();
      }, 10_000);
      s.on("connect", () => s.emit("join_conversa", cid));
      s.on("nova_mensagem", (p) => {
        if (String(p?.conversa_id || p?.chat_id) === String(cid)) wsNova = true;
      });
      setTimeout(async () => {
        await axios.post(`${base}/chats/${cid}/mensagens`, { texto: `[E2E-WS-API] ${Date.now()}` }, { headers });
      }, 800);
      setTimeout(() => {
        clearTimeout(timer);
        s.disconnect();
        resolve();
      }, 9000);
    });
    record("websocket_nova_mensagem", wsNova);

    const logoPath = path.join(__dirname, "..", "public", "brand", "logo-base.png");
    if (fs.existsSync(logoPath)) {
      const buf = fs.readFileSync(logoPath);
      const form = new FormData();
      form.append("file", new Blob([buf], { type: "image/png" }), "e2e-logo.png");
      form.append("caption", `[E2E-IMG] ${Date.now()}`);
      const upload = await fetch(`${base}/chats/${cid}/arquivo`, {
        method: "POST",
        headers: { Authorization: headers.Authorization },
        body: form,
      });
      record("enviar_imagem", upload.status === 200 || upload.status === 201, `status=${upload.status}`);
      const afterImg = await axios.get(`${base}/chats/${cid}`, { headers, validateStatus: () => true });
      const imgs = (afterImg.data?.mensagens || []).filter((m) =>
        String(m.tipo || "").toLowerCase().includes("imagem") || String(m.tipo || "").toLowerCase().includes("image")
      );
      record("imagem_na_thread", imgs.length > 0, `imagens=${imgs.length}`);
    } else {
      record("enviar_imagem", false, "logo-base.png ausente");
    }
  } else {
    record("chat_abrir", false, "sem conversas");
  }

  const alerta = await axios.get(`${base}/config/alerta-sem-resposta`, { headers, validateStatus: () => true });
  record("config_alerta_sem_resposta", alerta.status === 200, `ativo=${alerta.data?.alerta_sem_resposta_ativo}`);

  printSummary();
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}

function printSummary() {
  const failed = results.filter((r) => !r.ok);
  console.log("\n--- RESUMO ---");
  console.log(`Total: ${results.length} | OK: ${results.length - failed.length} | FAIL: ${failed.length}`);
  if (failed.length) {
    console.log("Falhas:", failed.map((f) => f.name).join(", "));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
