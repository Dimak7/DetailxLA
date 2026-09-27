import Image from "next/image";
import { ceramicFilm, ceramicFilmPoster } from "@/lib/site-media";
import styles from "./CeramicFilm.module.css";
export function CeramicFilm() {
  return <figure className={styles.figure}><div className={styles.frame}>
    {ceramicFilm ? <video controls playsInline preload="none" poster={ceramicFilmPoster} aria-label="The West Loop Ceramics coating process"><source src={ceramicFilm.src} />{ceramicFilm.captions && <track kind="captions" src={ceramicFilm.captions} srcLang="en" label="English" default />}Your browser cannot play this film. <a href={ceramicFilm.src}>Open the ceramic coating film</a>.</video> : <Image src={ceramicFilmPoster} alt="Illustration of ceramic coating being carefully applied to graphite Porsche paint" fill sizes="(max-width: 760px) 100vw, 58vw" />}
    {!ceramicFilm && <span className={styles.label}>THE ART OF SURFACE PREPARATION</span>}
  </div><figcaption>{ceramicFilm ? "A closer look at the ceramic coating process." : "A closer look at the process. Ceramic application illustration."}</figcaption></figure>;
}
