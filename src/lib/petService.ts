import { supabase } from './supabase'
import { useAuthStore } from './auth'
import type { PetCoords } from '../api/aiRecognize'

// ── Types ─────────────────────────────────────────────────
export interface PetRecord {
  id:         string
  user_id:    string
  name:       string
  pixel_data: string
  coords:     PetCoords | null
  created_at: string
}

// localStorage key used to avoid re-inserting the same pet
const LOCAL_PET_ID_KEY = 'oodle_pet_supabase_id'

// ── savePet ───────────────────────────────────────────────
// Inserts the user's pet into Supabase once.
// Subsequent calls (e.g. after a page refresh) are no-ops
// because the id is cached in localStorage.
// Returns the Supabase pet id, or null on failure.
export async function savePet(pet: {
  name:      string
  pixelData: string
  coords:    PetCoords
}): Promise<string | null> {
  const userId = useAuthStore.getState().userId
  if (!userId) return null

  // Idempotency: don't insert a second time for the same browser session
  const cached = localStorage.getItem(LOCAL_PET_ID_KEY)
  if (cached) return cached

  const { data, error } = await supabase
    .from('pets')
    .insert({
      user_id:    userId,
      name:       pet.name,
      pixel_data: pet.pixelData,
      coords:     pet.coords,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[petService] savePet failed:', error.message)
    return null
  }

  const id = data?.id ?? null
  if (id) localStorage.setItem(LOCAL_PET_ID_KEY, id)
  return id
}

// ── fetchAllPets ──────────────────────────────────────────
// Returns up to 50 recent pets from Supabase.
// Returns [] on failure (caller should fall back to localStorage).
export async function fetchAllPets(): Promise<PetRecord[]> {
  const { data, error } = await supabase
    .from('pets')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) {
    console.error('[petService] fetchAllPets failed:', error.message)
    return []
  }

  return (data ?? []) as PetRecord[]
}

// ── getAllLikeCounts ───────────────────────────────────────
// Returns a map of petId → like count for all pets.
// Returns {} on failure.
export async function getAllLikeCounts(): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from('likes')
    .select('pet_id')

  if (error) {
    console.error('[petService] getAllLikeCounts failed:', error.message)
    return {}
  }

  const counts: Record<string, number> = {}
  for (const row of data ?? []) {
    counts[row.pet_id as string] = (counts[row.pet_id as string] ?? 0) + 1
  }
  return counts
}

// ── likePet ───────────────────────────────────────────────
// Inserts a like row. Silently ignores duplicates (UNIQUE constraint).
export async function likePet(petId: string): Promise<void> {
  const userId = useAuthStore.getState().userId
  if (!userId) return

  const { error } = await supabase
    .from('likes')
    .insert({ pet_id: petId, user_id: userId })

  // error code 23505 = unique_violation → user already liked this pet → fine
  if (error && error.code !== '23505') {
    console.error('[petService] likePet failed:', error.message)
  }
}
