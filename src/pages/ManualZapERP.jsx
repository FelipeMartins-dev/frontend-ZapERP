import { useState, useEffect, useRef, useCallback } from "react";
import "./ManualZapERP.css";
import { SECTIONS, GROUPS } from "./manual/manualSections";
import { ManualContent } from "./manual/ManualContent";

export default function ManualZapERP() {
  const [activeSection, setActiveSection] = useState("objetivo");
  const [searchQuery, setSearchQuery] = useState("");
  const [showBackTop, setShowBackTop] = useState(false);
  const contentRef = useRef(null);
  const sectionRefs = useRef({});

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    const onScroll = () => {
      setShowBackTop(el.scrollTop > 300);
      let current = SECTIONS[0].id;
      for (const { id } of SECTIONS) {
        const ref = sectionRefs.current[id];
        if (ref && ref.getBoundingClientRect().top < 140) current = id;
      }
      setActiveSection(current);
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const scrollToSection = useCallback((id) => {
    const el = sectionRefs.current[id];
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    setActiveSection(id);
  }, []);

  const filteredSections = SECTIONS.filter(
    (s) =>
      !searchQuery ||
      s.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.group.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const groupedSections = GROUPS.map((g) => ({
    group: g,
    items: filteredSections.filter((s) => s.group === g),
  })).filter((g) => g.items.length > 0);

  function setSectionRef(id) {
    return (el) => { sectionRefs.current[id] = el; };
  }

  return (
    <div className="manual-root">
      <nav className="manual-nav">
        <div className="manual-nav-header">
          <div className="manual-nav-logo">
            <div className="manual-nav-logo-icon">📖</div>
            <div>
              <div className="manual-nav-logo-text">Manual ZapERP</div>
              <div className="manual-nav-subtitle">Guia completo do atendente</div>
            </div>
          </div>
        </div>
        <div className="manual-nav-search">
          <input
            type="search"
            placeholder="Buscar no manual…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="manual-nav-list">
          {groupedSections.map(({ group, items }) => (
            <div key={group} className="manual-nav-section">
              <div className="manual-nav-section-label">{group}</div>
              {items.map((s) => (
                <button
                  key={s.id}
                  className={`manual-nav-item${activeSection === s.id ? " active" : ""}`}
                  onClick={() => scrollToSection(s.id)}
                  type="button"
                >
                  <span className="manual-nav-item-icon">{s.icon}</span>
                  {s.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      </nav>

      <div className="manual-content" ref={contentRef}>
        <div className="manual-hero">
          <div className="manual-hero-badge">📖 Manual do Atendente · Versão 2026</div>
          <h1 className="manual-hero-title">Manual Completo do ZapERP</h1>
          <p className="manual-hero-desc">
            Guia oficial para atendentes — do login ao encerramento do atendimento,
            com filtros, status, boas práticas, checklists e solução de problemas.
          </p>
          <div className="manual-hero-chips">
            <span className="manual-hero-chip">🎯 Objetivo</span>
            <span className="manual-hero-chip">🔍 Filtros</span>
            <span className="manual-hero-chip">✅ Assumir</span>
            <span className="manual-hero-chip">🏷️ Tags</span>
            <span className="manual-hero-chip">✖️ Finalizar</span>
            <span className="manual-hero-chip">☑️ Checklist</span>
          </div>
        </div>

        <div className="manual-body">
          <ManualContent setSectionRef={setSectionRef} />
        </div>
      </div>

      {showBackTop && (
        <button
          className="manual-back-top"
          onClick={() => contentRef.current?.scrollTo({ top: 0, behavior: "smooth" })}
          title="Voltar ao topo"
          type="button"
          aria-label="Voltar ao topo"
        >
          ↑
        </button>
      )}
    </div>
  );
}
