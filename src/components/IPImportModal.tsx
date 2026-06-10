import { useRef, useState } from 'react'
import { savePet } from '../lib/petService'
import { recognizePet } from '../api/aiRecognize'
import type { PetCoords } from '../api/aiRecognize'

interface IPImportModalProps {
  imageUrl: string
  characterName: string
  onDismiss: () => void
  onPetCreated: (pixelData: string, coords: PetCoords, name: string) => void
}

export default function IPImportModal({
  imageUrl,
  characterName,
  onDismiss,
  onPetCreated,
}: IPImportModalProps) {
  const [loading, setLoading]       = useState(false)
  const [loadingMsg, setLoadingMsg] = useState('')
  const [error, setError]           = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const doConvert = async (body: Record<string, string>) => {
    const res = await fetch('/api/convert-image-to-pet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json() as { image?: string; error?: string }
    if (!data.image) throw new Error(data.error ?? 'Conversion failed')
    return data.image
  }

  const finishWithImage = async (pixelData: string) => {
    setLoadingMsg('Bringing your IP to life...')
    const coords = await recognizePet(pixelData)
    await savePet({ name: characterName, pixelData, coords })
    onPetCreated(pixelData, coords, characterName)
  }

  const handleUseCharacterImage = async () => {
    setLoading(true)
    setLoadingMsg('Fetching your character...')
    setError(null)
    try {
      const pixelData = await doConvert({ imageUrl, name: characterName })
      await finishWithImage(pixelData)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setLoading(false)
    }
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      setError('File too large (max 5MB)')
      return
    }
    setLoading(true)
    setLoadingMsg('Reading your image...')
    setError(null)

    const reader = new FileReader()
    reader.onload = async (ev) => {
      const dataUrl = ev.target?.result as string
      const [header, imageBase64] = dataUrl.split(',')
      const mimeType = header.split(':')[1]?.split(';')[0] ?? 'image/png'
      setLoadingMsg('Converting to pixel art...')
      try {
        const pixelData = await doConvert({ imageBase64, mimeType, name: characterName })
        await finishWithImage(pixelData)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong')
        setLoading(false)
      }
    }
    reader.readAsDataURL(file)
  }

  const btnBase: React.CSSProperties = {
    width: '100%',
    fontFamily: 'var(--font-pixel)',
    fontSize: '10px',
    padding: '14px',
    border: '3px solid #000',
    cursor: 'pointer',
    letterSpacing: '1px',
    textAlign: 'center',
    lineHeight: 1.6,
    display: 'block',
    boxSizing: 'border-box',
  }

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.88)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 2000,
    }}>
      <div style={{
        background: '#1a1a2e',
        border: '4px solid #e94560',
        boxShadow: '8px 8px 0 #000',
        padding: '32px 28px',
        width: '360px',
        position: 'relative',
        fontFamily: 'var(--font-pixel)',
      }}>

        {/* Title */}
        <div style={{
          color: '#4ecca3',
          fontSize: '11px',
          textAlign: 'center',
          marginBottom: '20px',
          letterSpacing: '1px',
          lineHeight: 1.8,
        }}>
          ✦ BRING YOUR IP<br />INTO THE GAME
        </div>

        {/* Character preview */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          marginBottom: '20px',
          gap: '8px',
        }}>
          <div style={{
            width: '80px', height: '80px',
            border: '3px solid #e94560',
            boxShadow: '4px 4px 0 #000',
            overflow: 'hidden',
            background: '#0f3460',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <img
              src={imageUrl}
              alt={characterName}
              style={{
                width: '100%', height: '100%',
                objectFit: 'contain',
                imageRendering: 'pixelated',
              }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
            />
          </div>
          <div style={{
            color: '#eaeaea',
            fontSize: '9px',
            letterSpacing: '1px',
            textTransform: 'uppercase',
            maxWidth: '200px',
            textAlign: 'center',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {characterName}
          </div>
        </div>

        {/* Loading state */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ color: '#f5a623', fontSize: '9px', lineHeight: 2, letterSpacing: '1px' }}>
              ▶ {loadingMsg}
            </div>
            <div style={{ color: '#333', fontSize: '11px', marginTop: '10px', letterSpacing: '2px' }}>
              ░░░░░░░░░░░░░░░░░░░
            </div>
          </div>
        ) : (
          <>
            {/* Error */}
            {error && (
              <div style={{
                color: '#e94560',
                fontSize: '9px',
                textAlign: 'center',
                marginBottom: '14px',
                lineHeight: 1.8,
                padding: '10px',
                border: '2px solid #e94560',
                background: 'rgba(233,69,96,0.1)',
              }}>
                ✕ {error}
              </div>
            )}

            {/* Option 1: Create new pet */}
            <button
              onClick={onDismiss}
              style={{
                ...btnBase,
                background: '#0f3460',
                color: '#eaeaea',
                boxShadow: '4px 4px 0 #000',
                marginBottom: '10px',
              }}
            >
              CREATE NEW PET
              <div style={{ fontSize: '8px', color: '#888', marginTop: '5px', fontFamily: 'var(--font-pixel)' }}>
                Draw your own from scratch
              </div>
            </button>

            {/* Option 2: Use character image */}
            <button
              onClick={handleUseCharacterImage}
              style={{
                ...btnBase,
                background: '#e94560',
                color: '#fff',
                boxShadow: '4px 4px 0 #000',
                marginBottom: '10px',
              }}
            >
              USE THIS CHARACTER
              <div style={{ fontSize: '8px', color: 'rgba(255,255,255,0.7)', marginTop: '5px', fontFamily: 'var(--font-pixel)' }}>
                Convert {characterName} to pixel art
              </div>
            </button>

            {/* Option 3: Upload own image */}
            <button
              onClick={() => fileInputRef.current?.click()}
              style={{
                ...btnBase,
                background: '#4ecca3',
                color: '#1a1a2e',
                boxShadow: '4px 4px 0 #000',
                marginBottom: '18px',
              }}
            >
              UPLOAD MY OWN IMAGE
              <div style={{ fontSize: '8px', color: 'rgba(26,26,46,0.65)', marginTop: '5px', fontFamily: 'var(--font-pixel)' }}>
                JPG / PNG / WEBP  •  max 5MB
              </div>
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />

            {/* Note */}
            <div style={{
              color: '#444',
              fontSize: '8px',
              textAlign: 'center',
              lineHeight: 1.8,
            }}>
              ✦ Your image will be converted<br />to 64×64 pixel art style
            </div>
          </>
        )}
      </div>
    </div>
  )
}
