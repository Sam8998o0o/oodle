import styles from './PixelButton.module.css'

interface PixelButtonProps {
  label: string
  onClick: () => void
  variant?: 'primary' | 'secondary' | 'cta'
  disabled?: boolean
  size?: 'sm' | 'md' | 'lg'
}

export default function PixelButton({
  label,
  onClick,
  variant = 'primary',
  disabled = false,
  size = 'md',
}: PixelButtonProps) {
  return (
    <button
      className={[
        styles.btn,
        styles[variant],
        styles[size],
        disabled ? styles.disabled : '',
      ].join(' ')}
      onClick={onClick}
      disabled={disabled}
    >
      {label}
    </button>
  )
}
