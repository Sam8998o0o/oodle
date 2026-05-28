import { useState } from 'react'
import { signInWithGoogle } from '../lib/auth'
import { supabase } from '../lib/supabase'

interface SignInModalProps {
  onClose: () => void
}

export default function SignInModal({ onClose }: SignInModalProps) {
  const [email,   setEmail]   = useState('')
  const [sent,    setSent]    = useState(false)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const handleMagicLink = async () => {
    if (!email.trim()) return
    setLoading(true)
    setError(null)
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    })
    setLoading(false)
    if (otpError) {
      setError(otpError.message)
    } else {
      setSent(true)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.85)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 2000,
    }}>
      <div style={{
        background: '#1a1a2e',
        border: '4px solid #e94560',
        boxShadow: '8px 8px 0 #000',
        padding: '36px 32px',
        width: '340px',
        position: 'relative',
        fontFamily: 'var(--font-pixel)',
      }}>

        {/* Close */}
        <button
          onClick={onClose}
          style={{
            position: 'absolute', top: '10px', right: '12px',
            fontFamily: 'var(--font-pixel)', fontSize: '14px',
            background: 'none', border: 'none', color: '#888',
            cursor: 'pointer', lineHeight: 1,
          }}
        >✕</button>

        <h2 style={{ color: '#eaeaea', fontSize: '16px', marginBottom: '24px', textAlign: 'center' }}>
          SIGN IN
        </h2>

        {/* Google */}
        <button
          onClick={signInWithGoogle}
          style={{
            width: '100%',
            fontFamily: 'var(--font-pixel)', fontSize: '11px',
            padding: '14px',
            background: '#4285F4', color: 'white',
            border: '3px solid #2C2C2C',
            boxShadow: '4px 4px 0 #000',
            cursor: 'pointer', letterSpacing: '1px',
            whiteSpace: 'nowrap',
            marginBottom: '20px',
          }}
        >
          CONTINUE WITH GOOGLE
        </button>

        {/* Divider */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          marginBottom: '20px',
        }}>
          <div style={{ flex: 1, height: '2px', background: '#333' }} />
          <span style={{ color: '#555', fontSize: '10px' }}>OR</span>
          <div style={{ flex: 1, height: '2px', background: '#333' }} />
        </div>

        {sent ? (
          <div style={{ textAlign: 'center', padding: '16px 0' }}>
            <div style={{ fontSize: '28px', marginBottom: '12px' }}>📬</div>
            <p style={{ color: '#4ecca3', fontSize: '12px', lineHeight: 2 }}>
              CHECK YOUR EMAIL!
            </p>
            <p style={{ color: '#888', fontSize: '9px', lineHeight: 2, marginTop: '8px' }}>
              Click the link we sent to<br />{email}
            </p>
          </div>
        ) : (
          <>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleMagicLink() }}
              placeholder="your@email.com"
              style={{
                width: '100%', boxSizing: 'border-box',
                fontFamily: 'var(--font-pixel)', fontSize: '10px',
                padding: '12px',
                background: '#0f3460', color: '#eaeaea',
                border: '2px solid #333',
                outline: 'none', marginBottom: '12px',
              }}
            />
            <button
              onClick={handleMagicLink}
              disabled={loading || !email.trim()}
              style={{
                width: '100%',
                fontFamily: 'var(--font-pixel)', fontSize: '10px',
                padding: '12px',
                background: loading || !email.trim() ? '#444' : '#FFE600',
                color: loading || !email.trim() ? '#888' : '#2C2C2C',
                border: '3px solid #2C2C2C',
                boxShadow: loading || !email.trim() ? 'none' : '4px 4px 0 #000',
                cursor: loading || !email.trim() ? 'not-allowed' : 'pointer',
                letterSpacing: '1px',
              }}
            >
              {loading ? 'SENDING...' : 'SEND MAGIC LINK'}
            </button>
            {error && (
              <p style={{ color: '#e94560', fontSize: '9px', marginTop: '10px', lineHeight: 2, textAlign: 'center' }}>
                {error}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
