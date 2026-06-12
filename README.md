# OODLE
> draw a pixel pet. make it life.

## What is Oodle?

A browser-based pixel pet game — draw your own 64×64 pixel character, then watch it come to life in its own room.

- Feed it, play with it, take it to the Plaza to meet other players' pets.
- Your pet is your original IP — share it, show it off, connect it to Oodle Creators.

## Features

- Pixel drawing canvas (64×64 grid, 16 colours, pen/fill/undo tools)
- AI pixel generation via Google Gemini (PRO)
- AI import — upload any image, auto-converted to pixel art (PRO)
- Pet animation engine (idle/walk/eat/sleep/sad/dizzy states)
- Room scene with hunger/happy/energy stats, day/night cycle, weather
- Plaza multiplayer — real-time presence via Supabase Realtime
- Like system with food rewards
- Shout bubbles in the Plaza
- Share Card — generate an animated GIF card to share on social media
- Streak system
- Stripe subscription ($4.99/month for PRO features)

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + Vite + TypeScript |
| Styling | CSS Modules |
| Canvas | HTML5 Canvas 2D |
| AI | Google Gemini 2.0 Flash |
| State | Zustand |
| Backend | Node.js + Express (Vercel serverless) |
| Database | Supabase (PostgreSQL + Realtime) |
| Auth | Supabase Anonymous Auth + Google OAuth |
| Payments | Stripe |

## Live

https://oodle.vercel.app
