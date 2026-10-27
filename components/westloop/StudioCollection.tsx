import type { ReactNode } from "react";
import styles from "./StudioCollection.module.css";

export type StudioCard = {
  id: string;
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  mark?: string;
  facts?: { label: string; value: ReactNode }[];
  content?: ReactNode;
  actions?: ReactNode;
};

export function StudioCollection({ cards, kind = "people", empty = "Nothing here yet" }: { cards: StudioCard[]; kind?: "people" | "services" | "stock" | "leads"; empty?: string }) {
  if (!cards.length) return <div className={styles.empty}><span aria-hidden="true">◇</span><h2>{empty}</h2><p>Try another filter or add your first record.</p></div>;
  return <div className={`${styles.collection} ${styles[kind]}`}>{cards.map(card => <article className={styles.card} key={card.id}>
    <div className={styles.top}><span className={styles.avatar} aria-hidden="true">{card.mark || card.title.split(/\s+/).filter(Boolean).slice(0,2).map(word => word[0]).join("")}</span><div className={styles.identity}><h2>{card.title}</h2>{card.subtitle && <p>{card.subtitle}</p>}</div>{card.badge && <div className={styles.badge}>{card.badge}</div>}</div>
    {card.facts && <dl className={styles.facts}>{card.facts.map(fact => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>}
    {card.content && <div className={styles.content}>{card.content}</div>}
    {card.actions && <div className={styles.actions}>{card.actions}</div>}
  </article>)}</div>;
}

export function StudioSnapshot({ items }: { items: { label: string; value: ReactNode; detail?: string }[] }) {
  return <div className={styles.snapshot}>{items.map(item => <div key={item.label}><span>{item.label}</span><strong>{item.value}</strong>{item.detail && <small>{item.detail}</small>}</div>)}</div>;
}
