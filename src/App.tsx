import { useState } from 'react'
import DrawScene from './scenes/DrawScene'
import RoomScene from './scenes/RoomScene'
import type { PetCoords } from './api/aiRecognize'

interface PetData {
  pixelData: string
  coords: PetCoords
  name: string
}

function App() {
  const [petData, setPetData] = useState<PetData | null>(null)

  if (petData) {
    return (
      <RoomScene
        petData={petData}
        onGoToPlaza={() => { /* Plaza coming later */ }}
      />
    )
  }

  return (
    <DrawScene
      onPetCreated={(pixelData, coords, name) =>
        setPetData({ pixelData, coords, name })
      }
    />
  )
}

export default App