import Link from 'next/link';
import { ArrowLeft, Compass } from 'lucide-react';
import styles from './NotFound.module.css';

export default function NotFound() {
  return (
    <main className={styles.page}>
      <title>ไม่พบหน้า | VETRA Marketing</title>
      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="VETRA Marketing — กลับสู่พื้นที่ทำงาน">
          <span className={styles.brandMark} aria-hidden="true">
            V
          </span>
          <span>
            <strong lang="en">VETRA</strong>
            <span lang="en">MARKETING</span>
          </span>
        </Link>
      </header>

      <section className={styles.content} aria-labelledby="not-found-title">
        <div className={styles.illustration} aria-hidden="true">
          <div className={styles.orbit} />
          <div className={styles.icon}>
            <Compass strokeWidth={1.25} />
          </div>
          <span className={styles.orbitPoint} />
        </div>
        <span className={styles.tag} lang="en">
          404 <span aria-hidden="true">/</span> PAGE NOT FOUND
        </span>
        <h1 id="not-found-title">ไม่พบหน้าที่คุณกำลังมองหา</h1>
        <p className={styles.englishTitle} lang="en">
          We couldn’t find this page.
        </p>
        <div className={styles.description}>
          <p>หน้านี้อาจถูกย้ายหรือไม่มีอยู่แล้ว กลับไปดูพื้นที่ทำงานของคุณได้เลย</p>
          <p lang="en">
            This page may have moved or no longer exists. Your next good idea is waiting in your
            workspace.
          </p>
        </div>
        <Link className={styles.backLink} href="/">
          <ArrowLeft size={20} aria-hidden="true" />
          <span>
            <strong>กลับสู่พื้นที่ทำงาน</strong>
            <span lang="en">Back to workspace</span>
          </span>
        </Link>
      </section>

      <footer className={styles.footer} lang="en">
        VETRA Marketing <span aria-hidden="true">·</span> A clearer view of every post.
      </footer>
    </main>
  );
}
