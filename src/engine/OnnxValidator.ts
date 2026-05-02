import * as ort from 'onnxruntime-web'

export interface ValidationResult {
  score: number
  label: string
  ready: boolean
}

export class OnnxValidator {
  ready = false
  private session: ort.InferenceSession | null = null

  constructor() {
    this.load()
  }

  private async load() {
    try {
      this.session = await ort.InferenceSession.create('/models/pet_validator.onnx')
      this.ready = true
    } catch {
      this.ready = false
    }
  }

  async validate(canvas: HTMLCanvasElement): Promise<ValidationResult> {
    if (!this.ready || !this.session) {
      return { score: 0.75, label: 'ok', ready: false }
    }

    try {
      const ctx = canvas.getContext('2d')!
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const { data, width, height } = imageData

      // Convert to float32 RGB tensor normalised to [0, 1]
      const input = new Float32Array(3 * width * height)
      for (let i = 0; i < width * height; i++) {
        input[i]                    = data[i * 4]     / 255
        input[i + width * height]   = data[i * 4 + 1] / 255
        input[i + width * height * 2] = data[i * 4 + 2] / 255
      }

      const tensor = new ort.Tensor('float32', input, [1, 3, height, width])
      const inputName = this.session.inputNames[0]
      const results = await this.session.run({ [inputName]: tensor })
      const output = results[this.session.outputNames[0]].data as Float32Array
      const score = Math.max(0, Math.min(1, output[0]))

      return {
        score,
        label: score >= 0.6 ? 'creature' : score >= 0.3 ? 'maybe' : 'unknown',
        ready: true,
      }
    } catch {
      return { score: 0.75, label: 'ok', ready: false }
    }
  }

  getBackgroundColor(score: number): string {
    if (score >= 0.6) return '#F0FFF4'
    if (score >= 0.3) return '#FFFFF0'
    return '#FFF5F5'
  }
}
