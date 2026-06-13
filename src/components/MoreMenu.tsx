import styles from './MoreMenu.module.css'

export type ShareCardState = 'idle' | 'making' | 'failed' | 'done'

interface MoreMenuProps {
  streak:         number
  isAnonymous:    boolean
  shareCardState: ShareCardState
  onRewards:      () => void
  onShop:         () => void
  onTasks:        () => void
  onShareIP:      () => void
  onShareCard:    () => void
}

export default function MoreMenu({
  streak,
  isAnonymous,
  shareCardState,
  onRewards,
  onShop,
  onTasks,
  onShareIP,
  onShareCard,
}: MoreMenuProps) {
  const shareLabel =
    shareCardState === 'making' ? 'MAKING...' :
    shareCardState === 'failed' ? 'FAILED, TRY AGAIN' :
    shareCardState === 'done'   ? 'CARD SAVED + LINK COPIED!' :
    '🖼️ SHARE CARD'

  return (
    <div className={styles.morePopup} onClick={e => e.stopPropagation()}>
      <div className={styles.morePopupStreak}>
        🔥 STREAK: {isAnonymous ? '--' : `DAY ${streak}`}
      </div>
      <button className={styles.morePopupItem} onClick={onRewards}>🎁 REWARDS</button>
      <button className={styles.morePopupItem} onClick={onShop}>🛒 SHOP</button>
      <button className={styles.morePopupItem} onClick={onTasks}>✅ TASKS</button>
      <button
        className={styles.morePopupItem}
        style={{ background: '#FFE600', color: '#2C2C2C' }}
        onClick={onShareIP}
      >
        ✦ SHARE YOUR IP
      </button>
      <button
        className={`${styles.morePopupItem} ${styles.morePopupItemLast}`}
        disabled={shareCardState === 'making'}
        onClick={shareCardState === 'idle' ? onShareCard : undefined}
        style={shareCardState === 'failed' ? { color: '#e94560' } : undefined}
      >
        {shareLabel}
      </button>
    </div>
  )
}
