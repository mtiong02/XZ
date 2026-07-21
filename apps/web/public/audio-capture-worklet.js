/* global AudioWorkletProcessor, registerProcessor */

class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(2048);
    this.offset = 0;
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (output) output.fill(0);
    if (input?.length) {
      let inputOffset = 0;
      while (inputOffset < input.length) {
        const count = Math.min(input.length - inputOffset, this.buffer.length - this.offset);
        this.buffer.set(input.subarray(inputOffset, inputOffset + count), this.offset);
        this.offset += count;
        inputOffset += count;
        if (this.offset === this.buffer.length) {
          const ready = this.buffer;
          this.buffer = new Float32Array(2048);
          this.offset = 0;
          this.port.postMessage(ready.buffer, [ready.buffer]);
        }
      }
    }
    return true;
  }
}

registerProcessor('pcm-capture', PcmCaptureProcessor);
