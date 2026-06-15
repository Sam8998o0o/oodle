import { useState } from 'react'
import styles from './TutorialModal.module.css'

interface Props {
  onClose: () => void
}

interface PageItem {
  icon: string
  label: string
  desc: string
}

interface Page {
  heading: string
  items: PageItem[]
}

const PAGES: Page[] = [
  {
    heading: '📖 YOUR PET',
    items: [
      {
        icon: '✏️',
        label: 'DRAW YOUR PET',
        desc: 'Draw on the 64×64 grid using PEN, FILL, DEL. Fill 65%+ to pass. Pick eyes and name your pet.',
      },
      {
        icon: '🏠',
        label: 'TAKE CARE OF IT',
        desc: '3 bars — 🍎 Hunger (feed daily, max 5×), 😊 Happy (tap to scratch), ⚡ Energy (recovers while sleeping).',
      },
      {
        icon: '⚠️',
        label: "DON'T NEGLECT IT",
        desc: 'Pet faints if hunger hits 0. Disappears after 4 days offline!',
      },
    ],
  },
  {
    heading: '❤️ LIKES & FOOD',
    items: [
      {
        icon: '💬',
        label: 'SHOUT IN THE PLAZA',
        desc: 'Go to Plaza and type a shout bubble. Other players can like your shout!',
      },
      {
        icon: '❤️',
        label: 'SHOUT LIKES = FOOD',
        desc: 'When someone likes your shout, it adds to your like balance. 5 ❤️ → 🍪 Snack, 10 ❤️ → 🍱 Meal',
      },
      {
        icon: '🛒',
        label: 'REDEEM IN ROOM',
        desc: 'Go back to your Room. Open the LIKES panel (bottom-right). Spend your likes on food for your pet!',
      },
    ],
  },
  {
    heading: '🏙️ PLAZA & STREAKS',
    items: [
      {
        icon: '🎓',
        label: 'TEACH TRICKS',
        desc: 'Press PLAY in Room to teach a trick. Your pet performs its latest trick in the Plaza!',
      },
      {
        icon: '💬',
        label: 'SHOUT IN THE PLAZA',
        desc: 'Tap any pet to send a shout bubble. 10 shouts/day. Others can like your shouts — you get notified!',
      },
      {
        icon: '🔥',
        label: 'DAILY STREAK REWARDS',
        desc: 'Log in daily to build your streak. Day 7: 🚁 Propeller Hat for 24 hours! Miss a day and streak resets.',
      },
    ],
  },
]

export default function TutorialModal({ onClose }: Props) {
  const [page, setPage] = useState(0)
  const isLast = page === PAGES.length - 1
  const current = PAGES[page]

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className={styles.header}>
          <span className={styles.headerTitle}>HOW TO PLAY</span>
        </div>
        <button className={styles.closeBtn} onClick={onClose}>✕</button>

        {/* Body */}
        <div className={styles.body}>
          <p className={styles.pageHeading}>{current.heading}</p>
          <div className={styles.itemList}>
            {current.items.map(item => (
              <div key={item.label} className={styles.item}>
                <span className={styles.itemIcon}>{item.icon}</span>
                <div className={styles.itemText}>
                  <span className={styles.itemLabel}>{item.label}</span>
                  <span className={styles.itemDesc}>{item.desc}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <div className={styles.dots}>
            {PAGES.map((_, i) => (
              <div
                key={i}
                className={`${styles.dot} ${i === page ? styles.dotActive : ''}`}
              />
            ))}
          </div>

          <div className={styles.navRow}>
            {page > 0 ? (
              <button className={styles.navBtn} onClick={() => setPage(p => p - 1)}>
                ← PREV
              </button>
            ) : (
              <div className={`${styles.navBtn} ${styles.navBtnGhost}`} />
            )}
            {isLast ? (
              <button className={styles.navBtn} onClick={onClose}>
                GOT IT ✓
              </button>
            ) : (
              <button className={styles.navBtn} onClick={() => setPage(p => p + 1)}>
                NEXT →
              </button>
            )}
          </div>

          <p className={styles.footerTagline}>✨ draw a pixel pet. make it life. ✨</p>
        </div>

      </div>
    </div>
  )
}
