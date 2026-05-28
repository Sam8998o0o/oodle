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
  isAnonymous: false,
  setUser: (userId, isAnonymous) => set({ userId, isAnonymous }),
}))

// ── Helpers ───────────────────────────────────────────────
function applySession(user: { id: string; is_anonymous?: boolean } | null) {
  if (user) {
    useAuthStore.getState().setUser(user.id, user.is_anonymous ?? false)
  } else {
    useAuthStore.getState().setUser(null, false)
  }
}

// ── initAuth ──────────────────────────────────────────────
// Call once on app boot. Restores an existing Google session if present.
// Does NOT create anonymous sessions — Google sign-in is required.
export async function initAuth(): Promise<void> {
  supabase.auth.onAuthStateChange((_event, session) => {
    applySession(session?.user ?? null)
  })

  const { data: { session } } = await supabase.auth.getSession()
  if (session?.user) {
    applySession(session.user)
  }
  // No session → stay unauthenticated; app waits for Google sign-in
}

// ── signInWithGoogle ───────────────────────────────────────
// Redirects to Google OAuth. On return, initAuth() restores the session.
export async function signInWithGoogle(): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin,
    },
  })
  if (error) console.error('[auth] signInWithGoogle failed:', error.message)
}

// ── linkGoogle ────────────────────────────────────────────
// Alias kept for any remaining callers.
export const linkGoogle = signInWithGoogle

// ── signOut ───────────────────────────────────────────────
// Signs out. User must sign in with Google again to continue.
export async function signOut(): Promise<void> {
  await supabase.auth.signOut()
  useAuthStore.getState().setUser(null, false)
  window.location.href = '/'
}
