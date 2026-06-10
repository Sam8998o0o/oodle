import 'dotenv/config'
import express from 'express'
import recognizeRouter       from './routes/recognize.js'
import generatePetRouter     from './routes/generate-pet.js'
import convertImageRouter    from './routes/convert-image-to-pet.js'
import stripeRouter          from './routes/stripe.js'

const app = express()
const PORT = 3001

// Stripe webhook must receive raw body before express.json() parses it
app.use('/api/webhook/stripe', express.raw({ type: 'application/json' }), stripeRouter)

app.use(express.json({ limit: '10mb' }))

app.use('/api/recognize',            recognizeRouter)
app.use('/api/generate-pet',         generatePetRouter)
app.use('/api/convert-image-to-pet', convertImageRouter)
app.use('/api', stripeRouter)

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})
