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

function App() {
  const [petData, setPetData] = useState<PetData | null>(null)
  const [scene, setScene]     = useState<Scene>('draw')

  // Silently establish an anonymous Supabase session on first load.
  // Reuses existing session if one is already stored in localStorage.
  useEffect(() => {
    initAuth()
  }, [])

  if (!petData || scene === 'draw') {
    return (
      <>
        <AuthButton />
        <DrawScene
          onPetCreated={(pixelData, coords, name) => {
            setPetData({ pixelData, coords, name })
            setScene('room')
          }}
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
