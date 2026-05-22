import { create } from 'zustand'
import { supabase } from './supabase'

// ── Zustand store ─────────────────────────────────────────
interface AuthState {
  userId:      string | null
  isAnonymous: boolean
  setUser: (userId: string | null, isAnonymous: boolean) => void
}

export const useAuthStore = create<AuthState>(set => ({
  userId:      null,
  isAnonymous: true,
  setUser: (userId, isAnonymous) => set({ userId, isAnonymous }),
}))

// ── Helpers ───────────────────────────────────────────────
function applySession(user: { id: string; is_anonymous?: boolean } | null) {
  if (user) {
    useAuthStore.getState().setUser(user.id, user.is_anonymous ?? true)
  } else {
    useAuthStore.getState().setUser(null, true)
  }
}

// ── initAuth ──────────────────────────────────────────────
// Call once on app boot. Reuses existing session when possible;
// only calls signInAnonymously() if no session exists.
export async function initAuth(): Promise<void> {

  // Keep the store in sync with any future auth changes (Google redirect etc.)
  supabase.auth.onAuthStateChange((_event, session) => {
    applySession(session?.user ?? null)
  })

  const { data: { session } } = await supabase.auth.getSession()
  console.log('existing session:', session)
  if (session?.user) {
    applySession(session.user)
    return
  }

  // No existing session → create an anonymous one
  console.log('calling signInAnonymously...')
const { data, error } = await supabase.auth.signInAnonymously()
console.log('result:', data, error)
if (error) {
  console.error('[auth] signInAnonymously failed:', error.message)
  return
}
  applySession(data.user)
}

// ── linkGoogle ────────────────────────────────────────────
// Signs in with Google OAuth. If user is anonymous, Supabase will
// merge the anonymous session with the Google account automatically.
export async function linkGoogle(): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin,
    },
  })
  if (error) console.error('[auth] linkGoogle failed:', error.message)
}

// ── signOut ───────────────────────────────────────────────
// Signs out then immediately obtains a fresh anonymous session
// so the game keeps running without interruption.
export async function signOut(): Promise<void> {
  await supabase.auth.signOut()
  const { data, error } = await supabase.auth.signInAnonymously()
  if (error) {
    console.error('[auth] re-anonymous after signOut failed:', error.message)
    return
  }
  applySession(data.user)
}
