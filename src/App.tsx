import { useState, useEffect } from 'react'
import DrawScene from './scenes/DrawScene'
import RoomScene from './scenes/RoomScene'
import PlazaScene from './scenes/PlazaScene'
import AuthButton from './components/AuthButton'
import { initAuth } from './lib/auth'
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

  useEffect(() => {
    initAuth()
  }, [])

  const handlePetCreated = (pixelData: string, coords: PetCoords, name: string) => {
    const data: PetData = { pixelData, coords, name }
    setPetData(data)
    localStorage.setItem(PET_STORAGE_KEY, JSON.stringify(data))
    setScene('room')
  }

  if (!petData || scene === 'draw') {
    return (
      <>
        <AuthButton />
        <DrawScene onPetCreated={handlePetCreated} />
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
      />
    </>
  )
}

export default App
