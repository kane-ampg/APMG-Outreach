"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ExternalLink, Mail, MapPin, Star, X } from "lucide-react";
import { useFocusTrap } from "@/lib/useFocusTrap";
import type { LeadView } from "./LeadsTable";

const SOCIAL_FIELDS: Array<{ key: "facebook" | "instagram" | "twitter"; label: string }> = [
  { key: "facebook", label: "Facebook" },
  { key: "instagram", label: "Instagram" },
  { key: "twitter", label: "Twitter / X" },
];

function fmtWhen(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

/** Centered modal showing every stored field for one lead (Supabase data). */
export function LeadDetail({ lead, onClose }: { lead: LeadView; onClose: () => void }) {
  const reduce = !!useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(true, ref);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const emails = lead.emails ?? [];
  const extraSocials = (lead.social_medias ?? []).filter(
    (u) => ![lead.facebook, lead.instagram, lead.twitter].includes(u),
  );
  const hasRating = lead.rating != null && lead.rating !== "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
        initial={reduce ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: reduce ? 0 : 0.18 }}
      />
      <motion.div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={`Lead details: ${lead.name}`}
        tabIndex={-1}
        initial={reduce ? false : { opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: reduce ? 0 : 0.22, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl outline-none"
      >
        {/* header */}
        <div className="flex items-start gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Lead detail
            </div>
            <h2 className="mt-1 text-base font-semibold leading-snug tracking-tight text-foreground">
              {lead.name}
            </h2>
            {lead.address && (
              <p className="mt-1 flex items-center gap-1.5 text-[13px] text-muted-foreground">
                <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="min-w-0 truncate">{lead.address}</span>
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close details"
            data-track="lead_detail_close"
            className="-mr-1.5 -mt-1 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {/* body */}
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-5">
          {lead.featured_image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={lead.featured_image}
              alt={`${lead.name} preview`}
              className="h-44 w-full rounded-xl border border-border object-cover"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          )}

          {/* key facts */}
          <div className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
            <Fact label="Website" full>
              {lead.website ? <Link href={lead.website} /> : <Dash />}
            </Fact>
            <Fact label="Phone">
              {lead.phone ? (
                <span className="tnum font-sans text-[14px] text-foreground">{lead.phone}</span>
              ) : (
                <Dash />
              )}
            </Fact>
            <Fact label="Rating">
              {hasRating ? (
                <span className="inline-flex items-center gap-1.5 text-[14px] text-foreground">
                  <Star className="h-4 w-4 fill-primary text-primary" aria-hidden />
                  <span className="tnum">{lead.rating}</span>
                </span>
              ) : (
                <Dash />
              )}
            </Fact>
            <Fact label="Category">
              {lead.category ? (
                <span className="text-[13.5px] text-foreground">{lead.category}</span>
              ) : (
                <Dash />
              )}
            </Fact>
            <Fact label="Folder">
              <span className="text-[13.5px] text-foreground">
                {lead.batch && lead.batch !== "__ungrouped__" ? lead.batch : "Ungrouped"}
              </span>
            </Fact>
            <Fact label="Imported">
              <span className="text-[13.5px] text-foreground">{fmtWhen(lead.created_at)}</span>
            </Fact>
          </div>

          <Section title={`Emails${emails.length ? ` · ${emails.length}` : ""}`}>
            {emails.length > 0 ? (
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {emails.map((email) => (
                  <li key={email}>
                    <a
                      href={`mailto:${email}`}
                      data-track="lead_email"
                      className="group inline-flex w-full items-center gap-2 rounded-lg border border-border bg-background/40 px-2.5 py-1.5 text-[12.5px] text-foreground transition-colors hover:border-primary/40"
                    >
                      <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-primary" aria-hidden />
                      <span className="min-w-0 truncate">{email}</span>
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <Dash />
            )}
          </Section>

          <Section title="Social">
            <div className="flex flex-col gap-2.5">
              {SOCIAL_FIELDS.map(({ key, label }) => (
                <Row key={key} label={label}>
                  {lead[key] ? <Link href={lead[key]!} /> : <Dash />}
                </Row>
              ))}
              {extraSocials.map((u, i) => (
                <Row key={u} label={i === 0 ? "Other" : ""}>
                  <Link href={u} />
                </Row>
              ))}
            </div>
          </Section>

          <Section title="Source">
            <div className="flex flex-col gap-2.5">
              <Row label="Bing Maps">
                {lead.bing_maps_url ? <Link href={lead.bing_maps_url} /> : <Dash />}
              </Row>
              {lead.id && (
                <Row label="Record ID">
                  <span className="break-all font-mono text-[11px] text-muted-foreground">{lead.id}</span>
                </Row>
              )}
            </div>
          </Section>
        </div>
      </motion.div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h3 className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

/** Stacked label/value cell for the key-facts grid. */
function Fact({ label, children, full }: { label: string; children: ReactNode; full?: boolean }) {
  return (
    <div className={full ? "sm:col-span-2" : undefined}>
      <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">{label}</div>
      <div className="mt-1 min-w-0">{children}</div>
    </div>
  );
}

/** Inline label/value row for list-y sections (social, source). */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[96px_1fr] items-baseline gap-3">
      <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Link({ href }: { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      data-track="lead_detail_link"
      className="inline-flex min-w-0 max-w-full items-center gap-1.5 text-[12.5px] text-primary hover:underline"
    >
      <span className="truncate">{href.replace(/^https?:\/\//, "")}</span>
      <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
    </a>
  );
}

function Dash() {
  return <span className="text-[13.5px] text-muted-foreground/50">—</span>;
}
