import { supabase } from './supabase'

export async function generatePetImage(description: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.functions.invoke('generate-pet', {
      body: { description }
    })
    if (error || !data?.imageBase64) return null
    return data.imageBase64 as string
  } catch { return null }
}

export async function validatePetImage(imageBase64: string): Promise<{ pass: boolean; reason: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('validate-pet', {
      body: { imageBase64 }
    })
    if (error || !data) return { pass: false, reason: 'Validation failed' }
    return data as { pass: boolean; reason: string }
  } catch { return { pass: false, reason: 'Validation failed' } }
}
