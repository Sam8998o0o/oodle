import { supabase } from './supabase'
import type { PetRecord } from './petService'

// ── subscribeToNewPets ────────────────────────────────────
// Listens for INSERT events on the pets table.
// Returns an unsubscribe function — call it in useEffect cleanup.
//
// Prerequisites: the pets table must be added to the realtime
// publication (see supabase/schema.sql).
export function subscribeToNewPets(
  onNewPet: (pet: PetRecord) => void
): () => void {
  const channel = supabase
    .channel('plaza-pets-inserts')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'pets' },
      payload => {
        onNewPet(payload.new as PetRecord)
      }
    )
    .subscribe(status => {
      if (status === 'SUBSCRIBED') {
        console.log('[realtime] subscribed to pets inserts')
      }
    })

  return () => {
    supabase.removeChannel(channel)
  }
}
