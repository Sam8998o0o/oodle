import { useState, useEffect } from 'react'
import DrawScene from './scenes/DrawScene'
import RoomScene from './scenes/RoomScene'
import PlazaScene from './scenes/PlazaScene'
import AuthButton from './components/AuthButton'
import { initAuth } from './lib/auth'
import type { PetCoords } from './api/aiRecognize'
import PaywallScene from './scenes/PaywallScene'
import { checkSubscription, getPetAge } from './lib/petService'
import { createCheckoutSession } from './lib/stripe'
import { useAuthStore, linkGoogle } from './lib/auth'

interface PetData {
  pixelData: string
  coords: PetCoords
  name: string
}

type Scene = 'draw' | 'room' | 'plaza' | 'paywall'

const PET_STORAGE_KEY = 'oodle_pet_data'

function loadSavedPet(): PetData | null {
  try {
    const raw = localStorage.getItem(PET_STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as PetData
  } catch {
    return null
  }
}

function App() {
  const [petData, setPetData] = useState<PetData | null>(() => loadSavedPet())
  const [scene, setScene]     = useState<Scene>(() => loadSavedPet() ? 'room' : 'draw')
  const [isPremium, setIsPremium] = useState(false)
  const [petAge, setPetAge]       = useState<number | null>(null)
  const [petSize, setPetSize]     = useState(60)

  useEffect(() => {
    initAuth()
  }, [])

  useEffect(() => {
    if (!petData) return
    Promise.all([checkSubscription(), getPetAge()]).then(([premium, age]) => {
      setIsPremium(premium)
      setPetAge(age)
      if (!premium && age !== null && age >= 14) setScene('paywall')
    })
  }, [petData])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('subscribed') === 'true') {
      window.history.replaceState({}, '', '/')
      checkSubscription().then(ok => {
        if (ok) { setIsPremium(true); setScene('room') }
      })
    }
  }, [])

  const handlePetCreated = (pixelData: string, coords: PetCoords, name: string) => {
    const data: PetData = { pixelData, coords, name }
    setPetData(data)
    localStorage.setItem(PET_STORAGE_KEY, JSON.stringify(data))
    setScene('room')
  }

  if (scene === 'paywall') {
    return (
      <>
        <AuthButton />
        <PaywallScene
          petData={petData}
          isLoggedIn={!!useAuthStore.getState().userId}
          userId={useAuthStore.getState().userId}
          onSubscribed={() => { setIsPremium(true); setScene('room') }}
          onLoginAndSubscribe={async () => {
            await linkGoogle()
            const uid = useAuthStore.getState().userId
            if (uid) {
              const url = await createCheckoutSession(uid)
              if (url) window.location.href = url
            }
          }}
        />
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
      </>
    )
  }

  if (scene === 'plaza') {
    return (
      <>
        <AuthButton />
        <PlazaScene
          petData={petData}
          onGoToRoom={() => setScene('room')}
          isPremium={isPremium}
          petSize={petSize}
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
        isPremium={isPremium}
        onSizeChange={(size) => setPetSize(size)}
      />
    </>
  )
}

export default App
