"use client";
import { useEffect, useRef, type ReactNode, type CSSProperties } from "react";
import { X, ArrowLeft, ArrowUpRight, Check, Circle, AlertTriangle } from "lucide-react";
import { HOME_META } from "@/lib/data";
import type { Home, Person } from "@/lib/types";

export function Avatar({ person, large = false }: { person: Person; large?: boolean }) {
  return <span className={`avatar avatar-${person.avatar} ${large ? "avatar-large" : ""}`} aria-hidden="true"><span>{person.initials}</span></span>;
}
export function HomeBadge({ home }: { home: Home }) { return <span className="home-badge" style={{ "--home": HOME_META[home].color } as CSSProperties}><span>{HOME_META[home].glyph}</span>{home}</span>; }
export function Status({ type, children }: { type?: "good" | "warning" | "blocked" | "muted"; children: ReactNode }) {
  const Icon = type === "good" ? Check : type === "blocked" ? AlertTriangle : Circle;
  return <span className={`status status-${type || "muted"}`}><Icon size={11} />{children}</span>;
}
export function Modal({ title, eyebrow, children, onClose, onBack, className = "", wide = false, fullscreen = false }: { title: string; eyebrow?: string; children: ReactNode; onClose: () => void; onBack?: () => void; className?: string; wide?: boolean; fullscreen?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    el?.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { el?.close(); document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  return <dialog ref={ref} className={`modal ${wide ? "modal-wide" : ""} ${fullscreen ? "modal-full" : ""} ${className}`} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target !== event.currentTarget) return; const bounds = event.currentTarget.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose(); }} aria-labelledby="modal-title">
    <div className="modal-inner"><header className="modal-header">{onBack && <button className="icon-button modal-back" onClick={onBack} aria-label="Back to previous view"><ArrowLeft size={19}/></button>}<div className="modal-heading">{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h2 id="modal-title">{title}</h2></div><button className="icon-button close-button" onClick={onClose} aria-label="Close dialog"><X size={20} /></button></header>{children}</div>
  </dialog>;
}
export function EmptyState({ title, detail, onReset }: { title: string; detail: string; onReset?: () => void }) { return <div className="empty-state"><span className="empty-orbit">◎</span><h3>{title}</h3><p>{detail}</p>{onReset && <button className="button button-secondary" onClick={onReset}>Reset filters <ArrowUpRight size={16} /></button>}</div>; }

export function OrbitVisual({ percent }: { percent: number }) {
  return <div className="orbit-scene" aria-label={`${percent}% confirmed funded capacity in the selected horizon`}>
    <div className="orbit-grid" />
    <svg className="orbit-svg" viewBox="0 0 440 260" aria-hidden="true">
      <defs><linearGradient id="orbit-gradient"><stop stopColor="#ff593c" /><stop offset="1" stopColor="#f04124" /></linearGradient></defs>
      <g fill="none" transform="translate(230 130)">
        <ellipse rx="190" ry="71" transform="rotate(-25)" stroke="currentColor" strokeWidth=".7" className="orbit-line" />
        <ellipse rx="152" ry="98" transform="rotate(30)" stroke="currentColor" strokeWidth=".7" className="orbit-line" />
        <circle r="88" stroke="currentColor" strokeWidth="1" className="orbit-line" strokeDasharray="2 7" />
        <circle r="69" stroke="currentColor" strokeWidth="11" className="orbit-track" />
        <circle r="69" stroke="url(#orbit-gradient)" strokeWidth="11" pathLength="100" strokeDasharray={`${percent} ${100 - percent}`} strokeLinecap="round" transform="rotate(-90)" className="coverage-ring" />
        <circle r="53" stroke="currentColor" strokeWidth=".5" className="orbit-line" />
      </g>
      <circle cx="83" cy="116" r="7" fill="#315be3"/><circle cx="83" cy="116" r="13" fill="#315be3" opacity=".08"/>
      <circle cx="365" cy="151" r="5" fill="#8150bc"/><circle cx="152" cy="209" r="4" fill="#ed593b"/>
      <path d="M63 57h40m-20-20v40M370 205h16m-8-8v16" stroke="currentColor" opacity=".25" />
    </svg>
    <div className="orbit-value"><strong>{percent}<span>%</span></strong><span>FUNDED COVERAGE</span></div>
    <div className="orbit-label orbit-label-top"><span className="live-dot" /> PEOPLE IN MOTION</div>
    <div className="orbit-label orbit-label-bottom"><span className="orbit-tiny-symbol">↳</span> Every ending. A new beginning.</div>
  </div>;
}
