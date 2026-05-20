import { useState, useEffect } from 'react'
import DrawScene from './scenes/DrawScene'
import RoomScene from './scenes/RoomScene'
import PlazaScene from './scenes/PlazaScene'
import ArrestedScene from './scenes/ArrestedScene'
import AuthButton from './components/AuthButton'
import { initAuth, linkGoogle, useAuthStore } from './lib/auth'
import { createCheckoutSession } from './lib/stripe'
import type { PetCoords } from './api/aiRecognize'

export interface PetData {
  pixelData: string
  coords: PetCoords
  name: string
}

type Scene = 'draw' | 'room' | 'plaza' | 'arrested'

const PET_STORAGE_KEY    = 'oodle_pet_data'
const FREE_TRIAL_DAYS    = 14

function loadSavedPet(): PetData | null {
  try {
    const raw = localStorage.getItem(PET_STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as PetData
  } catch { return null }
}

function getPetAgeDays(): number {
  try {
    const created = localStorage.getItem('oodle_pet_created_at')
    if (!created) return 0
    return Math.floor((Date.now() - parseInt(created, 10)) / 86400000)
  } catch { return 0 }
}

function App() {
  const [petData, setPetData] = useState<PetData | null>(() => loadSavedPet())
  const [scene, setScene]     = useState<Scene>(() => loadSavedPet() ? 'room' : 'draw')
  const [isPremium, setIsPremium] = useState(false)
  const [petSize, setPetSize] = useState(() => {
    try {
      const g = parseInt(localStorage.getItem('oodle_growth') ?? '0', 10)
      return Math.round(60 + (Math.min(100, Math.max(0, g)) / 100) * 100)
    } catch { return 60 }
  })

  useEffect(() => { initAuth() }, [])

  // Check trial expiry on mount
  useEffect(() => {
    if (!petData || isPremium) return
    const age = getPetAgeDays()
    if (age >= FREE_TRIAL_DAYS) setScene('arrested')
  }, [petData, isPremium])

  // Handle Stripe success callback
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('subscribed') === 'true') {
      window.history.replaceState({}, '', '/')
      setIsPremium(true)
      setScene('room')
    }
  }, [])

  const handlePetCreated = (pixelData: string, coords: PetCoords, name: string) => {
    const data: PetData = { pixelData, coords, name }
    setPetData(data)
    localStorage.setItem(PET_STORAGE_KEY, JSON.stringify(data))
    // Record creation time for trial calculation
    if (!localStorage.getItem('oodle_pet_created_at')) {
      localStorage.setItem('oodle_pet_created_at', String(Date.now()))
    }
    setScene('room')
  }

  const handleSubscribeClick = async () => {
    const { userId, isAnonymous } = useAuthStore.getState()
    if (!userId || isAnonymous) {
      await linkGoogle()
      return
    }
    const uid = useAuthStore.getState().userId
    if (!uid) return
    const url = await createCheckoutSession(uid)
    if (url) window.location.href = url
  }

  const handleLoginClick = async () => {
    await linkGoogle()
  }

  const { isAnonymous } = useAuthStore()

  if (!petData || scene === 'draw') {
    return (
      <>
        <AuthButton />
        <DrawScene
          onPetCreated={handlePetCreated} 
        />
      </>
    )
  }

  if (scene === 'arrested') {
    return (
      <ArrestedScene
        petData={petData}
        isLoggedIn={!isAnonymous}
        onSubscribeClick={handleSubscribeClick}
        onLoginClick={handleLoginClick}
      />
    )
  }

  if (scene === 'plaza') {
    // Require Google login to enter plaza
    if (isAnonymous) {
      return (
        <>
          <AuthButton />
          <div style={{
            minHeight: '100vh',
            background: '#FDF6E3',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'var(--font-pixel)',
            gap: '20px',
          }}>
            <div style={{ fontSize: '14px', color: '#2C2C2C', textAlign: 'center', lineHeight: 2 }}>
              LOGIN TO ENTER<br />THE PLAZA
            </div>
            <div style={{ fontSize: '9px', color: '#888', textAlign: 'center', lineHeight: 2 }}>
              Sign in with Google to meet<br />other pets, like & shout!
            </div>
            <button
              onClick={handleLoginClick}
              style={{
                fontFamily: 'var(--font-pixel)',
                fontSize: '10px',
                padding: '14px 24px',
                background: '#FFE600',
                color: '#2C2C2C',
                border: '3px solid #2C2C2C',
                boxShadow: '4px 4px 0 #2C2C2C',
                cursor: 'pointer',
                letterSpacing: '2px',
              }}
            >
              G SIGN IN
            </button>
            <button
              onClick={() => setScene('room')}
              style={{
                fontFamily: 'var(--font-pixel)',
                fontSize: '8px',
                padding: '10px 18px',
                background: 'transparent',
                color: '#888',
                border: '2px solid #ccc',
                cursor: 'pointer',
              }}
            >
              ← BACK TO ROOM
            </button>
          </div>
        </>
      )
    }

    return (
      <>
        <AuthButton />
        <PlazaScene
          petData={petData}
          petSize={petSize}
          onGoToRoom={() => setScene('room')}
        />
      </>
    )
  }

  return (
    <>
      <AuthButton />
      <RoomScene
        petData={petData}
        onGoToPlaza={() => setScene('plaza')}
        onSizeChange={(size) => setPetSize(size)}
      />
    </>
  )
}

export default App
