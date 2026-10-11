
const dgram = require("node:dgram");

const HOST = "192.168.1.41";
const PORT = 4048;
const LED_COUNT = 80;
const FPS = 40;
const DURATION_MS = 10000;

const socket = dgram.createSocket("udp4");
const pixels = Buffer.alloc(LED_COUNT * 3);

let sequence = 0;
let position = 0;

function sendFrame() {
  const header = Buffer.alloc(10);

  header[0] = 0x41;
  header[1] = sequence++ & 0x0f;
  header[2] = 0x0b;
  header[3] = 0x01;
  header.writeUInt32BE(0, 4);
  header.writeUInt16BE(pixels.length, 8);

  socket.send(
    Buffer.concat([header, pixels]),
    PORT,
    HOST
  );
}

const frameTimer = setInterval(sendFrame, 1000 / FPS);

const noteTimer = setInterval(() => {
  pixels.fill(0);

  const offset = position * 3;
  pixels[offset] = 0;
  pixels[offset + 1] = 25;
  pixels[offset + 2] = 0;

  position = (position + 1) % LED_COUNT;
}, 100);

setTimeout(() => {
  clearInterval(frameTimer);
  clearInterval(noteTimer);

  pixels.fill(0);
  sendFrame();

  setTimeout(() => socket.close(), 100);
}, DURATION_MS);

sendFrame();
