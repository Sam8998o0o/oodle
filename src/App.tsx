import { useState, useEffect } from 'react'
import DrawScene from './scenes/DrawScene'
import RoomScene from './scenes/RoomScene'
import PlazaScene from './scenes/PlazaScene'
import AuthButton from './components/AuthButton'
import { initAuth, linkGoogle, useAuthStore } from './lib/auth'
import { createCheckoutSession } from './lib/stripe'
import type { PetCoords } from './api/aiRecognize'

interface PetData {
  pixelData: string
  coords: PetCoords
  name: string
}

type Scene = 'draw' | 'room' | 'plaza'

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
  const [petSize, setPetSize] = useState(() => {
    try {
      const g = parseInt(localStorage.getItem('oodle_growth') ?? '0', 10)
      return Math.round(60 + (Math.min(100, Math.max(0, g)) / 100) * 100)
    } catch { return 60 }
  })

  useEffect(() => {
    initAuth()
  }, [])

  const handlePetCreated = (pixelData: string, coords: PetCoords, name: string) => {
    const data: PetData = { pixelData, coords, name }
    setPetData(data)
    localStorage.setItem(PET_STORAGE_KEY, JSON.stringify(data))
    setScene('room')
  }

  const handleSubscribeClick = async () => {
    // If not logged in, do Google OAuth first
    const { userId, isAnonymous } = useAuthStore.getState()
    if (!userId || isAnonymous) {
      await linkGoogle()
    }
    const uid = useAuthStore.getState().userId
    if (!uid) return
    const url = await createCheckoutSession(uid)
    if (url) window.location.href = url
  }

  if (!petData || scene === 'draw') {
    return (
      <>
        <AuthButton />
        <DrawScene
          onPetCreated={handlePetCreated}
          onSubscribeClick={handleSubscribeClick}
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
