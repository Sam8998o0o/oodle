import { useState, useEffect } from 'react'
import DrawScene from './scenes/DrawScene'
import RoomScene from './scenes/RoomScene'
import PlazaScene from './scenes/PlazaScene'
import AuthButton from './components/AuthButton'
import { initAuth, useAuthStore } from './lib/auth'
import SignInModal from './components/SignInModal'
import type { PetCoords } from './api/aiRecognize'
import PaywallScene from './scenes/PaywallScene'
import ArrestedScene from './scenes/ArrestedScene'
import { savePet, fetchUserPet, checkSubscription, checkJailStatus } from './lib/petService'

export interface PetData {
  pixelData: string
  coords: PetCoords
  name: string
}

type Scene = 'draw' | 'room' | 'plaza' | 'paywall' | 'arrested'

const PET_STORAGE_KEY = 'oodle_pet_data'

function loadSavedPet(): PetData | null {
  try {
    const raw = localStorage.getItem(PET_STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as PetData
  } catch { return null }
}

function App() {
  const [petData, setPetData] = useState<PetData | null>(() => loadSavedPet())
  const [scene, setScene]     = useState<Scene>(() => loadSavedPet() ? 'room' : 'draw')
  const [isPremium, setIsPremium]   = useState(false)
  const [petSize, setPetSize]       = useState(60)
  const [jailedUntil, setJailedUntil] = useState<Date | null>(null)

  const { userId, showSignInModal, setShowSignInModal } = useAuthStore()

  const handleLoginClick = () => setShowSignInModal(true)

  // Boot: restore session then route to the right scene
  useEffect(() => {
    initAuth().then(async () => {
      const uid = useAuthStore.getState().userId

      // Case A — not signed in → show draw screen
      if (!uid) {
        setPetData(null)
        localStorage.removeItem(PET_STORAGE_KEY)
        setScene('draw')
        return
      }

      // Pending pet from OAuth redirect → save it, enter room
      const raw = localStorage.getItem('oodle_pending_pet')
      if (raw) {
        try {
          const pending = JSON.parse(raw) as { name: string; pixelData: string; coords: PetCoords }
          localStorage.removeItem('oodle_pending_pet')
          const id = await savePet({ name: pending.name, pixelData: pending.pixelData, coords: pending.coords })
          if (id) {
            const data: PetData = { pixelData: pending.pixelData, coords: pending.coords, name: pending.name }
            setPetData(data)
            localStorage.setItem(PET_STORAGE_KEY, JSON.stringify(data))
            if (!localStorage.getItem('oodle_pet_created_at')) {
              localStorage.setItem('oodle_pet_created_at', String(Date.now()))
            }
            setScene('room')
            return
          }
        } catch {
          localStorage.removeItem('oodle_pending_pet')
        }
      }

      // Case B — signed in, fetch alive pet from Supabase → enter room
      const existing = await fetchUserPet()
      if (existing) {
        const data: PetData = { pixelData: existing.pixelData, coords: existing.coords, name: existing.name }
        setPetData(data)
        localStorage.setItem(PET_STORAGE_KEY, JSON.stringify(data))
        localStorage.setItem('oodle_pet_supabase_id', existing.id)
        setScene('room')
        return
      }

      // Case C — signed in but no alive pet → draw screen
      setPetData(null)
      localStorage.removeItem(PET_STORAGE_KEY)
      localStorage.removeItem('oodle_pet_supabase_id')
      setScene('draw')
    })
  }, [])

  // Check jail status on mount
  useEffect(() => {
    checkJailStatus().then(until => {
      if (until) { setJailedUntil(until); setScene('arrested') }
    }).catch(() => {})
  }, [])

  // Handle Stripe success callback
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('subscribed') === 'true') {
      window.history.replaceState({}, '', '/')
      checkSubscription().then(ok => {
        if (ok) { setIsPremium(true); setScene('room') }
      })
    }
  }, [])

  useEffect(() => {
    if (!petData) return
    checkSubscription().then(premium => setIsPremium(premium))
  }, [petData])

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

  const modal = showSignInModal
    ? <SignInModal onClose={() => setShowSignInModal(false)} />
    : null

  if (scene === 'paywall') {
    return (
      <>
        <AuthButton />
        <PaywallScene
          petData={petData}
          isLoggedIn={!!userId}
          userId={userId}
          onSubscribed={() => { setIsPremium(true); setScene('room') }}
          onLoginAndSubscribe={() => setShowSignInModal(true)}
          onClose={() => setScene('room')}
        />
        {modal}
      </>
    )
  }

  if (!petData || scene === 'draw') {
    return (
      <>
        <AuthButton />
        <DrawScene
          onPetCreated={handlePetCreated}
          isPremium={isPremium}
          onSubscribeClick={() => setScene('paywall')}
        />
        {modal}
      </>
    )
  }

  if (scene === 'plaza') {
    // Require Google sign-in to enter plaza
    if (!userId) {
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
          {modal}
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
          isPremium={isPremium}
        />
        {modal}
      </>
    )
  }

  if (scene === 'arrested') {
    return (
      <>
        <AuthButton />
        <ArrestedScene
          petData={petData}
          onSubscribeClick={() => setScene('paywall')}
          onLoginClick={handleLoginClick}
          isLoggedIn={!!userId}
          jailedUntil={jailedUntil}
          onGoBack={() => { setJailedUntil(null); setScene('room') }}
        />
        {modal}
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
        isPremium={isPremium}
      />
      {modal}
    </>
  )
}

export default App
