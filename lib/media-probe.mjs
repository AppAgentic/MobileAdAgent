/* Pure-Node media metadata probes for QA.

   The product QA rail must not shell out to ffprobe/ffmpeg. PNG dimensions
   come from the IHDR chunk; MP4 duration/dimensions come from walking the
   ISO BMFF box tree (moov/mvhd for duration, trak/tkhd for track sizes).
   When a file cannot be parsed the probe returns { ok: false, reason } so
   QA can record a validation gap instead of guessing. */

export function probePng(bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(signature)) {
    return { ok: false, reason: 'Not a PNG file.' };
  }
  if (buffer.toString('ascii', 12, 16) !== 'IHDR') {
    return { ok: false, reason: 'PNG missing IHDR chunk.' };
  }
  return {
    ok: true,
    container: 'png',
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    bytes: buffer.byteLength,
  };
}

export function probeJpeg(bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return { ok: false, reason: 'Not a JPEG file.' };
  }
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    // SOF0..SOF15 (excluding DHT/JPG/DAC control markers) carry dimensions.
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return {
        ok: true,
        container: 'jpeg',
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
        bytes: buffer.byteLength,
      };
    }
    const segmentLength = buffer.readUInt16BE(offset + 2);
    if (segmentLength < 2) return { ok: false, reason: 'Corrupt JPEG segment.' };
    offset += 2 + segmentLength;
  }
  return { ok: false, reason: 'JPEG dimensions not found.' };
}

export function probeImage(bytes) {
  const png = probePng(bytes);
  if (png.ok) return png;
  const jpeg = probeJpeg(bytes);
  if (jpeg.ok) return jpeg;
  return { ok: false, reason: 'Unrecognized image container (expected PNG or JPEG).' };
}

/* Walks top-level and nested MP4 boxes. Returns duration in seconds plus the
   largest video track dimensions found in tkhd boxes. */
export function probeMp4(bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (buffer.length < 16) return { ok: false, reason: 'File too small to be an MP4.' };
  const rootType = buffer.toString('ascii', 4, 8);
  if (rootType !== 'ftyp' && rootType !== 'moov' && rootType !== 'mdat' && rootType !== 'free' && rootType !== 'wide') {
    return { ok: false, reason: 'Not an ISO BMFF (MP4) file.' };
  }

  const result = {
    ok: false,
    container: 'mp4',
    bytes: buffer.byteLength,
    durationSeconds: null,
    videoDurationSeconds: null,
    audioDurationSeconds: null,
    width: null,
    height: null,
    hasAudio: false,
  };

  function durationFromHeader(bodyStart) {
    const version = buffer[bodyStart];
    if (version === 1) {
      const timescale = buffer.readUInt32BE(bodyStart + 20);
      const duration = Number(buffer.readBigUInt64BE(bodyStart + 24));
      return timescale > 0 ? duration / timescale : null;
    }
    const timescale = buffer.readUInt32BE(bodyStart + 12);
    const duration = buffer.readUInt32BE(bodyStart + 16);
    return timescale > 0 ? duration / timescale : null;
  }

  function walk(start, end, handlers) {
    let offset = start;
    while (offset + 8 <= end) {
      let size = buffer.readUInt32BE(offset);
      const type = buffer.toString('ascii', offset + 4, offset + 8);
      let headerSize = 8;
      if (size === 1) {
        if (offset + 16 > end) break;
        size = Number(buffer.readBigUInt64BE(offset + 8));
        headerSize = 16;
      } else if (size === 0) {
        size = end - offset;
      }
      if (size < headerSize || offset + size > end) break;
      const handler = handlers[type];
      if (handler) handler(offset + headerSize, offset + size);
      offset += size;
    }
  }

  walk(0, buffer.length, {
    moov(moovStart, moovEnd) {
      walk(moovStart, moovEnd, {
        mvhd(bodyStart) {
          result.durationSeconds = durationFromHeader(bodyStart);
          result.ok = true;
        },
        trak(trakStart, trakEnd) {
          let handlerType = null;
          let trackDurationSeconds = null;
          walk(trakStart, trakEnd, {
            mdia(mdiaStart, mdiaEnd) {
              walk(mdiaStart, mdiaEnd, {
                mdhd(bodyStart) {
                  trackDurationSeconds = durationFromHeader(bodyStart);
                },
                hdlr(bodyStart) {
                  handlerType = buffer.toString('ascii', bodyStart + 8, bodyStart + 12);
                  if (handlerType === 'soun') result.hasAudio = true;
                },
              });
              if (handlerType === 'vide' && trackDurationSeconds !== null) {
                result.videoDurationSeconds = Math.max(result.videoDurationSeconds || 0, trackDurationSeconds);
              }
              if (handlerType === 'soun' && trackDurationSeconds !== null) {
                result.audioDurationSeconds = Math.max(result.audioDurationSeconds || 0, trackDurationSeconds);
              }
            },
            tkhd(bodyStart) {
              const version = buffer[bodyStart];
              const sizeOffset = version === 1 ? 88 : 76;
              const width = buffer.readUInt32BE(bodyStart + sizeOffset) / 65536;
              const height = buffer.readUInt32BE(bodyStart + sizeOffset + 4) / 65536;
              if (width > 0 && height > 0) {
                if (!result.width || width * height > result.width * result.height) {
                  result.width = Math.round(width);
                  result.height = Math.round(height);
                }
              }
            },
          });
        },
      });
    },
  });

  if (!result.ok) return { ok: false, reason: 'MP4 moov/mvhd box not found (streaming file or unsupported layout).' };
  return result;
}
