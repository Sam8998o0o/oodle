import 'dotenv/config'
import express from 'express'
import recognizeRouter from './routes/recognize.js'

const app = express()
const PORT = 3001

app.use(express.json({ limit: '10mb' }))

app.use('/api/recognize', recognizeRouter)

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})
