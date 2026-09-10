// 生成测试音频：120 BPM 哒声（每小节重音），16bit 单声道 WAV
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const out = join(__dirname, '..', 'tests', 'fixtures', 'click120.wav');
mkdirSync(dirname(out), { recursive: true });

const SR = 44100;
const BPM = 120;
const SPB = 60 / BPM;
const DUR = 64; // 秒
const N = SR * DUR;
const data = new Float32Array(N);

for (let beat = 0; beat * SPB < DUR; beat++) {
  const t0 = Math.floor(beat * SPB * SR);
  const accent = beat % 4 === 0;
  const freq = accent ? 1760 : 880;
  const len = Math.floor(SR * 0.06);
  for (let i = 0; i < len && t0 + i < N; i++) {
    const env = Math.exp(-i / (SR * 0.008));
    data[t0 + i] += Math.sin(2 * Math.PI * freq * i / SR) * env * (accent ? 0.9 : 0.5);
  }
}

// WAV 封装
const buf = Buffer.alloc(44 + N * 2);
buf.write('RIFF', 0);
buf.writeUInt32LE(36 + N * 2, 4);
buf.write('WAVE', 8);
buf.write('fmt ', 12);
buf.writeUInt32LE(16, 16);
buf.writeUInt16LE(1, 20);       // PCM
buf.writeUInt16LE(1, 22);       // mono
buf.writeUInt32LE(SR, 24);
buf.writeUInt32LE(SR * 2, 28);
buf.writeUInt16LE(2, 32);
buf.writeUInt16LE(16, 34);
buf.write('data', 36);
buf.writeUInt32LE(N * 2, 40);
for (let i = 0; i < N; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(data[i] * 32767))), 44 + i * 2);

writeFileSync(out, buf);
console.log(`已生成 ${out}（${DUR}s, ${BPM}BPM, ${(buf.length / 1024 / 1024).toFixed(1)}MB）`);
