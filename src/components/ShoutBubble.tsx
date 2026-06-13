import styles from './ShoutBubble.module.css'

interface ShoutBubbleProps {
  message:    string
  shoutId:    string
  isOwn:      boolean
  likedShouts: Set<string>
  onLike:     (shoutId: string) => void
}

export default function ShoutBubble({ message, shoutId, isOwn, likedShouts, onLike }: ShoutBubbleProps) {
  return (
    <div className={styles.speechBubble}>
      {message}
      {!isOwn && (
        <button
          className={styles.bubbleLikeBtn}
          disabled={likedShouts.has(shoutId)}
          onClick={e => { e.stopPropagation(); onLike(shoutId) }}
        >
          {likedShouts.has(shoutId) ? '❤️ LIKED' : '❤️ LIKE'}
        </button>
      )}
    </div>
  )
}
