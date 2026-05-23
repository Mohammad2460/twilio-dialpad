/**
 * Combine two mono MediaStreams (user mic + Twilio remote) into a single
 * stereo MediaStream where:
 *   - left channel  = local (user) audio
 *   - right channel = remote (caller) audio
 *
 * Deepgram's multichannel mode then returns separate transcripts per channel,
 * giving us perfect speaker labels without diarization guesswork.
 *
 * Returns the merged MediaStream + a dispose() to release the AudioContext.
 */

export interface MixedStream {
  stream: MediaStream;
  dispose: () => void;
}

export function mixToStereo(localStream: MediaStream, remoteStream: MediaStream): MixedStream {
  const ctx = new AudioContext();

  // Source nodes for each input stream
  const localSrc = ctx.createMediaStreamSource(localStream);
  const remoteSrc = ctx.createMediaStreamSource(remoteStream);

  // ChannelMergerNode with 2 inputs → stereo output
  const merger = ctx.createChannelMerger(2);
  localSrc.connect(merger, 0, 0);   // input 0 → left
  remoteSrc.connect(merger, 0, 1);  // input 1 → right

  // Destination → MediaStream we can hand off to MediaRecorder
  const dest = ctx.createMediaStreamDestination();
  merger.connect(dest);

  return {
    stream: dest.stream,
    dispose: () => {
      try { localSrc.disconnect(); } catch { /* noop */ }
      try { remoteSrc.disconnect(); } catch { /* noop */ }
      try { merger.disconnect(); } catch { /* noop */ }
      try { ctx.close(); } catch { /* noop */ }
    },
  };
}
